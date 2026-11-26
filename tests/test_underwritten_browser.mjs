// Browser tests for the Flagstaff, AZ underwriting page and comp picker (the rendered page,
// real clicks, real clipboard).
//   NODE_PATH=<dir with playwright-core's node_modules> node tests/test_underwritten_browser.mjs
// Uses the system Chrome (CHROME=/path/to/chrome to override) and serves this folder on a
// free local port. No request leaves the machine except map tiles: the new listing is placed
// by hand, not looked up on OpenStreetMap. Skips, with a message, if playwright-core is missing.
//  - the page loads with no console errors: 856 comps, no default revenue floor, city limits,
//    peaks and landmarks drawn
//  - comp picker: bedroom / bath chips filter the map and count right; clicking dots selects
//    them (filtered-out dots can't be clicked); Shift + drag selects every comp shown in a box;
//    the tray and the comp list copy 15-column UW sheet rows (optional header with the sheet's
//    own column names) or every column; the selection survives a reload
//  - Add a Zillow listing: address read from the URL, saved, pin placed by clicking the map
//    among the Kachina Village homes
//  - the new target's card: area (cluster), setting from the pin; every OPEX line priced
//  - Match by location: only the target's area and setting, bedrooms +/-1, nearest first;
//    "Same area" off widens it; a setting chosen on the card keeps to it; amenities rank all 856
//  - a comp popup's "Copy row" and the list's copy give the same 15-column line; Download UW CSV
//    keeps the template's amortization block byte for byte and writes the comps in revenue order
//  - colour by setting, a shared #p= link, index.html forwarding to the map (keeping the link),
//    and a 420 px phone view without sideways scrolling
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = require("playwright-core")); } catch (e) {
  console.log("SKIPPED: playwright-core not found (npm install playwright-core, then run with NODE_PATH pointing at its node_modules).");
  process.exit(0);
}
const C = require(join(ROOT, "js/underwritten/uw-csv.js"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UWJ = JSON.parse(readFileSync(join(ROOT, "data/underwritten.json"), "utf8"));
const TEMPLATE = readFileSync(join(ROOT, "underwriting/template", UWJ.templateFile), "utf8");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".csv": "text/csv", ".webp": "image/webp", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path === "/" ? "underwritten.html" : path);
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/";

let failures = 0;
const check = (ok, msg) => { console.log("  " + (ok ? "ok  " : "FAIL") + " " + msg); if (!ok) failures++; };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "en-US", permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/favicon|tile\.openstreetmap/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
// Never let the page reach Nominatim from a test.
await page.route("https://nominatim.openstreetmap.org/**", (r) => r.abort());
const ev = (f, a) => page.evaluate(f, a);
const clip = () => ev(() => navigator.clipboard.readText());

console.log("1. LOAD\n");
await page.goto(BASE + "underwritten.html", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.UW && UW.mapApi && UW.mapApi.map && UW.matchSet);
await page.waitForTimeout(400);
await ev(() => { localStorage.removeItem("flagstaffUW.picked"); localStorage.removeItem("flagstaffUW.view"); UW.clearPicked(); });
const s0 = await ev(() => ({ n: UW.listings.length, shown: UW.matchSet.size, hero: document.getElementById("uw-hero-stats").innerText, village: UW.ui.layers.village, peaks: UW.ui.layers.peaks, minRev: UW.ui.filters.minRev,
  labels: [...document.querySelectorAll(".uw-peak .uw-mk__lab")].map((x) => x.textContent), downtown: !!document.querySelector(".uw-mk--downtown"), ski: !!document.querySelector(".uw-mk--ski") }));
check(s0.n === 856, "856 Airbnb comps loaded (" + s0.n + ")");
check(s0.minRev === null && s0.shown === 856, "no default revenue floor: " + s0.shown + " of 856 shown");
check(/^856\n/.test(s0.hero) && s0.village && s0.peaks, "hero shows the 856 comps; city limits and mountains on by default");
check(s0.labels.some((t) => /Humphreys Peak12,633 ft/.test(t)) && s0.labels.some((t) => /Mount Elden/.test(t)) && s0.downtown && s0.ski, "Humphreys Peak (12,633 ft), Mount Elden, downtown and Arizona Snowbowl marked");

console.log("\n1b. COMP PICKER\n");
await page.click('.uw-qchip[data-g="beds"][data-v="3"]');
await page.click('.uw-qchip[data-g="baths"][data-v="2"]');
await page.waitForTimeout(300);
const q1 = await ev(() => ({ shown: UW.matchSet.size, want: UW.listings.filter((l) => l.bedrooms === 3 && l.baths === 2).length, hash: location.hash,
  n4: +document.querySelector('.uw-qchip[data-g="beds"][data-v="4"] .uw-qchip__n').textContent, want4: UW.listings.filter((l) => l.bedrooms === 4 && l.baths === 2).length }));
check(q1.shown === q1.want && q1.shown > 0 && /beds=3&ba=2/.test(q1.hash), "3 BR + 2 BA chips: " + q1.shown + " comps, in the link (" + q1.hash + ")");
check(q1.n4 === q1.want4, "the 4 BR chip counts the 4 BR / 2 BA homes (" + q1.n4 + ")");
await page.click('.uw-qchip[data-g="beds"][data-v="4"]');
await page.waitForTimeout(200);
check(await ev(() => UW.matchSet.size === UW.listings.filter((l) => (l.bedrooms === 3 || l.bedrooms === 4) && l.baths === 2).length), "chips combine: 3 or 4 BR, 2 BA");
await page.click('.uw-qchip[data-g="beds"][data-v="4"]');
await page.evaluate(() => document.getElementById("uw-map").scrollIntoView());
await ev(() => UW.mapApi.map.setView([35.199, -111.652], 14, { animate: false }));
await page.waitForTimeout(800);
const dotsAt = await ev(() => { const m = UW.mapApi.map, r = m.getContainer().getBoundingClientRect(), out = [], all = UW.listings.map((l) => [l, m.latLngToContainerPoint([l.lat, l.lng])]);
  for (const [l, p] of all) { if (!UW.matchSet.has(l.id) || p.x < 340 || p.x > r.width - 60 || p.y < 60 || p.y > r.height - 90) continue;
    if (all.some(([o, q]) => o !== l && Math.hypot(q.x - p.x, q.y - p.y) < 12)) continue;  // a dot on its own, so the click is unambiguous
    out.push({ id: l.id, x: r.left + p.x, y: r.top + p.y }); if (out.length === 3) break; }
  return out; });
for (const d of dotsAt) { await page.mouse.click(d.x, d.y); await page.waitForTimeout(120); }
const pk1 = await ev(() => [...UW.ui.picked]);
check(dotsAt.length === 3 && dotsAt.every((d) => pk1.includes(d.id)) && pk1.length === 3, "clicking 3 dots selects those 3 comps");
await page.mouse.click(dotsAt[0].x, dotsAt[0].y); await page.waitForTimeout(120);
check(await ev(() => UW.ui.picked.size === 2), "clicking a selected dot removes it");
const ghost = await ev(() => { const m = UW.mapApi.map, r = m.getContainer().getBoundingClientRect(), all = UW.listings.map((l) => [l, m.latLngToContainerPoint([l.lat, l.lng])]);
  for (const [l, p] of all) { if (UW.matchSet.has(l.id) || p.x < 340 || p.x > r.width - 60 || p.y < 60 || p.y > r.height - 90) continue;
    if (all.some(([o, q]) => o !== l && Math.hypot(q.x - p.x, q.y - p.y) < 12)) continue; return { id: l.id, x: r.left + p.x, y: r.top + p.y }; } return null; });
if (ghost) { await page.mouse.click(ghost.x, ghost.y); await page.waitForTimeout(120); }
check(ghost && !(await ev((id) => UW.ui.picked.has(id), ghost.id)), "a filtered-out (grey) dot can't be selected");
const bx = await ev(() => { const r = UW.mapApi.map.getContainer().getBoundingClientRect(); return { x0: r.left + r.width * 0.45, y0: r.top + r.height * 0.3, x1: r.left + r.width * 0.75, y1: r.top + r.height * 0.6 }; });
await page.keyboard.down("Shift");
await page.mouse.move(bx.x0, bx.y0); await page.mouse.down(); await page.mouse.move(bx.x1, bx.y1, { steps: 6 }); await page.mouse.up();
await page.keyboard.up("Shift");
await page.waitForTimeout(300);
const inBox = await ev((b) => { const m = UW.mapApi.map, r = m.getContainer().getBoundingClientRect();
  return UW.listings.filter((l) => { if (!UW.matchSet.has(l.id)) return false; const p = m.latLngToContainerPoint([l.lat, l.lng]); return r.left + p.x >= b.x0 && r.left + p.x <= b.x1 && r.top + p.y >= b.y0 && r.top + p.y <= b.y1; }).map((l) => l.id); }, bx);
const pk2 = await ev(() => [...UW.ui.picked]);
const pkOk = await ev(() => [...UW.ui.picked].every((id) => UW.matchSet.has(id)));
check(inBox.length > 0 && inBox.every((id) => pk2.includes(id)) && pkOk, "Shift + drag selects all " + inBox.length + " comps shown in the box (" + pk2.length + " selected)");
await page.click('.uw-tray [data-tr="copy"]'); await page.waitForTimeout(200);
const tr = (await clip()).split("\n");
check(tr.length === pk2.length && tr.every((l) => l.split("\t").length === 15) && tr.every((l, i) => !i || +l.split("\t")[1] <= +tr[i - 1].split("\t")[1]), "tray Copy for UW sheet: " + tr.length + " rows, 15 columns, revenue high to low");
await page.click('.uw-tray [data-tr="list"]'); await page.waitForTimeout(700);
check(await page.locator(".uw-clist__t tbody tr").count() === pk2.length, "Open comp list: the table lists the " + pk2.length + " selected comps");
await page.click('[data-l="fmt"][data-v="sheet"]'); await page.waitForTimeout(100);
await page.check('[data-l="header"]'); await page.waitForTimeout(100);
await page.click('[data-l="copy-all"]'); await page.waitForTimeout(200);
const lh = (await clip()).split("\n");
check(lh[0] === ["Listing URL", "Revenue Potential", "Bedrooms", "Sleeps", "ADR", "Occupancy"].concat(UWJ.compHeader.slice(6, 14), ["Notes"]).join("\t") && lh.slice(1).join("\n") === tr.join("\n"),
  "list copy with header: the sheet's own column names, then the same rows as the tray");
await page.click('[data-l="fmt"][data-v="full"]'); await page.waitForTimeout(100);
await page.click('[data-l="copy-all"]'); await page.waitForTimeout(200);
const lf = (await clip()).split("\n");
check(lf.length === pk2.length + 1 && lf[0].startsWith("Listing URL\tTitle\tRevenue Potential\tBedrooms\tBaths\tSleeps") && lf.slice(1).every((l) => l.split("\t").length === lf[0].split("\t").length), "Full details: header + " + (lf.length - 1) + " rows, " + lf[0].split("\t").length + " columns each");
await page.uncheck('[data-l="header"]'); await page.click('[data-l="fmt"][data-v="sheet"]');
await page.click('.uw-clist__t tbody tr:first-child input[data-l="tick"]'); await page.waitForTimeout(200);
check(await ev((n) => UW.ui.picked.size === n - 1, pk2.length), "unticking a row removes it from the selection");
await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(600);
check(await ev((n) => UW.ui.picked.size === n - 1 && location.hash.includes("beds=3"), pk2.length), "selection and filters survive a reload");
await ev(() => { UW.clearPicked(); UW.resetFilters(); });
await page.waitForTimeout(200);

console.log("\n2. ADD A ZILLOW LISTING\n");
const URL_ = "https://www.zillow.com/homedetails/1234-Toho-Trl-Kachina-Village-AZ-86001/99999999_zpid/";
await page.click("#uw-add-btn");
await page.fill("#f-url", URL_);
await page.dispatchEvent("#f-url", "input");
check((await page.inputValue("#f-addr")) === "1234 Toho Trl, Kachina Village, AZ 86001", "address read from the Zillow link: " + (await page.inputValue("#f-addr")));
check(/Blank sheet/.test(await page.locator("#f-tpl option:checked").innerText()), "starts from the blank sheet by default");
await page.fill("#f-price", "289000");
await page.fill("#f-beds", "3");
await page.fill("#f-baths", "2");
await page.fill("#f-sqft", "1800");
await page.click("details.uw-dlg__more summary");
await page.check("#f-tub");
await page.click(".uw-dlg__foot button[type=submit]");
await page.waitForSelector("#uw-place-bar:not([hidden])");
// Let the map finish flying (a click mid-animation can miss), then place the pin by the
// Kachina Village homes, by clicking the map there.
await page.waitForTimeout(900);
await page.waitForFunction(() => { const m = UW.mapApi.map; return !m._animatingZoom && !(m._panAnim && m._panAnim._inProgress) && !m._flyToFrame; });
const spot = await ev(() => { const l = UW.listings.find((x) => x.area === "kachina" && x.lat > 35.08 && x.lat < 35.1); return [l.lat, l.lng + 0.0008]; });
await ev((spot) => { UW.mapApi.map.setView(spot, 16, { animate: false }); }, spot);
await page.waitForTimeout(200);
const pt = await ev((spot) => { const p = UW.mapApi.map.latLngToContainerPoint(spot); const r = document.getElementById("uw-leaflet").getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, spot);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(300);
await page.click("#uw-place-bar [data-act=place-cancel]");
await page.waitForTimeout(400);
const pid = "z99999999";
const t1 = await ev((pid) => { const p = UW.property(pid); return p && { geo: p.geo, place: p.place, beds: p.versions[0].profile.beds, hotTub: p.versions[0].profile.flags.hot_tub, opexMissing: p.versions[0].outputs.opexMissing, checks: p.versions[0].checks.map((c) => c.kind) }; }, pid);
check(!!t1 && !!t1.geo, "the listing is saved and pinned");
const st1 = await ev((pid) => { const s = UW.property(pid).versions[0].inputs.setup; return UWRules.STANDARD_SETUP.map((x) => { const m = s.find((y) => UWRules.setupKey(y.label) === UWRules.setupKey(x.label)); return m ? m.label + " " + m.amount : "MISSING " + x.label; }); }, pid);
check(st1.every((x) => !/^MISSING|null$/.test(x)), "the new sheet carries the five standard setup lines: " + st1.join(" · "));
check(t1 && t1.place && t1.place.zone === "kachina" && t1.place.loc === "Outside the city" && t1.place.areaName === "Kachina Village & Mountainaire", "pin reads Kachina Village & Mountainaire, outside the city: " + JSON.stringify(t1 && t1.place));
check(t1 && t1.beds === 3 && t1.hotTub === 1, "target profile: 3 bedrooms, hot tub from the notes (“Existing hot tub”)");
check(t1 && !t1.opexMissing, "OPEX starts priced (Galveston 101's amounts, rounded), so returns compute once revenue is set");

console.log("\n3. MATCH BY LOCATION / AMENITIES\n");
await ev((pid) => UW.select(pid), pid);
await page.waitForTimeout(500);
const loc = await ev((pid) => { const p = UW.property(pid); return UW.results(p).map((x) => ({ id: x.l.id, d: x.d, town: x.l.town, beds: x.l.bedrooms, rev: x.l.revenue, pos: x.l.loc })); }, pid);
const locZ = await ev((pid) => UW.results(UW.property(pid)).every((x) => x.l.zone === "kachina"), pid);
check(loc.length > 0 && locZ && loc.every((x) => Math.abs(x.beds - 3) <= 1 && x.pos === "Outside the city"), loc.length + " location matches: all Kachina Village & Mountainaire, outside the city, 2–4 BR");
check(loc.every((x, i) => !i || x.d >= loc[i - 1].d), "nearest first");
const panelRows = await page.locator("#uw-p-comps .uw-near li, #uw-p-comps [data-id]").count();
check(panelRows > 0, "the panel lists the matches");
const all0 = await ev((pid) => { UW.ui.n = 5000; return UW.results(UW.property(pid)).length; }, pid);
await page.click("#uw-p-comps input[data-rule=zone]");
await page.waitForTimeout(300);
const widerN = await ev((pid) => UW.results(UW.property(pid)).length, pid);
const widerTown = await ev((pid) => UW.results(UW.property(pid)).some((x) => x.l.zone !== "kachina"), pid);
check(widerN > all0 && widerTown, "“Same area” off: " + widerN + " matches, other areas included (was " + all0 + ", Kachina Village only)");
await page.click("#uw-p-comps input[data-rule=zone]");
// The setting on the card: "In the city" keeps the match to in-city homes (area rule off).
await ev((pid) => { UW.ui.cardTab[pid] = "property"; UW.ui.expanded.add(pid); UW.cardsApi.renderCard(pid); }, pid);
await page.waitForTimeout(300);
await page.selectOption("#uw-card-" + pid + " select[data-wf]", "City");
await page.waitForTimeout(400);
await ev(() => { UW.ui.locRules.zone = false; UW.emit("near"); });
const gf = await ev((pid) => { const p = UW.property(pid); return { wf: p.waterfront, loc: p.place.loc, all: UW.results(p).map((x) => x.l.loc) }; }, pid);
check(gf.wf === "City" && gf.loc === "In the city" && gf.all.length > 0 && gf.all.every((x) => x === "In the city"), "setting set to In the city: " + gf.all.length + " matches, all in the city");
await ev(() => { UW.ui.locRules.zone = true; UW.emit("near"); });
await page.selectOption("#uw-card-" + pid + " select[data-wf]", "Outside");
await page.waitForTimeout(300);
await ev((pid) => { UW.ui.expanded.delete(pid); UW.cardsApi.renderCard(pid); }, pid);
await ev(() => { UW.ui.n = 12; });
await page.click('#uw-p-comps [data-act=mode][data-v=amenity]');
await page.waitForTimeout(300);
const am = await ev((pid) => { UW.ui.n = 5000; return UW.results(UW.property(pid)).length; }, pid);
check(am === 856, "Match by amenities ranks all 856 homes");
await ev(() => { UW.ui.n = 12; UW.setMode("location"); });
await page.waitForTimeout(300);

console.log("\n3b. VIEW CONTROL (declutter)\n");
await ev(() => { document.querySelector(".uw-viewctl details").open = true; });
await page.click(".uw-viewctl [data-view=clean]");
await page.waitForTimeout(300);
const vc = await ev(() => ({ score: UW.ui.score, L: UW.ui.layers, saved: JSON.parse(localStorage.getItem("flagstaffUW.view") || "null"), outlines: document.querySelectorAll(".uw-area-label").length }));
check(vc.score === "hideLow" && !vc.L.areas && !vc.L.labels && vc.L.village && vc.L.peaks && !vc.L.ghosts && !vc.L.ring && vc.L.ranks && vc.saved && vc.saved.score === "hideLow",
  "Clean map: bottom 25% and filtered-out dots hidden, outlines / names / search ring off, city limits, mountains and rank numbers kept, remembered");
await page.click('.uw-viewctl [data-view=score][data-v=top]');
await page.waitForTimeout(300);
const vis = await ev(() => { const ranked = new Set(UW.mapApi.lastNearest.map((x) => x.l.id)); let lowShown = 0, rankedHidden = 0;
  UW.mapApi.map.eachLayer((m) => { if (!m.listing) return; const on = m.options.fillOpacity > 0; if (on && m.listing.sizeTier !== "Top 25% for its size" && !ranked.has(m.listing.id)) lowShown++; if (!on && ranked.has(m.listing.id)) rankedHidden++; });
  return { lowShown, rankedHidden, ranked: ranked.size, badges: document.querySelectorAll(".uw-rank").length }; });
check(vis.lowShown === 0 && vis.rankedHidden === 0 && vis.badges === vis.ranked, "Top 25% only: no other dot drawn, all " + vis.ranked + " ranked matches still shown with their numbers");
await page.click(".uw-viewctl [data-view=all]");
await page.waitForTimeout(300);
const va = await ev(() => UW.ui.score === "all" && ["areas", "labels", "ghosts", "ranks", "ring", "village", "peaks", "places"].every((k) => UW.ui.layers[k]));
check(va, "Show everything restores every dot and marking");

console.log("\n4. COPY, ADD, DOWNLOAD\n");
const first = loc[0].id;
await ev((id) => UW.mapApi.openListing(id), first);
await page.waitForTimeout(300);
await page.waitForSelector(".uw-pop [data-act=pop-copy]");
await page.click(".uw-pop [data-act=pop-copy]");
await page.waitForTimeout(200);
const popLine = await clip();
check(popLine.split("\t").length === 15 && popLine.includes("/rooms/" + first) && /^\S+\t\d+\t/.test(popLine), "popup Copy row: one 15-column sheet row");
check(/\[Location match\] [\d.]+ mi from 1234 Toho Trl · /.test(popLine), "its note says how it was found and how far: " + popLine.split("\t")[14]);
await page.click(".uw-pop [data-act=pop-add]");
await page.waitForTimeout(300);
await ev(([pid, ids]) => UW.actions.addComps(pid, "Draft", ids.map((i) => UW.byId.get(i))), [pid, loc.slice(1, 4).map((x) => x.id)]);
await page.waitForTimeout(300);
const set = await ev((pid) => UW.property(pid).versions[0].comps.map((c) => c.revenue), pid);
check(set.length === Math.min(4, loc.length) && set.every((r, i) => !i || r <= set[i - 1]), "comp set holds " + set.length + " rows, revenue high to low");
await ev((pid) => UW.actions.copyComps(pid), pid);
await page.waitForTimeout(200);
const lines = (await clip()).split("\n");
check(lines.length === set.length && lines.some((l) => l.split("\t").slice(0, 14).join("\t") === popLine.split("\t").slice(0, 14).join("\t")), "Copy comps gives the same row as the popup");
const [dl] = await Promise.all([page.waitForEvent("download"), ev((pid) => UW.actions.downloadCsv(pid), pid)]);
const csv = readFileSync(await dl.path(), "utf8");
check(C.amortBlock(csv) === C.amortBlock(TEMPLATE), "Download UW CSV: amortization block byte-identical to the template");
const P = C.parse(csv), L = C.locate(P.rows);
const revs = [];
for (let i = L.comps.first; i <= L.comps.last; i++) if (P.rows[i][L.comps.col]) revs.push(+P.rows[i][L.comps.col + 1].replace(/[$,]/g, ""));
check(revs.length === set.length && revs.every((r, i) => !i || r <= revs[i - 1]), "its comp rows in revenue order (" + revs.length + ")");
check([[5, "Furniture / Decor / Essentials"], [16, "Misc"], [17, "CoHost Essentials"], [18, "Design/Project Management"], [19, "Install/Staging/Warehousing"]]
  .every(([r, lab]) => P.rows[r - 1][L.setup.col].trim() === lab && P.rows[r - 1][L.setup.col + 1].trim() !== ""), "the downloaded sheet has the five standard setup lines in rows 5 and 16–19, priced");
check(P.rows[L.price[0]][L.price[1]] === " $ 289,000 " && P.rows[L.url[0]][L.url[1]] === URL_, "price and Zillow URL written; file " + dl.suggestedFilename());

console.log("\n5. OPEX AND RETURNS\n");
await ev((pid) => { const v = UW.property(pid).versions[0]; const inp = JSON.parse(JSON.stringify(v.inputs)); inp.revenue = { low: 60000, mid: 75000, high: 90000 }; UW.setInputs(pid, "Draft", inp); }, pid);
const g1 = await ev((pid) => UW.property(pid).versions[0].outputs.cases.mid.coc, pid);
const ox = await ev((pid) => { const v = UW.property(pid).versions[0]; return { m: v.outputs.opexMonthly, lines: v.inputs.opex.filter((o) => !o.cleaning && o.amount == null).length }; }, pid);
const sd = await ev((pid) => { const v = UW.property(pid).versions[0].inputs, g = (l) => v.opex.find((o) => /^\s*/.test(o.label) && o.label.trim().toLowerCase() === l).amount; return [v.cleaningCost, v.cleaningTurns, g("capex reserve"), g("insurance hoi"), g("household supplies"), g("internet"), g("pest control"), g("utilities")]; }, pid);
check(sd.join() === [175, 7, 350, 250, 175, 100, 60, 525].join(), "3 BR / 1,800 sqft size defaults: cleaning $175 x 7 turns, CapEx $350, insurance $250, supplies $175; internet $100, pest $60, utilities $525 (the 2,000 sqft row): " + sd.join(", "));
check(g1 != null && ox.m === 3885 && ox.lines === 0, "revenue entered: cash on cash computes straight away; OPEX $" + ox.m + "/month with the size defaults, no empty line");
await ev((pid) => { const v = UW.property(pid).versions[0]; const inp = JSON.parse(JSON.stringify(v.inputs)); inp.opex.find((o) => /Utilities/i.test(o.label)).amount = 400; UW.setInputs(pid, "Draft", inp); }, pid);
const g2 = await ev((pid) => { const v = UW.property(pid).versions[0]; return { coc: v.outputs.cases.mid.coc, missing: !!v.outputs.opexMissing }; }, pid);
check(g2.coc != null && !g2.missing, "editing an OPEX line recalculates cash on cash (" + (g2.coc * 100).toFixed(2) + "% mid)");
await ev((pid) => { UW.ui.cardTab[pid] = "sheet"; UW.ui.expanded.add(pid); UW.cardsApi.renderCard(pid); }, pid);
await page.waitForTimeout(800);
check(await page.locator("#uw-card-" + pid).isVisible(), "the target's card renders with its Sheet tab");

console.log("\n6. LAYERS, LINKS, PHONE\n");
await ev(() => { UW.ui.colorBy = "loc"; UW.mapApi.refresh(); });
const legend = await ev(() => document.querySelector(".uw-legend").textContent);
check(/Setting/.test(legend) && /Downtown/.test(legend) && /In the city/.test(legend) && /Outside the city/.test(legend), "colour by setting: legend lists the three settings");
await ev(() => { UW.ui.layers.village = false; UW.mapApi.layers(); UW.ui.layers.village = true; UW.mapApi.layers(); });
const hash = await ev(() => location.hash);
check(/p=z99999999/.test(hash), "the URL carries the selected target: " + hash);
const page2 = await ctx.newPage();
page2.on("pageerror", (e) => errors.push("page2: " + e.message));
await page2.goto(BASE + "underwritten.html" + hash, { waitUntil: "networkidle" });
await page2.waitForTimeout(600);
check(await page2.evaluate(() => UW.ui.selected === "z99999999"), "opening that link selects the same target (same browser)");
await page2.close();
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 420, height: 860 });
phone.on("pageerror", (e) => errors.push("phone: " + e.message));
await phone.goto(BASE + "underwritten.html", { waitUntil: "networkidle" });
await phone.waitForTimeout(600);
const ph = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, mapH: document.getElementById("uw-leaflet").getBoundingClientRect().height }));
check(ph.sw <= ph.cw + 1 && ph.mapH > 250, "phone 420 px: no sideways scroll (" + ph.sw + " / " + ph.cw + "), map " + Math.round(ph.mapH) + " px tall");
await phone.close();
const redirect = await ctx.newPage();
await redirect.goto(BASE + "index.html#p=z99999999", { waitUntil: "networkidle" });
check(/underwritten\.html#p=z99999999$/.test(redirect.url()), "index.html forwards to the map, keeping the link: " + redirect.url().replace(BASE, ""));
await redirect.close();

check(errors.length === 0, "no console errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
server.close();
console.log(`\n${failures ? failures + " FAILURE" + (failures === 1 ? "" : "S") : "All browser checks passed"}.`);
process.exit(failures ? 1 : 0);
