/* =========================================================================
   PondScope — app.js
   All the logic for finding ponds and their fish. Plain JavaScript, no build
   tools. Heavily commented so you (a beginner) or Claude Code can change it.

   BIG PICTURE:
   1. The user gives us a location (typed coords, a place name, the map click,
      or their GPS).
   2. We ask OpenStreetMap ("Overpass") for water bodies near that spot.
   3. We show them as glowing markers + a list, plus a circle for the radius.
   4. When one is clicked, we ask GBIF for real fish sightings nearby, estimate
      the pond's age & size, and show a detail panel.

   Nothing here needs an API key. Everything is free.
   ========================================================================= */

// ---- Small helpers to grab elements from the page -------------------------
const $ = (id) => document.getElementById(id);

const els = {
  input:      $("searchInput"),
  searchBtn:  $("searchBtn"),
  locateBtn:  $("locateBtn"),
  radius:     $("radiusSlider"),
  radiusLbl:  $("radiusLabel"),
  status:     $("statusBar"),
  list:       $("pondList"),
  detail:     $("pondDetail"),
  scan:       $("scanOverlay"),
};

// Remember the ponds we found and their markers so we can highlight/select them.
let state = {
  map: null,
  markers: [],       // { pond, marker }
  ponds: [],
  centerMarker: null,
  radiusCircle: null,
  lastCenter: null,  // {lat, lon} of the most recent search — used by the slider
  searchToken: 0,    // increments each search so old/slow responses are ignored
};

// Free public Overpass (OpenStreetMap data) servers. We try them in order; if
// one is busy or down we automatically fall back to the next, telling the user
// which attempt we're on. Ordered fastest / most reliable first: Kumi Systems
// is consistently quick, the official server is reliable but often overloaded,
// then two community mirrors as further backups.
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// How long to wait on ONE mirror before giving up and trying the next. Kept
// short so the total wait stays reasonable even if the first mirror is down.
const OVERPASS_TIMEOUT_MS = 11000;

/* =========================================================================
   1. SET UP THE MAP
   ========================================================================= */
function initMap() {
  // Start centered on the continental United States.
  const map = L.map("map", { zoomControl: true }).setView([39.5, -98.35], 4);

  // Crisp map tiles from CARTO. The "{r}" becomes "@2x" on high-resolution
  // phone screens, so the map looks sharp instead of blurry. Water bodies show
  // clearly in blue, which is exactly what we care about here.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }).addTo(map);

  // Clicking anywhere on the map runs a search there.
  map.on("click", (e) => {
    runSearch(e.latlng.lat, e.latlng.lng);
  });

  state.map = map;
}

/* =========================================================================
   2. STATUS + SCAN + RADIUS-CIRCLE HELPERS
   ========================================================================= */
function setStatus(msg, kind = "") {
  els.status.className = "status-bar" + (kind ? " " + kind : "");
  els.status.innerHTML = msg;
}

// Control the map overlay. `stateName` is "idle" | "busy" | "hidden".
// Optional `text` updates the message shown while busy.
function setOverlay(stateName, text) {
  els.scan.classList.remove("state-idle", "state-busy", "state-hidden");
  els.scan.classList.add("state-" + stateName);
  if (text) {
    const t = $("scanText");
    if (t) t.textContent = text;
  }
}

// Draw (or move/resize) the translucent circle that shows the search radius.
function updateRadiusCircle(center, radiusM) {
  if (!state.map || !center) return;
  if (state.radiusCircle) {
    state.radiusCircle.setLatLng([center.lat, center.lon]);
    state.radiusCircle.setRadius(radiusM);
  } else {
    state.radiusCircle = L.circle([center.lat, center.lon], {
      radius: radiusM,
      color: "#0bd3d3",
      weight: 2,
      opacity: 0.9,
      fillColor: "#0bd3d3",
      fillOpacity: 0.08,
      dashArray: "6 8",
    }).addTo(state.map);
  }
}

