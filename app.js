/* =========================================================================
   PondScope — app.js
   All the logic for finding ponds and their fish. Plain JavaScript, no build
   tools. Heavily commented so you (a beginner) or Claude Code can change it.

   BIG PICTURE:
   1. The user gives us a location (typed coords, a place name, the map click,
      or their GPS).
   2. We ask OpenStreetMap ("Overpass") for water bodies near that spot.
   3. We show them as glowing markers + a list.
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
  markers: [],      // { pond, marker }
  ponds: [],
  centerMarker: null,
};

/* =========================================================================
   1. SET UP THE MAP
   ========================================================================= */
function initMap() {
  // Start centered on the continental United States.
  const map = L.map("map", { zoomControl: true }).setView([39.5, -98.35], 4);

  // Free OpenStreetMap tiles.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  // Clicking anywhere on the map runs a search there.
  map.on("click", (e) => {
    runSearch(e.latlng.lat, e.latlng.lng);
  });

  state.map = map;
}

/* =========================================================================
   2. STATUS + SCAN HELPERS
   ========================================================================= */
function setStatus(msg, kind = "") {
  els.status.className = "status-bar" + (kind ? " " + kind : "");
  els.status.innerHTML = msg;
}
function showScan(on) {
  els.scan.hidden = !on;
}

/* =========================================================================
   3. TURN USER INPUT INTO COORDINATES
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
  }

  // Otherwise treat it as a place name and geocode it.
  setStatus(`Looking up “${trimmed}”…`);
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(trimmed);
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  const data = await res.json();
  if (data && data.length) {
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      label: data[0].display_name,
    };
  }
  return null;
}

/* =========================================================================
   4. FIND PONDS via the Overpass (OpenStreetMap) API
   Returns an array of pond objects.
   ========================================================================= */
async function findPonds(lat, lon, radiusMeters) {
  // Overpass Query Language. We ask for water bodies within `radiusMeters`
  // of the point. "around:R,lat,lon" is a circle filter.
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
    out tags center geom;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass request failed (" + res.status + ")");
  const data = await res.json();

  const ponds = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    // Where is it? Prefer the geometry-derived center Overpass gives us.
    const center = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
    if (!center) continue;

    // Compute surface area & perimeter from the polygon outline if we have one.
    const { areaM2, perimeterM } = measurePolygon(el.geometry);

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
      tags,
      distanceM: haversine(lat, lon, center.lat, center.lon),
    });
  }

  // Sort nearest first and keep it manageable.
  ponds.sort((a, b) => a.distanceM - b.distanceM);
  return ponds.slice(0, 40);
}

/* =========================================================================
   5. GEOMETRY MATH
   ========================================================================= */

// Distance between two lat/lon points in meters (Haversine formula).
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const Rkm = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Rkm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Given Overpass geometry (a list of {lat, lon} points forming the shoreline),
// estimate surface area (m²) using the shoelace formula and perimeter length.
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
   6. ESTIMATE AGE
   Uses a real OSM `start_date` tag when present (RECORDED); otherwise makes a
   clearly-labelled ESTIMATE from the water body's type.
   Returns { text, badge, note, minYears, maxYears, pointYears }.
   ========================================================================= */
