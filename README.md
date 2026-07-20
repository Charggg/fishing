# 🎣 PondScope

**Find ponds and lakes near any location — and discover the fish that live in them, how old the water is, how big it is, and more.**

PondScope is a single web page. There is **nothing to install**. You don't need Node, npm, a terminal, or any programming knowledge. If you can double-click a file, you can run it.

---

## ▶️ How to run it (the easy way)

1. Download/open this project folder on your computer.
2. **Double-click `index.html`.**
3. It opens in your web browser. Done! 🎉

That's it. Type a place (like `Columbus, Ohio`) or coordinates (like `40.0, -83.0`) into the box, or click **📍 My location**, or just **click anywhere on the map**, then hit **🔍 Scan for ponds**.

> 💡 You need to be connected to the internet, because PondScope looks up live map and fish data while you use it.

### If double-clicking doesn't show the map or data
A few browsers are extra strict about opening files directly. If that happens, run a tiny local web server instead (this does **not** install anything permanent):

- **If you have Python** (many computers do), open a terminal in this folder and run:
  ```
  python3 -m http.server 8000
  ```
  Then open **http://localhost:8000** in your browser.

- Or just ask Claude Code: *"help me run PondScope on a local server."*

---

## 🧭 What each thing on screen does

- **Search box** — type coordinates (`lat, lon`) or a place name.
- **📍 My location** — uses your device's GPS (your browser will ask permission).
- **Search radius slider** — how far around the point to look for water (default 3 km).
- **🔍 Scan for ponds** — starts the search. You can also **click the map**.
- **The map** — every glowing dot is a pond/lake. Click one to see details.
- **The right panel** — the list of ponds, and the details when you pick one:
  size, shoreline length, likely depth, **age**, and the **fish likely to be there**.

### About the coloured badges
- 🟢 **RECORDED / OBSERVED** = this is real data from a database.
- 🟡 **ESTIMATED** = a smart guess (used when no real record exists), so the app is always useful. Guesses are never shown as if they were facts.

---

## 📁 What's in this folder

| File | What it is |
|------|------------|
| `index.html` | The page itself (what your browser opens). |
| `styles.css` | All the colours, animations, and layout. Change colours at the very top. |
| `app.js` | The "brain" — finds ponds, fish, age, and size. Fully commented. |
| `data/us-fish.js` | The list of common US fish used for estimates. Easy to add to. |
| `README.md` | This file. |

---

## 🔧 Want to change something?

You're doing this with Claude Code, so just ask in plain English, for example:
- *"Make the app red and orange instead of teal."*
- *"Add walleye to the estimated fish list."*
- *"Show water temperature too."*
- *"Start the map centered on my town instead of the whole US."*

Claude Code can find the right file and make the change for you.

---

## 🌐 Where the data comes from (all free, no accounts, no API keys)

- **[OpenStreetMap](https://www.openstreetmap.org) / Overpass API** — the ponds, lakes, sizes, and any recorded build dates.
- **[GBIF](https://www.gbif.org)** — real recorded fish sightings near a location.
- **[Nominatim](https://nominatim.openstreetmap.org)** — turning place names into coordinates.
- **[Leaflet](https://leafletjs.com)** — the interactive map.

Please use it gently — these are free community services shared by everyone.

---

## ⚠️ Honest disclaimer

Fish and age marked **ESTIMATED** are educated guesses, not guarantees. Real fish
populations depend on stocking, season, and local conditions. **Always follow local
fishing regulations, get the right license, and make sure water is public before
fishing.** PondScope is for fun and exploration.