/* =========================================================================
   3. NETWORK HELPERS (timeouts + Overpass failover)
   ========================================================================= */

// fetch() with a hard timeout so a slow server can't make the app hang forever.
function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// Send an Overpass query, trying each server until one works. `onAttempt(n, total)`
// is called before each try so the UI can show progress ("Trying server 2/4…").
async function overpassQuery(query, onAttempt) {
  let lastErr = null;
  const total = OVERPASS_ENDPOINTS.length;
  for (let i = 0; i < total; i++) {
    if (onAttempt) onAttempt(i + 1, total);
    try {
      const res = await fetchWithTimeout(
        OVERPASS_ENDPOINTS[i],
        { method: "POST", body: "data=" + encodeURIComponent(query) },
        OVERPASS_TIMEOUT_MS
      );
      if (!res.ok) {
        lastErr = new Error(`server busy (${res.status})`);
        continue; // try the next server
      }
      return await res.json();
    } catch (err) {
      lastErr = err; // timeout or network error — try the next server
    }
  }
  throw lastErr || new Error("All map servers are unavailable");
}

/* =========================================================================
   4. TURN USER INPUT INTO COORDINATES
   Accepts either "lat, lon" numbers or a place name (looked up via Nominatim).
   ========================================================================= */
async function resolveInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Does it look like "40.0, -83.0" (two numbers)?
  const coordMatch = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    }
    return { error: "Those coordinates are out of range. Latitude must be -90 to 90 and longitude -180 to 180." };
  }

  // Otherwise treat it as a place name and geocode it (with a timeout).
  setStatus(`Looking up “${escapeHtml(trimmed)}”…`);
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(trimmed);
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 15000);
    if (!res.ok) return { error: "The place-name lookup service is busy. Try again, or type coordinates like 40.0, -83.0." };
    const data = await res.json();
    if (data && data.length) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        label: data[0].display_name,
      };
    }
    return { error: `Couldn't find a place called “${escapeHtml(trimmed)}”. Check the spelling, add a state/country, or type coordinates.` };
  } catch (err) {
    return { error: "Couldn't reach the place-name lookup service. Check your internet, or type coordinates like 40.0, -83.0." };
  }
}

/* =========================================================================
   5. FIND PONDS via the Overpass (OpenStreetMap) API
   Returns an array of pond objects.
   ========================================================================= */
async function findPonds(lat, lon, radiusMeters, onAttempt) {
  // Overpass Query Language. We ask for water bodies within `radiusMeters`
  // of the point. "around:R,lat,lon" is a circle filter.
  // NOTE: we use "out tags geom;" — this returns each shape's TAGS and full
  // GEOMETRY (so we can measure area). We compute the center point ourselves.
  const R = Math.round(radiusMeters);
  const query = `
    [out:json][timeout:25];
    (
      way["natural"="water"](around:${R},${lat},${lon});
      relation["natural"="water"](around:${R},${lat},${lon});
      way["landuse"="reservoir"](around:${R},${lat},${lon});
      relation["landuse"="reservoir"](around:${R},${lat},${lon});
      way["water"="pond"](around:${R},${lat},${lon});
    );
    out tags geom;
  `;

  const data = await overpassQuery(query, onAttempt);

  const ponds = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};

    // Work out a center point + size + outline from whatever geometry we got.
    let center = null;
    let areaM2 = 0;
    let perimeterM = 0;
    let bounds = null; // the water body's bounding box, so we can frame it on the map

    if (Array.isArray(el.geometry) && el.geometry.length >= 3) {
      // A "way" (single closed shape): geometry is a list of {lat, lon} points.
      const m = measurePolygon(el.geometry);
      areaM2 = m.areaM2;
      perimeterM = m.perimeterM;
      center = centroidOf(el.geometry);
      bounds = boundsOf(el.geometry);
    }
    if (!bounds && el.bounds) bounds = el.bounds;
    if (!center && el.bounds) {
      // A "relation" (multi-part shape) gives us a bounding box — use its middle.
      center = {
        lat: (el.bounds.minlat + el.bounds.maxlat) / 2,
        lon: (el.bounds.minlon + el.bounds.maxlon) / 2,
      };
    }
    if (!center && el.center) center = el.center; // last-ditch fallback
    if (!center) continue; // nothing usable — skip it

    // Figure out a friendly type label.
    const type =
      tags.water ||
      (tags.landuse === "reservoir" ? "reservoir" : null) ||
      tags.natural ||
      "water";

    ponds.push({
      id: el.type + "/" + el.id,
      name: tags.name || prettyType(type) + " (unnamed)",
      type,
      lat: center.lat,
      lon: center.lon,
      areaM2,
      perimeterM,
      bounds,
      tags,
      distanceM: haversine(lat, lon, center.lat, center.lon),
    });
  }

  // Sort nearest first and keep it manageable.
  ponds.sort((a, b) => a.distanceM - b.distanceM);
  return ponds.slice(0, 40);
}