function estimateAge(pond) {
  const currentYear = new Date().getFullYear();
  const startDate = pond.tags.start_date || pond.tags["construction:start_date"];

  if (startDate) {
    // OSM sometimes stores just a year, sometimes a full date.
    const yr = parseInt(String(startDate).slice(0, 4), 10);
    if (!isNaN(yr)) {
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

  // Man-made reservoirs: mostly built between ~1930 and ~2000 in the US.
  if (type.includes("reservoir")) {
    return {
      badge: "est",
      text: "~25–90 years",
      note: "No exact date on record. Most US reservoirs were built between the 1930s and 2000s, so this is our best estimate for a dammed reservoir.",
      minYears: 25, maxYears: 90, pointYears: 55,
    };
  }

  // Named lakes tend to be older / more established (some natural, some old dams).
  if (type.includes("lake")) {
    return {
      badge: "est",
      text: "~50–150+ years",
      note: "No exact date on record. Established lakes are often decades to centuries old; large natural lakes in glaciated regions can be thousands of years old.",
      minYears: 50, maxYears: 150, pointYears: 90,
    };
  }

  // Default: small ponds — usually dug in the last several decades.
  return {
    badge: "est",
    text: "~10–60 years",
    note: "No exact date on record. Small ponds are usually dug for farms, storm-water, or landscaping and tend to be a few decades old — this is an estimate.",
    minYears: 10, maxYears: 60, pointYears: 30,
  };
}

/* =========================================================================
   7. GET FISH via the GBIF API
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
    const res = await fetch("https://api.gbif.org/v1/occurrence/search?" + params);
    if (res.ok) {
      const data = await res.json();
      const counts = new Map();
      for (const rec of data.results || []) {
        const name = rec.species || rec.scientificName;
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (counts.size > 0) {
        // Turn the tally into sorted, display-ready fish cards.
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
    // Network hiccup — fall through to the estimate below.
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
   8. DRAW THE PONDS ON THE MAP + IN THE LIST
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

  // Fit the map to show everything we found.
  if (ponds.length) {
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
      '<div class="empty-msg"><span class="big">🌵</span>No ponds or lakes found here. Try a bigger search radius, or a different spot.</div>';
    return;
  }

  els.list.innerHTML = "";
  ponds.forEach((pond, i) => {
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
      </div>
      <div class="pc-arrow">›</div>`;
    card.addEventListener("click", () => selectPond(pond));
    els.list.appendChild(card);
  });
}

/* =========================================================================
   9. SHOW ONE POND IN DETAIL
   ========================================================================= */
async function selectPond(pond) {
  // Highlight the matching marker.
  state.markers.forEach((m) => {
    const dot = m.marker.getElement()?.querySelector(".pond-marker");
    if (dot) dot.classList.toggle("active", m.pond.id === pond.id);
  });
  state.map.setView([pond.lat, pond.lon], 15, { animate: true });

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

  // Age timeline: how far along a 0–200 year scale our estimate sits.
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
   10. FORMATTING HELPERS
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
  if (m == null) return "—";
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km";
}
function formatArea(m2) {
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
   11. THE MAIN SEARCH FLOW
   ========================================================================= */
async function runSearch(lat, lon, label) {
  const radius = parseInt(els.radius.value, 10);
  showScan(true);
  setStatus(`Scanning within ${formatDistance(radius)} of ${label || lat.toFixed(4) + ", " + lon.toFixed(4)}…`);
  els.detail.hidden = true;
  els.list.hidden = false;
  els.list.innerHTML = "";

  try {
    const ponds = await findPonds(lat, lon, radius);
    renderPonds(ponds, { lat, lon });
    if (ponds.length) {
      setStatus(`Found <strong>${ponds.length}</strong> water bod${ponds.length === 1 ? "y" : "ies"} nearby. Tap one for fish, age &amp; more.`, "success");
    } else {
      setStatus("No ponds or lakes found here. Try a wider radius or a new spot.", "");
    }
  } catch (err) {
    console.error(err);
    showDemoFallback(lat, lon, err);
  } finally {
    showScan(false);
  }
}

// If the live map data can't be reached (no internet, API down, or running
// from a restricted browser), we still show a friendly DEMO pond so the app
// never looks broken.
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
    "⚠️ Couldn't reach the live pond database right now, so here's a <strong>demo pond</strong> to explore. " +
    "This usually means no internet connection. (" + escapeHtml(err.message || "network error") + ")",
    "error"
  );
}

/* =========================================================================
   12. HOOK UP THE BUTTONS
   ========================================================================= */
function wireControls() {
  // Live radius label.
  els.radius.addEventListener("input", () => {
    els.radiusLbl.textContent = (els.radius.value / 1000).toFixed(1) + " km";
  });

  // Search button + Enter key.
  const doTextSearch = async () => {
    const loc = await resolveInput(els.input.value);
    if (!loc) {
      setStatus("Hmm, I couldn't understand that. Try coordinates like <strong>40.0, -83.0</strong> or a place like <strong>Austin, Texas</strong>.", "error");
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
   13. START EVERYTHING once the page has loaded
   ========================================================================= */
window.addEventListener("DOMContentLoaded", () => {
  initMap();
  wireControls();
});
