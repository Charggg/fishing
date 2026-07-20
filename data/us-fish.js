/*
 * us-fish.js
 * -----------
 * Fallback ("ESTIMATED") lists of common United States freshwater fish.
 *
 * WHY THIS EXISTS:
 * Sometimes the live GBIF database has NO recorded fish sightings for a small
 * pond. Rather than show an empty, sad screen, PondScope shows a smart guess
 * based on what kind of water body it is and how big it is. These guesses are
 * ALWAYS clearly labelled "ESTIMATED" in the app so you never mistake them for
 * real recorded data.
 *
 * Each fish has:
 *   name  - the common name
 *   emoji - a little icon for the card
 *   fact  - one fun/useful fact
 *
 * If you (or Claude Code) want to add more fish, just copy a line and change it.
 * Nothing else in the app needs to change.
 */

// Fish you commonly find in warm, still water: small farm ponds, neighbourhood
// ponds, lowland lakes. This is the "default" list for most US ponds.
const WARMWATER_POND_FISH = [
  { name: "Largemouth Bass",  emoji: "🐟", fact: "The #1 target of US pond anglers. Ambush predators that hide near weeds and logs." },
  { name: "Bluegill",         emoji: "🐠", fact: "A palm-sized sunfish. Often the most numerous fish in a pond and great for beginners." },
  { name: "Channel Catfish",  emoji: "🐡", fact: "Bottom-feeders that hunt by smell and taste; active mostly at night." },
  { name: "Black Crappie",    emoji: "🐟", fact: "Travel in schools; famous for tasty white fillets ('crappie' is pronounced CROP-ee)." },
  { name: "Yellow Perch",     emoji: "🐠", fact: "Golden with dark stripes; feed in daylight and love cooler, clearer water." },
  { name: "Green Sunfish",    emoji: "🐟", fact: "Tough and adaptable — often the first fish to colonise a brand-new pond." },
];

// Fish you commonly find in cold, clear water: deep or mountain/northern lakes,
// spring-fed reservoirs.
const COLDWATER_LAKE_FISH = [
  { name: "Rainbow Trout",    emoji: "🐟", fact: "Love cold, oxygen-rich water. Frequently stocked in US lakes for anglers." },
  { name: "Brook Trout",      emoji: "🐠", fact: "A native char with worm-like markings; a sign of clean, cold water." },
  { name: "Smallmouth Bass",  emoji: "🐟", fact: "Prefer rocky, cooler lakes than their largemouth cousins; hard fighters." },
  { name: "Lake Whitefish",   emoji: "🐡", fact: "Deep-water dwellers of big northern lakes; an important commercial fish." },
  { name: "Walleye",          emoji: "🐟", fact: "Named for glassy eyes that let them hunt in low light at dawn and dusk." },
  { name: "Yellow Perch",     emoji: "🐠", fact: "Common in cool lakes too; a favourite prey of walleye and bass." },
];

// Fish common in big man-made reservoirs (dammed rivers): a mix of the above
// plus a few reservoir specialists.
const RESERVOIR_FISH = [
  { name: "Largemouth Bass",  emoji: "🐟", fact: "Thrive in reservoirs, especially around flooded timber and drop-offs." },
  { name: "Channel Catfish",  emoji: "🐡", fact: "Stocked in most US reservoirs; can grow surprisingly large." },
  { name: "Crappie",          emoji: "🐟", fact: "Suspend around submerged brush piles; a reservoir favourite." },
  { name: "Bluegill",         emoji: "🐠", fact: "The base of the food chain — food for nearly every predator here." },
  { name: "White Bass",       emoji: "🐟", fact: "Open-water schooling fish that chase shad; produce fast, exciting bites." },
  { name: "Gizzard Shad",     emoji: "🐠", fact: "Not usually caught, but the key baitfish that feeds the whole reservoir." },
];

/*
 * pickEstimatedFish(pond)
 * Chooses which fallback list best fits a given water body, using its type and
 * (roughly) its size. Returns { list, reason } so the app can explain WHY.
 */
function pickEstimatedFish(pond) {
  const type = (pond.type || "").toLowerCase();
  const areaM2 = pond.areaM2 || 0;

  // Big dammed reservoirs get the reservoir mix.
  if (type.includes("reservoir")) {
    return {
      list: RESERVOIR_FISH,
      reason: "This looks like a man-made reservoir, so we're showing fish that typically thrive in dammed, open water.",
    };
  }

  // Large and/or lake-type water bodies lean coldwater/lake.
  // 200,000 m² is roughly 20 hectares (~50 acres) — a genuinely big lake.
  if (type.includes("lake") && areaM2 > 200000) {
    return {
      list: COLDWATER_LAKE_FISH,
      reason: "This is a large lake, which is often deeper and cooler, so we're showing typical lake and coldwater species.",
    };
  }

  // Everything else — ponds and small lakes — gets the warmwater pond mix.
  return {
    list: WARMWATER_POND_FISH,
    reason: "This looks like a small, still pond, so we're showing the warmwater fish most commonly found in US ponds.",
  };
}

// Make these available to app.js (loaded as a plain <script>, no modules needed).
window.PondScopeFish = {
  WARMWATER_POND_FISH,
  COLDWATER_LAKE_FISH,
  RESERVOIR_FISH,
  pickEstimatedFish,
};
