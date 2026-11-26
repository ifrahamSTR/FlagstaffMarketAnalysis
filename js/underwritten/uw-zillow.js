/**
 * Zillow search strip (top of the page): opens Zillow's Flagstaff for-sale search already
 * framed on the right part of town, so the map never has to be drawn by hand.
 *
 * The frame is one of
 *   - the whole market (the six areas' boxes together),
 *   - one of the six areas (2nd-98th percentile box of its Airbnb comps, padded ~1 km;
 *     data/comps.json: areas[].bbox and marketBbox, built by scripts/build_underwritten.py),
 *   - whatever the map on this page shows right now.
 * Minimum bedrooms / baths are optional. Zillow takes the frame as mapBounds in the
 * searchQueryState of the URL (south / west / north / east, degrees), the same URL Zillow itself
 * writes when you pan its map. Zillow draws a rectangle, not a polygon, so a box can include
 * a little of the next area. The choices are remembered in this browser.
 * Runs in the browser (window.UWZillow) and in Node (tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UWZillow = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const BASE = "https://www.zillow.com/flagstaff-az/";
  const r4 = (x) => Math.round(x * 10000) / 10000;

  /** bbox = [south, west, north, east]; opts = {beds, baths} minimums (numbers or null). */
  function url(bbox, opts) {
    opts = opts || {};
    const fs = { sort: { value: "globalrelevanceex" } };
    if (opts.beds > 0) fs.beds = { min: opts.beds };
    if (opts.baths > 0) fs.baths = { min: opts.baths };
    const state = {
      pagination: {}, isMapVisible: true, isListVisible: true,
      mapBounds: { west: r4(bbox[1]), east: r4(bbox[3]), south: r4(bbox[0]), north: r4(bbox[2]) },
      usersSearchTerm: "Flagstaff, AZ", filterState: fs,
    };
    return BASE + "?searchQueryState=" + encodeURIComponent(JSON.stringify(state));
  }

  /** The browser strip. UW: window.UW (data.comps for the boxes, mapApi.map for "this map view"). */
  function init(UW) {
    const host = document.getElementById("uw-zsearch");
    if (!host) return;
    const KEY = "flagstaffUW.zillow", C = UW.data.comps;
    const BEDS = [[0, "Any beds"], [1, "1+ beds"], [2, "2+ beds"], [3, "3+ beds"], [4, "4+ beds"], [5, "5+ beds"], [6, "6+ beds"]];
    const BATHS = [[0, "Any baths"], [1, "1+ baths"], [1.5, "1.5+ baths"], [2, "2+ baths"], [2.5, "2.5+ baths"], [3, "3+ baths"], [4, "4+ baths"]];
    let st = { where: "market", beds: 0, baths: 0 };
    try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s) st = Object.assign(st, s); } catch (e) { /* defaults */ }
    const E = UW.esc;
    const areaOpts = C.areas.map((a) => '<option value="' + E(a.id) + '">' + E(a.name) + "</option>").join("");
    const opt = (list, cur) => list.map(([v, t]) => '<option value="' + v + '"' + (+cur === v ? " selected" : "") + ">" + t + "</option>").join("");
    host.innerHTML = '<div class="container uw-wide uw-zs__in"><span class="uw-zs__l"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg> Zillow search</span>' +
      '<label class="uw-zs__f"><span class="uw-sr">Where</span><select data-z="where" aria-label="Where to search on Zillow"><option value="market">All of Flagstaff and the county</option>' + areaOpts + '<option value="view">This map view</option></select></label>' +
      '<label class="uw-zs__f"><span class="uw-sr">Bedrooms</span><select data-z="beds" aria-label="Minimum bedrooms">' + opt(BEDS, st.beds) + "</select></label>" +
      '<label class="uw-zs__f"><span class="uw-sr">Baths</span><select data-z="baths" aria-label="Minimum baths">' + opt(BATHS, st.baths) + "</select></label>" +
      '<a class="uw-btn uw-btn--primary uw-zs__go" data-z="go" href="#" target="_blank" rel="noopener">Open on Zillow ↗</a>' +
      '<span class="uw-zs__hint" id="uw-zs-hint"></span></div>';
    const sel = host.querySelector('[data-z="where"]');
    if (st.where !== "market" && (st.where === "view" || C.areas.some((a) => a.id === st.where))) sel.value = st.where; else st.where = "market";
    const go = host.querySelector('[data-z="go"]'), hint = document.getElementById("uw-zs-hint");
    function box() {
      if (st.where === "view") { const b = UW.mapApi.map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; }
      const a = C.areas.find((x) => x.id === st.where);
      return a ? a.bbox : C.marketBbox;
    }
    function refresh() {
      go.href = url(box(), { beds: st.beds, baths: st.baths });
      const a = C.areas.find((x) => x.id === st.where);
      hint.textContent = st.where === "view" ? "Frames the map as it is now" : a ? a.sub : "";
    }
    host.addEventListener("change", (e) => {
      const k = e.target.dataset.z;
      if (!k) return;
      st[k] = k === "where" ? e.target.value : Number(e.target.value);
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (err) { /* this session only */ }
      refresh();
    });
    // The link is rebuilt just before it opens, so "This map view" is always the view you are looking at.
    ["pointerdown", "focus", "mouseover", "click"].forEach((ev) => go.addEventListener(ev, refresh));
    if (UW.mapApi.map) UW.mapApi.map.on("moveend", () => { if (st.where === "view") refresh(); });
    refresh();
  }

  return { url, init, BASE };
});
