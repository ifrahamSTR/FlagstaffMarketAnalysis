# Flagstaff, AZ — Underwriting map & comp picker

Static site (no build step for the page): the Santa Rosa Beach / Gulf Shores **Underwritten Properties** page (`underwritten.html`) ported to Flagstaff and reworked for picking comps. `index.html` forwards to `underwritten.html`, keeping any `#p=` link. There are no UW sheets yet: **+ Add listing** puts a Zillow listing on the map to rank its comps, build a comp set and download a UW CSV.

## What is new on this page

- **Quick bar above the map:** Bedrooms (Studio, 1–5, 6+), Baths (1, 1.5 … 3.5, 4+) and Setting chips. Tap several to combine them; each chip shows how many comps it would give with the other filters. They are the same filters as the panel's Filters tab and go into the `#beds=…&ba=…` link.
- **Map built for selecting comps:**
  - *Click a dot to* **Select** (default) or **See details** (the full popup). Hovering a dot shows a summary card.
  - **Box select** button, or **Shift + drag** anywhere: selects every comp shown inside the box. Grey (filtered-out) dots are never selected. **Box remove** (appears once something is selected), or **Alt / Option + drag**, unselects the picked comps inside a box.
  - Selected comps get a blue ring; the **tray** at the bottom copies them for the UW sheet, opens the comp list, zooms to them or clears them. The selection is kept per tab (sessionStorage): a reload keeps it, a new visit starts empty. **Clear** (tray, list or panel) offers **Undo** in the message.
  - Basemaps: **Terrain** (Esri Light Gray over Esri World Hillshade, the default), Topo, Satellite, Streets. Whole zoom steps only (fractional zoom drew tile seams in Chrome).
- **City and mountains marked** (View box / Layers tab toggles): the City of Flagstaff limits (US Census TIGER, GEOID 0423620) with the 1 km downtown ring round Heritage Square; the San Francisco Peaks and 15 other named peaks with heights in feet (OpenStreetMap; Humphreys Peak = USGS 12,633 ft); the Arizona Snowbowl ski-area outline; NAU, Lowell Observatory, the airport, Buffalo Park; and the county communities (Kachina Village, Mountainaire, Fort Valley, Doney Park).
- **Overview and property mode:** the page opens in **Overview** (nothing selected, the whole-Flagstaff view). Clicking a target (Targets tab, or its buttons on the map) enters **property mode**: the map zooms to that one property and its matches, a gold outline and a "Viewing only …" box show it. The **Overview** button on the map (also ← Overview in the panel) or **Esc** leaves it: the whole map again, with the overview's filters and matching rules put back and your picked comps untouched. Esc goes one step at a time: finish a pin placement, cancel a box, close a popup, then leave the property; it does nothing while you type in a field. Adding a listing shows it on the map but does not enter property mode. The comp list's bar stays under the header while you scroll and has **↑ Back to map**.
- **Zillow search strip** (top of the page, `uw-zillow.js`): pick *All of Flagstaff and the county*, one of the six areas, or *This map view*, plus optional minimum beds and baths, then **Open on Zillow**. It opens zillow.com/flagstaff-az/ with the frame already set (`mapBounds` in the `searchQueryState`), so the map never has to be drawn. Area frames are the 2nd–98th percentile box of each area's Airbnb comps, padded about 1 km (`bbox` per area and `marketBbox` in `data/comps.json`); Zillow takes a rectangle, so an edge can include a little of the next area. The choices are remembered in this browser.
- **My comps** (below the map, `uw-list.js`): tick comps (map click, box, or the tick boxes), optionally choose a **Mark** (Low / Mid / High), press **✓ Confirm to My comps** (map tray, or the list bar). They move into **My comps**, a table in the UW sheet's comp columns (Listing URL, Revenue Potential, Bedrooms, Sleeps, ADR, Occupancy, the 8 amenity flags, Notes):
  - **Every cell is editable**; changed cells turn yellow, ↺ puts a row back to the workbook's values, × removes it. Tab moves between cells without the table redrawing. Edits never change the workbook's data or the Low / Mid / High revenue cases.
  - **Low / Mid / High** are a colour mark only: light green, green, dark green rows (click a mark again to remove it). They are not written into the notes or the revenue cases, so they don't appear in the copied text (the CSV download has a Mark column).
  - **Copy for UW sheet** pastes the rows with every edit, revenue high to low (optional header row); **Download CSV**; **Remove all** (with Undo).
  - My comps is kept in this browser (localStorage) until you remove them; the ticks are per tab. Rows already in My comps show "✓ My comps" in the other lists and in the dot's hover card.
  - Other tabs: *Ticked*, *All shown on the map*, *Matches for the selected target* (sortable, one tick box per row = the same selection). Copy formats for those:
  - **UW sheet rows**: the sheet's 15 comp columns (URL, revenue, bedrooms, sleeps, ADR, occupancy %, 8 amenity 1/0 flags in the target sheet's own column order, notes), revenue high to low; the same text as every other copy on the page. Optional header row with the sheet's own column names.
  - **Full details**: every table column plus the URL, the amenity 1/0 columns, mountain view and the note, in the table's order.
  - **Download CSV** of the rows in view (UTF-8 with BOM, opens cleanly in Excel).

