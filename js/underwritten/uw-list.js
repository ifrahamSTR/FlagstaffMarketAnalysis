/**
 * Two comp-picking helpers for the Flagstaff page.
 *
 * Quick bar (above the map): bedrooms, bathrooms and setting as tap-to-toggle
 * chips, each with how many comps it would show, plus a revenue floor. They write
 * the same filters as the panel's Filters tab, so the map, panel and list follow.
 *
 * Comp list (below the map): a sortable table of
 *   - the comps you selected (map click, box select, panel ticks), or
 *   - every comp the filters show on the map, or
 *   - the selected target's ranked matches,
 * with a tick box per row (= the shared selection) and copy buttons for Excel:
 *   UW sheet rows: the sheet's 15 comp columns (URL, revenue, bedrooms, sleeps,
 *     ADR, occupancy, 8 amenity 0/1 flags, notes), revenue high to low, no header,
 *     the same text every other copy on the page produces (UWCsv.compsTSV);
 *   Full details: every column of the table, in the table's order, header optional.
 * Download CSV gives the rows in view with every column.
 */
/* global UWCsv, UWGeo, UWRules */
(function () {
  const UW = window.UW, F = UW.fmt, E = UW.esc;
  const A = (UW.listApi = {});
  const PREF_KEY = "flagstaffUW.listPrefs";
  const st = { view: "picked", sort: { key: "revenue", dir: -1 }, format: "sheet", header: false };
  let quick, host;

  function loadPrefs() {
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); if (p) { if (["picked", "shown", "matches"].includes(p.view)) st.view = p.view; if (p.format === "full" || p.format === "sheet") st.format = p.format; st.header = !!p.header; if (p.sort && COLS.some((c) => c.key === p.sort.key)) st.sort = p.sort; } } catch (e) { /* defaults */ }
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(st)); } catch (e) { /* this session only */ } }

  // ---------------------------------------------------------------------------
  // Quick bar
  // ---------------------------------------------------------------------------
  // How many comps a chip would show: the current filters with this one group set to just that value.
  function countWith(patch) {
    const f = Object.assign({}, UW.ui.filters, patch);
    let n = 0;
    for (const l of UW.listings) if (UW.matches(l, f)) n++;
    return n;
  }
  function chipGroup(g, opts, label) {
    const cur = UW.ui.filters[g] || [];
    const any = '<button type="button" class="uw-qchip uw-qchip--any" data-q="any" data-g="' + g + '" aria-pressed="' + !cur.length + '">Any</button>';
    return '<div class="uw-qgroup" role="group" aria-label="' + E(label) + '"><span class="uw-qgroup__l">' + E(label) + "</span>" + any +
      opts.map(([v, t, dot]) => {
        const n = countWith({ [g]: [v] }), on = cur.includes(v);
        return '<button type="button" class="uw-qchip" data-q="chip" data-g="' + g + '" data-v="' + E(v) + '" aria-pressed="' + on + '"' + (!n && !on ? " disabled" : "") +
          ' title="' + n + " comp" + (n === 1 ? "" : "s") + " with the other filters" + '">' + (dot ? '<span class="uw-dot" style="background:' + dot + '"></span>' : "") + E(t) + '<span class="uw-qchip__n">' + n + "</span></button>";
      }).join("") + "</div>";
  }
  function renderQuick() {
    if (!quick) return;
    const f = UW.ui.filters, C = UW.data.comps;
    const n = UW.matchSet.size, other = UW.countActiveFilters() - ((f.beds.length ? 1 : 0) + (f.baths.length ? 1 : 0) + (f.loc.length ? 1 : 0) + (f.minRev != null && f.minRev !== UW.defaultFilters().minRev ? 1 : 0));
    const a = document.activeElement, key = a && quick.contains(a) ? a.getAttribute("data-qf") : null;
    quick.innerHTML = '<div class="uw-quick__row">' +
      chipGroup("beds", UW.BED_OPTS, "Bedrooms") + chipGroup("baths", UW.BATH_OPTS, "Baths") + "</div>" +
      '<div class="uw-quick__row">' + chipGroup("loc", C.locOrder.map((l) => [l, l, UW.LOC_COLORS[l]]), "Setting") +
      '<label class="uw-qrev">Revenue ≥ <span class="uw-money-in"><span>$</span><input type="number" min="0" step="5000" value="' + (f.minRev == null ? "" : f.minRev) + '" placeholder="any" data-qf="minRev" inputmode="numeric" aria-label="Minimum revenue potential"></span></label>' +
      '<span class="uw-quick__count"><strong>' + n + "</strong> of " + UW.listings.length + " comps shown" + (other > 0 ? ' · <button type="button" class="uw-linkbtn" data-q="filters">' + other + " more filter" + (other === 1 ? "" : "s") + " in the panel</button>" : "") +
      (UW.countActiveFilters() ? ' · <button type="button" class="uw-linkbtn" data-q="reset">reset</button>' : "") + "</span></div>";
    if (key) { const el = quick.querySelector('[data-qf="' + key + '"]'); if (el) el.focus(); }
  }
  function onQuickClick(e) {
    const b = e.target.closest("[data-q]");
    if (!b || b.disabled) return;
    const k = b.dataset.q, g = b.dataset.g, f = UW.ui.filters;
    if (k === "any") UW.setFilters({ [g]: [] });
    else if (k === "chip") {
      const v = g === "loc" ? b.dataset.v : +b.dataset.v;
      const cur = f[g] || [];
      UW.setFilters({ [g]: cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat([v]).sort((x, y) => (typeof x === "number" ? x - y : 0)) });
    } else if (k === "reset") UW.resetFilters();
    else if (k === "filters") { UW.panelApi.showTab("filters"); document.getElementById("uw-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  function onQuickChange(e) {
    const t = e.target;
    if (t.dataset.qf === "minRev") { const v = t.value === "" ? null : Number(t.value); UW.setFilters({ minRev: v != null && v >= 0 ? v : null }); }
  }

  // ---------------------------------------------------------------------------
  // Comp list
  // ---------------------------------------------------------------------------
  const target = () => (UW.ui.selected ? UW.property(UW.ui.selected) : null);
  const distOf = (l, p) => (p && p.geo ? UWGeo.miles(p.geo.lat, p.geo.lng, l.lat, l.lng) : null);
  const SHEET_FLAGS = () => (target() ? UW.flagsOf(UW.activeVersion(target())) : UW.data.uw.sheetFlags);
  // The sheet's own column name for an amenity flag (newer sheets say Firepit / Outdoor Dining / Pack and Play).
  const FLAG_HEAD = Object.fromEntries(Object.entries(UWCsv.FLAG_COL).filter(([h]) => !h.startsWith("HAS_") && h !== "Fire pit").map(([h, f]) => [f, h]));
  const flagHead = (f) => FLAG_HEAD[f] || "HAS_" + f;
  // Table columns; "copy" gives the cell in a Full details copy / CSV (plain values Excel reads as numbers).
  const COLS = [
    { key: "title", label: "Listing", sort: (l) => l.title.toLowerCase(), cell: (l) => '<a href="' + E(l.url) + '" target="_blank" rel="noopener">' + E(l.title) + "</a>", copy: (l) => l.title, head: "Title" },
    { key: "revenue", label: "Revenue", num: true, sort: (l) => l.revenue, cell: (l) => F.money(l.revenue), copy: (l) => Math.round(l.revenue), head: "Revenue Potential" },
    { key: "bedrooms", label: "BR", num: true, sort: (l) => l.bedrooms, cell: (l) => (l.bedrooms === 0 ? "Studio" : F.num(l.bedrooms)), copy: (l) => l.bedrooms, head: "Bedrooms" },
    { key: "baths", label: "BA", num: true, sort: (l) => l.baths, cell: (l) => F.num(l.baths), copy: (l) => l.baths, head: "Baths" },
    { key: "sleeps", label: "Sleeps", num: true, sort: (l) => l.sleeps, cell: (l) => F.num(l.sleeps), copy: (l) => l.sleeps, head: "Sleeps" },
    { key: "adr", label: "ADR", num: true, sort: (l) => l.adr, cell: (l) => F.money(l.adr), copy: (l) => Number(l.adr).toFixed(2), head: "ADR" },
    { key: "occ", label: "Occ.", num: true, sort: (l) => l.occ, cell: (l) => F.pct(l.occ, 0), copy: (l) => (l.occ * 100).toFixed(2) + "%", head: "Occupancy" },
    { key: "amen", label: "Amenities", sort: (l) => -l.flags.length, cell: (l) => '<span class="uw-clist__am">' + UW.ICON_ORDER.filter((k) => l.flagSet.has(k)).map((k) => UW.icon(k)).join("") + "</span>",
      copy: (l) => UW.ICON_ORDER.filter((k) => l.flagSet.has(k)).map((k) => UW.AMEN_LABEL[k]).join(", "), head: "Amenities" },
    { key: "loc", label: "Setting", sort: (l) => UW.data.comps.locOrder.indexOf(l.loc), cell: (l) => '<span class="uw-dot" style="background:' + UW.LOC_COLORS[l.loc] + '"></span>' + E(l.loc), copy: (l) => l.loc, head: "Setting" },
    { key: "area", label: "Area", sort: (l) => UW.areas.findIndex((a) => a.id === l.area), cell: (l) => E(UW.areaById[l.area].name), copy: (l) => UW.areaById[l.area].name, head: "Area" },
    { key: "dist", label: "Distance", num: true, sort: (l) => { const d = distOf(l, target()); return d == null ? l.beachKm : d; },
      cell: (l) => { const d = distOf(l, target()); return d == null ? F.km(l.beachKm) + ' <span class="muted">downtown</span>' : F.mi(d); },
      copy: (l) => { const d = distOf(l, target()); return d == null ? l.beachKm.toFixed(2) : d.toFixed(2); }, head: () => (target() && target().geo ? "Miles to " + target().street : "km to downtown") },
    { key: "snow", label: "Snowbowl", num: true, sort: (l) => l.snowKm, cell: (l) => F.km(l.snowKm), copy: (l) => l.snowKm.toFixed(1), head: "km to Snowbowl" },
    { key: "rating", label: "Rating", num: true, sort: (l) => l.rating || 0, cell: (l) => (l.rating ? "★ " + F.num(l.rating) + ' <span class="muted">(' + (l.reviews || 0) + ")</span>" : "—"), copy: (l) => (l.rating == null ? "" : l.rating), head: "Rating" },
  ];

  function rowsFor(view) {
    const p = target();
    if (view === "picked") return [...UW.ui.picked].map((id) => UW.byId.get(id)).filter(Boolean);
    if (view === "matches") return p ? UW.results(p).map((x) => x.l) : [];
    return UW.listings.filter((l) => UW.matchSet.has(l.id));
  }
  function sorted(rows) {
    const c = COLS.find((x) => x.key === st.sort.key) || COLS[1], d = st.sort.dir;
    return rows.map((l, i) => [l, i]).sort((a, b) => {
      const x = c.sort(a[0]), y = c.sort(b[0]);
      return (x < y ? -1 : x > y ? 1 : 0) * d || b[0].revenue - a[0].revenue || a[1] - b[1];
    }).map((x) => x[0]);
  }

  // The copy text. Sheet rows go through the page's one comp-row path (UW.copyListings / UWCsv.compsTSV).
  function fullTSV(rows, header) {
    const p = target(), flags = SHEET_FLAGS();
    const cols = [["Listing URL", (l) => l.url]].concat(COLS.map((c) => [typeof c.head === "function" ? c.head() : c.head, c.copy]),
      flags.map((f) => [flagHead(f), (l) => (l.flagSet.has(f) ? 1 : 0)]), [["Mountain view", (l) => (l.flagSet.has("mountain_view") ? 1 : 0)], ["Notes", (l) => UW.noteFor(l, p)]]);
    const clean = (s) => String(s == null ? "" : s).replace(/[\t\r\n]+/g, " ").trim();
    const lines = rows.map((l) => cols.map((c) => clean(c[1](l))).join("\t"));
    return (header ? [cols.map((c) => c[0]).join("\t")] : []).concat(lines).join("\n");
  }
  function sheetHeader() { return UWCsv.COMP_HEADER.slice(0, 6).concat(SHEET_FLAGS().map(flagHead), ["Notes"]).join("\t"); }
  function copyRows(rows, what) {
    if (!rows.length) { UW.toast("Nothing to copy", "warn"); return; }
    const p = target();
    if (st.format === "sheet") {
      const tsv = UWCsv.compsTSV(rows.filter((l) => UW.canPick(l.id)).map((l) => UWRules.rowFromListing(l, UW.noteFor(l, p))), SHEET_FLAGS());
      UW.copy((st.header ? sheetHeader() + "\n" : "") + tsv, rows.length + " comp row" + (rows.length === 1 ? "" : "s") + " " + what + " for the UW sheet (15 columns" + (st.header ? " + header" : "") + "), revenue high to low");
    } else UW.copy(fullTSV(sorted(rows), st.header), rows.length + " comp row" + (rows.length === 1 ? "" : "s") + " " + what + " with every column" + (st.header ? " + header" : "") + ", in the table’s order");
  }
  function downloadCsv(rows) {
    if (!rows.length) { UW.toast("Nothing to download", "warn"); return; }
    const tsv = fullTSV(sorted(rows), true);
    const csv = tsv.split("\n").map((line) => line.split("\t").map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(",")).join("\r\n");
    UW.download("flagstaff-comps-" + (st.view === "picked" ? "selected" : st.view) + ".csv", "﻿" + csv);
  }

  function render() {
    if (!host) return;
    const p = target();
    if (st.view === "matches" && !p) st.view = "picked";
    const rows = sorted(rowsFor(st.view));
    const nPick = UW.ui.picked.size, nShown = UW.matchSet.size, nMatch = p ? UW.results(p).length : 0;
    const checkedHere = rows.filter((l) => UW.ui.picked.has(l.id));
    const tab = (v, t, n, dis) => '<button type="button" data-l="view" data-v="' + v + '" aria-pressed="' + (st.view === v) + '"' + (dis ? " disabled" : "") + ">" + t + ' <span class="uw-clist__n">' + n + "</span></button>";
    const sheetCols = UWCsv.COMP_HEADER.slice(0, 6).concat(SHEET_FLAGS().map(flagHead), ["Notes"]);
    const fmtNote = st.format === "sheet" ?
      "Pastes into the UW sheet’s comp table: " + sheetCols.map((c) => "<code>" + E(c) + "</code>").join(" ") + ". Always revenue high to low; occupancy as a %, amenities as 1 / 0." :
      "Every column below plus the URL, the sheet’s amenity 1 / 0 columns, mountain view and the note, in the table’s current order.";
    const head = '<div class="uw-clist__bar">' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost uw-clist__back" data-l="back" title="Scroll back up to the map">↑ Back to map</button>' +
      '<div class="uw-seg" role="group" aria-label="Which comps to list">' + tab("picked", "Selected", nPick) + tab("shown", "All shown on the map", nShown) +
      (p ? tab("matches", "Matches for " + E(p.street), nMatch, !nMatch) : "") + "</div>" +
      '<div class="uw-clist__copy"><span class="uw-seg uw-seg--sm" role="group" aria-label="Copy format">' +
      '<button type="button" data-l="fmt" data-v="sheet" aria-pressed="' + (st.format === "sheet") + '">UW sheet rows</button>' +
      '<button type="button" data-l="fmt" data-v="full" aria-pressed="' + (st.format === "full") + '">Full details</button></span>' +
      '<label class="uw-check uw-check--inline"><input type="checkbox" data-l="header"' + (st.header ? " checked" : "") + "> Header row</label>" +
      (st.view === "picked" ? "" : '<button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-l="copy-checked"' + (checkedHere.length ? "" : " disabled") + ">Copy ticked (" + checkedHere.length + ")</button>") +
      '<button type="button" class="uw-btn uw-btn--small ' + (st.view === "picked" ? "uw-btn--primary" : "uw-btn--ghost") + '" data-l="copy-all"' + (rows.length ? "" : " disabled") + ">Copy " + (st.view === "picked" ? "all selected" : "all " + rows.length + " rows") + (st.view === "picked" ? " (" + rows.length + ")" : "") + "</button>" +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-l="csv"' + (rows.length ? "" : " disabled") + ">Download CSV</button>" +
      (nPick ? '<button type="button" class="uw-linkbtn" data-l="clear">Clear selection</button>' : "") + "</div></div>" +
      '<p class="uw-hint uw-clist__fmt">' + fmtNote + "</p>";
    if (!rows.length) {
      host.innerHTML = head + '<p class="uw-empty">' + (st.view === "picked" ? "No comps selected yet. Click dots on the map (or Shift + drag a box over them), tick rows under “All shown on the map”, or tick comps in the panel." :
        st.view === "matches" ? "No matches for this target with the current rules and filters." : "No comp passes the current filters. Clear a bedroom or bath chip above the map.") + "</p>";
      return;
    }
    const allTicked = rows.every((l) => UW.ui.picked.has(l.id));
    const th = (c) => '<th scope="col" class="' + (c.num ? "uw-num" : "") + '"><button type="button" data-l="sort" data-k="' + c.key + '" aria-sort="' + (st.sort.key === c.key ? (st.sort.dir > 0 ? "ascending" : "descending") : "none") + '">' +
      E(c.label) + (st.sort.key === c.key ? (st.sort.dir > 0 ? " ↑" : " ↓") : "") + "</button></th>";
    const body = rows.map((l, i) => {
      const on = UW.ui.picked.has(l.id);
      return '<tr data-id="' + l.id + '"' + (on ? ' class="is-on"' : "") + '><td class="uw-clist__tick"><input type="checkbox" data-l="tick" data-id="' + l.id + '"' + (on ? " checked" : "") + ' aria-label="Select ' + E(l.title) + '"></td>' +
        '<td class="uw-num"><button type="button" class="uw-linkbtn" data-l="locate" data-id="' + l.id + '" title="Show it on the map">' + (i + 1) + "</button></td>" +
        COLS.map((c) => '<td class="' + (c.num ? "uw-num" : "") + (c.key === "title" ? " uw-clist__title" : "") + '">' + c.cell(l) + "</td>").join("") + "</tr>";
    }).join("");
    host.innerHTML = head + '<div class="uw-clist__wrap"><table class="uw-clist__t"><thead><tr><th scope="col" class="uw-clist__tick"><input type="checkbox" data-l="tickall"' + (allTicked ? " checked" : "") + ' aria-label="Select every row in this list"></th><th scope="col" class="uw-num">#</th>' +
      COLS.map(th).join("") + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function onClick(e) {
    const b = e.target.closest("[data-l]");
    if (!b || b.disabled || b.type === "checkbox") return;
    const k = b.dataset.l;
    const rows = () => sorted(rowsFor(st.view));
    if (k === "view") { st.view = b.dataset.v; savePrefs(); render(); }
    else if (k === "fmt") { st.format = b.dataset.v; savePrefs(); render(); }
    else if (k === "sort") { const key = b.dataset.k; st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: COLS.find((c) => c.key === key).num ? -1 : 1 }; savePrefs(); render(); }
    else if (k === "copy-all") copyRows(rows(), st.view === "picked" ? "selected" : "in this list");
    else if (k === "copy-checked") copyRows(rows().filter((l) => UW.ui.picked.has(l.id)), "ticked");
    else if (k === "csv") downloadCsv(rows());
    else if (k === "clear") UW.clearPicked();
    else if (k === "back") document.getElementById("uw-map").scrollIntoView({ behavior: "smooth", block: "start" });
    else if (k === "locate") { document.getElementById("uw-map").scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => UW.mapApi.openListing(b.dataset.id), 350); }
  }
  function onChange(e) {
    const t = e.target, k = t.dataset.l;
    if (k === "header") { st.header = t.checked; savePrefs(); render(); }
    else if (k === "tick") UW.togglePick(t.dataset.id, t.checked);
    else if (k === "tickall") UW.pickMany(rowsFor(st.view).map((l) => l.id), t.checked);
  }
  let hoverId = null;
  function onOver(e) {
    const tr = e.target.closest("tr[data-id]"), id = tr ? tr.dataset.id : null;
    if (id === hoverId) return;
    hoverId = id;
    UW.mapApi.flash(id);
  }

  A.show = function (view) {
    if (view) { st.view = view; savePrefs(); }
    render();
    document.getElementById("uw-complist").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  A.init = function () {
    loadPrefs();
    quick = document.getElementById("uw-quick");
    host = document.getElementById("uw-clist");
    quick.addEventListener("click", onQuickClick);
    quick.addEventListener("change", onQuickChange);
    host.addEventListener("click", onClick);
    host.addEventListener("change", onChange);
    host.addEventListener("mouseover", onOver);
    host.addEventListener("mouseleave", () => { hoverId = null; UW.mapApi.flash(null); });
    renderQuick();
    render();
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(render, 30); };
    UW.on("filters", () => { renderQuick(); later(); });
    ["picked", "select", "near", "mode", "comps", "property", "listings", "places"].forEach((ev) => UW.on(ev, later));
  };
})();