/* =========================================================================
   6. GEOMETRY MATH
   ========================================================================= */

// Distance between two lat/lon points in meters (Haversine formula).
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const Rm = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Rm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Average position of a list of {lat, lon} points (a simple center point).
function centroidOf(points) {
  let latSum = 0;
  let lonSum = 0;
  for (const p of points) {
    latSum += p.lat;
    lonSum += p.lon;
  }
  return { lat: latSum / points.length, lon: lonSum / points.length };
}

// Smallest box that contains all the points (the water body's outline extent).
function boundsOf(points) {
  let minlat = 90, minlon = 180, maxlat = -90, maxlon = -180;
  for (const p of points) {
    if (p.lat < minlat) minlat = p.lat;
    if (p.lat > maxlat) maxlat = p.lat;
    if (p.lon < minlon) minlon = p.lon;
    if (p.lon > maxlon) maxlon = p.lon;
  }
  return { minlat, minlon, maxlat, maxlon };
}

/* =========================================================================
   FISHABILITY SCORE (1–10)
   An honest ESTIMATE of how many bites you might get. Starts from the water
   body's size and type (habitat), then — when we have real GBIF fish data —
   nudges it up for more species / more recorded sightings.
   ========================================================================= */
function computeFishability(pond, fish) {
  const type = (pond.type || "").toLowerCase();
  const area = pond.areaM2 || 0;

  // Base score from surface area (bigger water usually = more fish).
  let score;
  if (area <= 0) score = 5;              // unknown size → neutral
  else if (area < 500) score = 3;        // tiny
  else if (area < 5000) score = 5;       // small pond
  else if (area < 50000) score = 7;      // healthy pond
  else if (area < 500000) score = 8;     // small lake
  else score = 7;                        // big water: lots of fish but spread out

  // Type adjustments.
  if (type.includes("pond")) score += 1;         // classic bass/bluegill water
  else if (type.includes("reservoir")) score += 1;
  else if (type.includes("wetland") || type.includes("canal")) score -= 1;

  let reason;
  if (fish && fish.badge === "real") {
    const species = fish.list.length;
    const sightings = fish.list.reduce((s, f) => s + (f.count || 0), 0);
    if (species >= 6 || sightings >= 40) score += 2;
    else if (species >= 3 || sightings >= 10) score += 1;
    reason = `Based on the habitat plus ${species} fish species and ${sightings} recorded sighting${sightings === 1 ? "" : "s"} nearby.`;
  } else {
    reason = "Estimated from the water body's size and type. Tap in for fish data to refine it.";
  }

  score = Math.max(1, Math.min(10, Math.round(score)));

  // A descriptor word for the score...
  const descriptors = ["", "Very slow", "Poor", "Slow", "Below average", "Fair",
                       "Decent", "Good", "Very good", "Excellent", "Prime spot"];
  const descriptor = descriptors[score];

  // ...and a bite-likelihood phrase that MATCHES the score (no more "3/10 —
  // bites likely" contradictions). Low = unlikely, middle = possible, high = likely.
  let bites;
  if (score <= 3) bites = "bites unlikely";
  else if (score <= 6) bites = "bites possible";
  else bites = "bites likely";

  // Combined label used in the UI, e.g. "Decent — bites possible".
  const label = `${descriptor} — ${bites}`;
  return { score, descriptor, bites, label, reason };
}