## Data

- Workbook `../Flagstaff - AZ.xlsx` (snapshot 2026-11-25), sheet `Cleaned_Data`: 887 rows, **856 entire homes** used as comps (29 private rooms and 2 hotel rooms left out, by Base_Table `roomType`). Three Oak Creek Canyon cabins are billed as Sedona 86336; they sit with Kachina Village.
- `../notebooks/market_common.py` (same API as the other ports) gives each home:
  - its **area**: Ward clusters (k=6) of the coordinates: Downtown & NAU 242, East Flagstaff 210, Southwest Flagstaff 180, Fort Valley 29, Doney Park & Timberline 70, Kachina Village & Mountainaire 125. A new target takes the nearest listing's area (856 of 856 in a leave-one-out test);
  - its **setting** (stored where the coastal pages keep "position on the water"): Downtown (within 1 km of Heritage Square) 159 / In the city (inside the TIGER city limits) 457 / Outside the city 240. A setting chosen on a target's card wins;
  - km to downtown and km to the Arizona Snowbowl outline; the Airbnb `SYSTEM_VIEW_MOUNTAIN` flag as the `mountain_view` amenity (252 homes);
  - size bucket 1-2BR / 3BR / 4BR / 5BR+ and tiers, as the other markets.
- No default revenue floor (`minRevDefault` null): the market median is about $47k (top 25% from $66k, top 10% from $91k), so the coastal pages' $90k would hide most homes. Set one with "Revenue ≥" above the map.
- `../notebooks/flagstaff_city_tiger.json` (TIGERweb, fetched 2026-11-26) and `../notebooks/flagstaff_geo.json` (Overpass, 2026-11-26) are the cached geography; the build copies them into `data/geo.json`.

## OPEX defaults by size (new listings)

A new listing from the blank sheet gets these on top of the standard OPEX lines (`OPEX_BY_BEDROOMS`, `OPEX_BY_SQFT` in `js/underwritten/uw-rules.js`). They were supplied under the "Blue Ridge, GA" name and set here for Flagstaff. Bedrooms use the projected count if given, else the listed one (studio = 1, 8+ = 7); sqft picks the smallest row that covers the home (1,800 sqft uses the 2,000 row; above 4,500 uses the 4,500 row). With no bedrooms or sqft entered, those lines stay at the generic defaults. Everything stays editable on the Sheet tab; editing a saved listing's bedrooms later does not re-price it.

| Bedrooms | Cleaning | CapEx | Insurance | Supplies | Software | Turns |
|---|---|---|---|---|---|---|
| 1 | $125 | $300 | $200 | $125 | $0 | 8.5 |
| 2 | $150 | $325 | $200 | $125 | $0 | 8 |
| 3 | $175 | $350 | $250 | $175 | $0 | 7 |
| 4 | $225 | $400 | $300 | $205 | $0 | 6.25 |
| 5 | $275 | $500 | $350 | $250 | $0 | 5.5 |
| 6 | $350 | $600 | $400 | $300 | $0 | 5 |
| 7 | $400 | $700 | $450 | $330 | $0 | 5 |

| Sqft | Internet | Pest control | Utilities |
|---|---|---|---|
| 1,000 | $100 | $60 | $325 |
| 1,500 | $100 | $60 | $425 |
| 2,000 | $100 | $60 | $525 |
| 2,750 | $100 | $75 | $625 |
| 3,500 | $125 | $75 | $700 |
| 4,500 | $150 | $75 | $825 |

## Pipeline

1. `python scripts/build_underwritten.py` (the `str` venv; add `--offline` to skip geocoding) writes `data/*.json`, `tests/fixtures/place_check.json` and `reports/comp_audit.csv`, then runs `node tests/test_underwritten.mjs` (37 checks: browser vs Python location rules on 1,225 grid points and all 856 listings, copy rows, matching).
2. Browser test: `NODE_PATH=<playwright-core node_modules> node tests/test_underwritten_browser.mjs` (comp picker: chips, click and box select, tray and list copies, reload; then add a listing, match, copy, download, phone width).
3. Drop "UW'ing - NN.csv" exports into `underwriting/source_csv/` and rebuild to add underwritten targets. New sheets start from `underwriting/template/UW'ing - template (from Island Park 112).csv`, whose comp columns are Hot tub, Firepit, Game room, Outdoor Dining, Pack and Play, Sauna, Playground, Waterfront.