// Given a list of {lat, lon} shoreline points, estimate surface area (m²) using
// the shoelace formula, plus the perimeter length.
function measurePolygon(geometry) {
  if (!geometry || geometry.length < 3) return { areaM2: 0, perimeterM: 0 };

  // Convert lat/lon to local meters using an equirectangular approximation.
  const lat0 = geometry[0].lat;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = geometry.map((p) => ({
    x: p.lon * mPerDegLon,
    y: p.lat * mPerDegLat,
  }));

  let area = 0;
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    perim += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  return { areaM2: Math.abs(area) / 2, perimeterM: perim };
}

/* =========================================================================
   7. ESTIMATE AGE
   Uses a real OSM `start_date` tag when present (RECORDED); otherwise makes a
   clearly-labelled ESTIMATE from the water body's type.
   ========================================================================= */
function estimateAge(pond) {
  const currentYear = new Date().getFullYear();
  const startDate = pond.tags.start_date || pond.tags["construction:start_date"];

  if (startDate) {
    const yr = parseInt(String(startDate).slice(0, 4), 10);
    if (!isNaN(yr) && yr > 0 && yr <= currentYear) {
      const age = currentYear - yr;
      return {
        badge: "real",
        text: age + (age === 1 ? " year" : " years"),
        note: `OpenStreetMap records this water body as dating from ${yr}.`,
        minYears: age, maxYears: age, pointYears: age,
      };
    }
  }

  const type = (pond.type || "").toLowerCase();

  if (type.includes("reservoir")) {
    return {
      badge: "est",
      text: "~25–90 years",
      note: "No exact date on record. Most US reservoirs were built between the 1930s and 2000s, so this is our best estimate for a dammed reservoir.",
      minYears: 25, maxYears: 90, pointYears: 55,
    };
  }
  if (type.includes("lake")) {
    return {
      badge: "est",
      text: "~50–150+ years",
      note: "No exact date on record. Established lakes are often decades to centuries old; large natural lakes in glaciated regions can be thousands of years old.",
      minYears: 50, maxYears: 150, pointYears: 90,
    };
  }
  return {
    badge: "est",
    text: "~10–60 years",
    note: "No exact date on record. Small ponds are usually dug for farms, storm-water, or landscaping and tend to be a few decades old — this is an estimate.",
    minYears: 10, maxYears: 60, pointYears: 30,
  };
}

/* =========================================================================
   8. GET FISH via the GBIF API
   Returns { list, badge, reason } where list items are {name, emoji, count, fact}.
   ========================================================================= */
async function getFish(pond) {
  // Search a small box around the pond for recorded ray-finned fish sightings.
  // taxonKey 204 = class Actinopterygii (ray-finned fishes) in GBIF.
  const d = 0.02; // ~2 km box half-size in degrees
  const params = new URLSearchParams({
    taxonKey: "204",
    decimalLatitude: `${(pond.lat - d).toFixed(4)},${(pond.lat + d).toFixed(4)}`,
    decimalLongitude: `${(pond.lon - d).toFixed(4)},${(pond.lon + d).toFixed(4)}`,
    hasCoordinate: "true",
    limit: "300",
  });

  try {
    const res = await fetchWithTimeout(
      "https://api.gbif.org/v1/occurrence/search?" + params,
      {},
      15000
    );
    if (res.ok) {
      const data = await res.json();
      const counts = new Map();
      for (const rec of data.results || []) {
        const name = rec.species || rec.scientificName;
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (counts.size > 0) {
        const list = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([name, count]) => ({
            name,
            emoji: "🐟",
            count,
            fact: `${count} recorded sighting${count === 1 ? "" : "s"} logged near here on GBIF.`,
          }));
        return {
          list,
          badge: "real",
          reason: "These species have real, recorded sightings near this spot in the GBIF biodiversity database.",
        };
      }
    }
  } catch (err) {
    console.warn("GBIF lookup failed, using estimate:", err);
  }

  // No real records → clearly-labelled estimate from our US fish lists.
  const est = window.PondScopeFish.pickEstimatedFish(pond);
  return {
    list: est.list.map((f) => ({ ...f, count: null })),
    badge: "est",
    reason: est.reason + " (No recorded sightings were found for this exact spot.)",
  };
}

/* =========================================================================
   9. DRAW THE PONDS ON THE MAP + IN THE LIST
   ========================================================================= */
function renderPonds(ponds, center) {
  // Clear old markers.
  state.markers.forEach((m) => state.map.removeLayer(m.marker));
  state.markers = [];
  state.ponds = ponds;

  // Marker for the search center.
  if (state.centerMarker) state.map.removeLayer(state.centerMarker);
  state.centerMarker = L.circleMarker([center.lat, center.lon], {
    radius: 6, color: "#ffd166", weight: 2, fillColor: "#ffd166", fillOpacity: 0.9,
  }).addTo(state.map).bindPopup("Search center");

  // A glowing marker for each pond.
  const bounds = [[center.lat, center.lon]];
  ponds.forEach((pond) => {
    const icon = L.divIcon({
      className: "",
      html: '<div class="pond-marker"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const marker = L.marker([pond.lat, pond.lon], { icon }).addTo(state.map);
    marker.bindPopup(`<strong>${escapeHtml(pond.name)}</strong>`);
    marker.on("click", () => selectPond(pond));
    state.markers.push({ pond, marker });
    bounds.push([pond.lat, pond.lon]);
  });

  // Fit the map to show the search circle (and everything we found).
  if (state.radiusCircle) {
    state.map.fitBounds(state.radiusCircle.getBounds(), { padding: [30, 30], maxZoom: 15 });
  } else if (ponds.length) {
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  } else {
    state.map.setView([center.lat, center.lon], 14);
  }

  // Build the list on the right.
  renderList(ponds);
}

function renderList(ponds) {
  els.detail.hidden = true;
  els.list.hidden = false;

  if (!ponds.length) {
    els.list.innerHTML =
      '<div class="empty-msg"><span class="big">🌵</span>No ponds or lakes found in this circle. Try a bigger search radius, or a different spot.</div>';
    return;
  }

  els.list.innerHTML = "";
  ponds.forEach((pond, i) => {
    const age = estimateAge(pond);            // how old (real or estimated)
    const fscore = computeFishability(pond);  // 1–10 habitat estimate

    const card = document.createElement("div");
    card.className = "pond-card";
    card.style.animationDelay = (i * 0.04) + "s";
    card.innerHTML = `
      <div class="drop">💧</div>
      <div class="pc-body">
        <div class="pc-name">${escapeHtml(pond.name)}</div>
        <div class="pc-meta">
          ${prettyType(pond.type)} &middot;
          ${formatDistance(pond.distanceM)} away
          ${pond.areaM2 ? "&middot; " + formatArea(pond.areaM2) : ""}
        </div>
        <div class="pc-tags">
          <span class="pc-chip">⏳ ${age.text}</span>
          <span class="pc-chip pc-chip--fish">🎣 ${fscore.score}/10</span>
        </div>
      </div>
      <div class="pc-arrow">›</div>`;
    card.addEventListener("click", () => selectPond(pond));
    els.list.appendChild(card);
  });
}

/* =========================================================================
   10. SHOW ONE POND IN DETAIL
   ========================================================================= */
async function selectPond(pond) {
  // Highlight the matching marker.
  state.markers.forEach((m) => {
    const dot = m.marker.getElement()?.querySelector(".pond-marker");
    if (dot) dot.classList.toggle("active", m.pond.id === pond.id);
  });

  // Frame the whole water body (using its real outline) so you actually land
  // ON the water, not just near it. Fall back to a plain center if we have no
  // outline for this shape.
  if (pond.bounds) {
    state.map.fitBounds(
      [[pond.bounds.minlat, pond.bounds.minlon], [pond.bounds.maxlat, pond.bounds.maxlon]],
      { padding: [60, 60], maxZoom: 17, animate: true }
    );
  } else {
    state.map.setView([pond.lat, pond.lon], 15, { animate: true });
  }

  const age = estimateAge(pond);

  // Show the panel immediately with a "loading fish" note, then fill fish in.
  els.list.hidden = true;
  els.detail.hidden = false;
  els.detail.innerHTML = detailHtml(pond, age, {
    list: [], badge: "est",
    reason: "Checking the GBIF database for recorded fish sightings…",
  }, true);
  wireBackButton();

  // Now fetch the fish and re-render the panel with them.
  const fish = await getFish(pond);
  els.detail.innerHTML = detailHtml(pond, age, fish, false);
  wireBackButton();
}

function wireBackButton() {
  const back = els.detail.querySelector(".back-btn");
  if (back) back.addEventListener("click", () => renderList(state.ponds));
}

// Builds the HTML for the detail panel.
function detailHtml(pond, age, fish, loadingFish) {
  const badge = (kind) =>
    kind === "real"
      ? '<span class="badge badge-real">RECORDED</span>'
      : '<span class="badge badge-est">ESTIMATED</span>';
  const fishBadge = (kind) =>
    kind === "real"
      ? '<span class="badge badge-real">OBSERVED</span>'
      : '<span class="badge badge-est">ESTIMATED</span>';

  const scaleMax = 200;
  const fillPct = Math.min(100, (age.pointYears / scaleMax) * 100);

  const fishCards = loadingFish
    ? '<div class="empty-msg">🎣 Casting a line for fish data…</div>'
    : fish.list
        .map(
          (f, i) => `
      <div class="fish-card" style="animation-delay:${i * 0.05}s">
        <div class="fish-emoji">${f.emoji || "🐟"}</div>
        <div class="fish-info">
          <div class="fish-name">${escapeHtml(f.name)}</div>
          ${f.count ? `<div class="fish-count">${f.count} nearby sighting${f.count === 1 ? "" : "s"}</div>` : ""}
          <div class="fish-fact">${escapeHtml(f.fact || "")}</div>
        </div>
      </div>`
        )
        .join("");

  const depthNote = estimateDepthNote(pond);
  const fscore = computeFishability(pond, loadingFish ? null : fish);

  // Ten little bars, filled up to the score.
  const meterBars = Array.from({ length: 10 }, (_, i) =>
    `<span class="mb ${i < fscore.score ? "on" : ""}"></span>`
  ).join("");

  return `
    <button class="back-btn">‹ Back to all ponds</button>
    <h2 class="detail-title">${escapeHtml(pond.name)}</h2>
    <p class="detail-sub">${prettyType(pond.type)} · ${pond.lat.toFixed(4)}, ${pond.lon.toFixed(4)}</p>

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Surface area</div>
        <div class="stat-value">${pond.areaM2 ? formatArea(pond.areaM2) : "Unknown"}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Shoreline</div>
        <div class="stat-value">${pond.perimeterM ? formatDistance(pond.perimeterM) : "Unknown"}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Distance</div>
        <div class="stat-value">${formatDistance(pond.distanceM)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Likely depth</div>
        <div class="stat-value">${depthNote.short}</div>
      </div>
    </div>

    <div class="detail-section">
      <h3>🎣 Fishability <span class="badge badge-est">ESTIMATED</span></h3>
      <div class="fish-score">
        <div class="score-num">${fscore.score}<span>/10</span></div>
        <div class="score-side">
          <div class="score-meter">${meterBars}</div>
          <div class="score-label">${fscore.label}</div>
        </div>
      </div>
      <p class="age-note">${escapeHtml(fscore.reason)}</p>
    </div>

    <div class="detail-section">
      <h3>⏳ How old is it? ${badge(age.badge)}</h3>
      <div class="stat-value" style="font-size:1.25rem">${age.text}</div>
      <div class="age-timeline"><div class="fill" style="width:${fillPct}%"></div></div>
      <div class="age-scale"><span>new</span><span>~100 yrs</span><span>200+ yrs</span></div>
      <p class="age-note">${escapeHtml(age.note)}</p>
    </div>

    <div class="detail-section">
      <h3>🐟 Fish likely here ${fishBadge(fish.badge)}</h3>
      <p class="fish-reason">${escapeHtml(fish.reason)}</p>
      <div class="fish-grid">${fishCards}</div>
    </div>

    <div class="detail-section">
      <h3>ℹ️ Good to know</h3>
      <p class="age-note">${escapeHtml(depthNote.long)} Always check local rules, fishing licenses, and whether the water is public before fishing.</p>
    </div>

    <div class="detail-links">
      <a href="https://www.openstreetmap.org/?mlat=${pond.lat}&mlon=${pond.lon}#map=17/${pond.lat}/${pond.lon}" target="_blank" rel="noopener">
        🗺️ Open this spot on OpenStreetMap →
      </a>
    </div>
  `;
}

// A rough, honest depth hint based on size and type (all estimated).
function estimateDepthNote(pond) {
  const type = (pond.type || "").toLowerCase();
  const area = pond.areaM2 || 0;
  if (type.includes("reservoir") || (type.includes("lake") && area > 200000)) {
    return {
      short: "Deep (est.)",
      long: "Large lakes and reservoirs are often 3–20+ m (10–65+ ft) deep, with cooler water down low that can hold trout, walleye, or catfish.",
    };
  }
  if (area > 40000) {
    return {
      short: "Medium (est.)",
      long: "A pond this size is commonly 2–5 m (6–16 ft) deep — enough to support bass, sunfish, and catfish year-round.",
    };
  }
  return {
    short: "Shallow (est.)",
    long: "Small ponds are often just 1–3 m (3–10 ft) deep, which warms quickly and favours sunfish, bass, and hardy species.",
  };
}

/* =========================================================================
   11. FORMATTING HELPERS
   ========================================================================= */
function prettyType(type) {
  const map = {
    pond: "Pond", lake: "Lake", reservoir: "Reservoir",
    water: "Water body", basin: "Basin", lagoon: "Lagoon",
    wetland: "Wetland", canal: "Canal", river: "River",
  };
  return map[(type || "").toLowerCase()] || "Water body";
}
function formatDistance(m) {
  if (m == null || isNaN(m)) return "—";
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km";
}
function formatArea(m2) {
  if (!m2 || isNaN(m2)) return "Unknown";
  const acres = m2 / 4046.86;
  const hectares = m2 / 10000;
  if (m2 < 10000) return Math.round(m2).toLocaleString() + " m² (" + acres.toFixed(2) + " acres)";
  return hectares.toFixed(1) + " ha (" + acres.toFixed(1) + " acres)";
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* =========================================================================
   12. THE MAIN SEARCH FLOW
   ========================================================================= */
async function runSearch(lat, lon, label) {
  const radius = parseInt(els.radius.value, 10);
  const token = ++state.searchToken; // so a slow old search can't overwrite a new one

  // Remember this center and draw the radius circle immediately (feels instant).
  state.lastCenter = { lat, lon };
  updateRadiusCircle(state.lastCenter, radius);
  state.map.setView([lat, lon], zoomForRadius(radius), { animate: true });

  setOverlay("busy", "Scanning the water…");
  setStatus(`Scanning within ${formatDistance(radius)} of ${escapeHtml(label || lat.toFixed(4) + ", " + lon.toFixed(4))}…`);
  els.detail.hidden = true;
  els.list.hidden = false;
  els.list.innerHTML = "";

  // Called before each map-server attempt so the overlay shows live progress.
  const onAttempt = (n, total) => {
    if (token !== state.searchToken) return;
    setOverlay("busy", n === 1
      ? "Scanning the water…"
      : `First server was slow — trying alternate server (${n}/${total})…`);
  };

  try {
    const ponds = await findPonds(lat, lon, radius, onAttempt);
    if (token !== state.searchToken) return; // a newer search started; ignore this result
    renderPonds(ponds, { lat, lon });   // markers render...
    setOverlay("hidden");               // ...then fade the overlay out
    if (ponds.length) {
      setStatus(`Found <strong>${ponds.length}</strong> water bod${ponds.length === 1 ? "y" : "ies"} nearby. Tap one for fish, age &amp; more.`, "success");
    } else {
      setStatus("No ponds or lakes found in this circle. Try a wider radius (drag the slider) or a new spot.", "");
    }
  } catch (err) {
    if (token !== state.searchToken) return;
    console.error(err);
    showDemoFallback(lat, lon, err);
    setOverlay("hidden"); // hide overlay even on error (demo pond is shown instead)
  }
}

// Pick a sensible starting zoom so the whole search circle is visible.
function zoomForRadius(radiusM) {
  if (radiusM <= 800) return 15;
  if (radiusM <= 1500) return 14;
  if (radiusM <= 3500) return 13;
  if (radiusM <= 6000) return 12;
  return 11;
}

// If the live map data can't be reached (no internet, all servers busy, etc.),
// we still show a friendly DEMO pond so the app never looks broken.
function showDemoFallback(lat, lon, err) {
  const demo = [{
    id: "demo/1",
    name: "Demo Pond (offline example)",
    type: "pond",
    lat: lat + 0.004,
    lon: lon + 0.004,
    areaM2: 18000,
    perimeterM: 520,
    tags: {},
    distanceM: haversine(lat, lon, lat + 0.004, lon + 0.004),
  }];
  renderPonds(demo, { lat, lon });
  setStatus(
    "⚠️ The live map servers are busy or unreachable right now, so here's a <strong>demo pond</strong> to explore. " +
    "Please try again in a moment. (" + escapeHtml(err.message || "network error") + ")",
    "error"
  );
}

/* =========================================================================
   13. HOOK UP THE BUTTONS
   ========================================================================= */
function wireControls() {
  // Live radius label + live-growing circle on the map.
  els.radius.addEventListener("input", () => {
    const r = parseInt(els.radius.value, 10);
    els.radiusLbl.textContent = (r / 1000).toFixed(1) + " km";
    if (state.lastCenter) updateRadiusCircle(state.lastCenter, r);
  });

  // Search button + Enter key.
  const doTextSearch = async () => {
    const loc = await resolveInput(els.input.value);
    if (!loc) {
      setStatus("Type coordinates like <strong>40.0, -83.0</strong> or a place like <strong>Austin, Texas</strong>.", "error");
      return;
    }
    if (loc.error) {
      setStatus(loc.error, "error");
      return;
    }
    runSearch(loc.lat, loc.lon, loc.label);
  };
  els.searchBtn.addEventListener("click", doTextSearch);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doTextSearch();
  });

  // "My location" button uses the browser's GPS.
  els.locateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Your browser doesn't support location. Type coordinates or a place name instead.", "error");
      return;
    }
    setStatus("Asking your browser for your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => runSearch(pos.coords.latitude, pos.coords.longitude, "your location"),
      (e) => setStatus("Couldn't get your location (" + escapeHtml(e.message) + "). Type a place instead.", "error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/* =========================================================================
   14. START EVERYTHING once the page has loaded
   ========================================================================= */
window.addEventListener("DOMContentLoaded", () => {
  initMap();
  wireControls();
  setOverlay("idle"); // start in the gentle "enter a location" state, never "scanning"
});
