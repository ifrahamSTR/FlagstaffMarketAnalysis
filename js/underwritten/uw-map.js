/**
 * Flagstaff underwriting map: 856 Airbnb comps (Cleaned_Data entire homes)
 * drawn on one canvas (L.canvas, no DOM markers); acquisition targets (the
 * Zillow houses) as house markers (underwritten) and pins (new listings), both
 * coloured by low-case cash on cash, each with a hover summary and a popup.
 *
 * Built for picking comps:
 *  - click a dot to select it (or switch "Click a dot" to Details for the full popup);
 *  - Shift-drag, or the Box select button, selects every comp shown inside a box;
 *  - selected comps get a blue ring; the tray at the bottom copies them for Excel
 *    and jumps to the comp list. The selection is the same set the panel and the
 *    comp list use.
 * Marked on the map: the City of Flagstaff limits (Census TIGER), downtown (the
 * 1 km "Downtown" setting round Heritage Square), the San Francisco Peaks and
 * the other named peaks with their heights, the Arizona Snowbowl ski area, NAU,
 * Lowell Observatory, the airport and the county communities. Basemaps:
 * Terrain (light map over hillshade, the default), Topo, Satellite, Streets.
 */
/* global L, UWGeo */
(function () {
  const UW = window.UW;
  let map, renderer, dots = [], dotById = new Map(), areaLayer, labelLayer, villageLayer, peakLayer, placeLayer, propLayer, badgeLayer, ringLayer, flashLayer,
    placing = null, legendCtl, viewCtl, pickCtl, trayEl, viewOpen = false, hiddenN = 0, boxMode = false, box = null, baseLayers = {}, baseOn = null;
  const M = (UW.mapApi = {});
  const E = (s) => UW.esc(s);
  let overviewFit = null;

  UW.colorOf = function (l) {
    const by = UW.ui.colorBy;
    if (by === "tier") return UW.TIER_COLORS[l.sizeTop];
    if (by === "area") return UW.areaById[l.area].color;
    if (by === "loc") return UW.LOC_COLORS[l.loc];
    return UW.REV_BANDS.find((b) => l.revenue >= b[0] && l.revenue < b[1])[3];
  };

  // ---------------------------------------------------------------------------
  // Basemaps
  // ---------------------------------------------------------------------------
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const ESRI_ATT = "Tiles &copy; Esri";
  const BASEMAPS = {
    terrain: { label: "Terrain", make: () => L.layerGroup([
      L.tileLayer(ESRI + "Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, attribution: ESRI_ATT + " (hillshade)", className: "uw-tiles-hill" }),
      L.tileLayer(ESRI + "Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, attribution: ESRI_ATT + ", HERE, Garmin, OpenStreetMap contributors", className: "uw-tiles-over" }),
      L.tileLayer(ESRI + "Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 16, maxZoom: 18, className: "uw-tiles-ref" })]) },
    topo: { label: "Topo", make: () => L.tileLayer(ESRI + "World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: ESRI_ATT + " (World Topographic Map)" }) },
    satellite: { label: "Satellite", make: () => L.layerGroup([
      L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18, attribution: ESRI_ATT + ", Maxar, Earthstar Geographics" }),
      L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 })]) },
    streets: { label: "Streets", make: () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }) },
  };
  function setBase(key) {
    if (!BASEMAPS[key]) key = "terrain";
    if (baseOn) map.removeLayer(baseOn);
    baseOn = baseLayers[key] || (baseLayers[key] = BASEMAPS[key].make());
    baseOn.addTo(map);
    UW.ui.basemap = key;
    map.getContainer().dataset.base = key;
    saveView();
    drawPickCtl();
  }

  M.init = function () {
    // Whole zoom steps: scaled (fractional-zoom) tiles draw hairline seams in Chrome and blur the street names.
    map = L.map("uw-leaflet", { zoomSnap: 1, scrollWheelZoom: false, preferCanvas: true, keyboard: true, boxZoom: false });
    M.map = map;
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    // Scroll-zoom only once the map has been clicked or focused, so the page still scrolls past it.
    map.on("focus click", () => map.scrollWheelZoom.enable());
    map.on("blur mouseout", () => map.scrollWheelZoom.disable());
    renderer = L.canvas({ padding: 0.4, tolerance: 5 });
    setBase(UW.ui.basemap);

    const G = UW.data.geo;
    areaLayer = L.layerGroup();
    labelLayer = L.layerGroup();
    UW.areas.forEach((a) => {
      L.polygon(a.hull, { color: a.color, weight: 1.6, dashArray: "6 4", fillColor: a.color, fillOpacity: 0.05, interactive: false, renderer }).addTo(areaLayer);
      L.marker(a.label, { interactive: false, keyboard: false, icon: L.divIcon({ className: "uw-area-label", iconSize: [200, 18], iconAnchor: [100, 9], html: '<span style="color:' + a.color + '">' + E(a.name) + "</span>" }) }).addTo(labelLayer);
    });

    // City limits + downtown (the "village" layer key in the shared code).
    villageLayer = L.layerGroup([
      L.polygon(G.city.rings, { color: "#16324f", weight: 2, opacity: 0.8, fillColor: "#16324f", fillOpacity: 0.035, fillRule: "evenodd", interactive: false, renderer }),
      L.circle([G.downtown.lat, G.downtown.lng], { radius: G.downtown.km * 1000, color: "#b3261e", weight: 1.6, dashArray: "5 4", fill: true, fillColor: "#b3261e", fillOpacity: 0.05, interactive: false, renderer }),
      L.marker([G.downtown.lat, G.downtown.lng], { interactive: false, keyboard: false, zIndexOffset: -500,
        icon: L.divIcon({ className: "uw-mk uw-mk--downtown", iconSize: [0, 0], html: '<span class="uw-mk__pin"></span><span class="uw-mk__lab">Downtown<small>Heritage Square</small></span>' }) }),
      L.marker(cityLabelAt(), { interactive: false, keyboard: false, zIndexOffset: -600,
        icon: L.divIcon({ className: "uw-citylab", iconSize: [0, 0], html: "<span>City of Flagstaff</span>" }) }),
    ]);

    // Mountains: the San Francisco Peaks, the other named peaks, Arizona Snowbowl.
    peakLayer = L.layerGroup();
    L.marker([G.range.lat, G.range.lng], { interactive: false, keyboard: false, zIndexOffset: -700,
      icon: L.divIcon({ className: "uw-range", iconSize: [0, 0], html: "<span>" + E(G.range.name) + "</span>" }) }).addTo(peakLayer);
    G.peaks.forEach((pk) => {
      const sub = pk.ft ? pk.ft.toLocaleString("en-US") + " ft" + (pk.name === "Humphreys Peak" ? " · Arizona’s highest" : "") : "";
      L.marker([pk.lat, pk.lng], { interactive: false, keyboard: false, zIndexOffset: -400,
        icon: L.divIcon({ className: "uw-mk uw-peak" + (pk.major ? " uw-peak--major" : ""), iconSize: [0, 0],
          html: '<svg class="uw-peak__tri" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path d="M7 1 13 11H1Z"/></svg><span class="uw-mk__lab">' + E(pk.name) + (sub ? "<small>" + sub + "</small>" : "") + "</span>" }) }).addTo(peakLayer);
    });
    L.polygon(G.ski.ring, { color: "#1f6fb2", weight: 1.8, dashArray: "4 3", fillColor: "#7fb3e0", fillOpacity: 0.22, interactive: false, renderer }).addTo(peakLayer);
    const sc = G.ski.ring.reduce((a, p) => [a[0] + p[0] / G.ski.ring.length, a[1] + p[1] / G.ski.ring.length], [0, 0]);
    L.marker(sc, { interactive: false, keyboard: false, zIndexOffset: -300,
      icon: L.divIcon({ className: "uw-mk uw-mk--ski", iconSize: [0, 0], html: '<span class="uw-mk__badge"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1v14M2 4.5l12 7M2 11.5l12-7M6.3 1.8 8 3.3l1.7-1.5M6.3 14.2 8 12.7l1.7 1.5" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></span><span class="uw-mk__lab">Arizona Snowbowl<small>ski area</small></span>' }) }).addTo(peakLayer);

    // Landmarks and county communities.
    placeLayer = L.layerGroup();
    const ICON = { campus: "M2 6.5 8 3.5l6 3-6 3zM4.5 7.8v3.2c1 .9 2.2 1.3 3.5 1.3s2.5-.4 3.5-1.3V7.8", poi: "M8 2.5a3 3 0 0 1 3 3H5a3 3 0 0 1 3-3zM4 7h8M8 7v6M5.5 13h5",
      airport: "M8 1.8c.6 0 1 .5 1 1.1v3.4l4.6 2.6v1.4L9 9v3l1.5 1.1v1.1L8 13.6l-2.5.6v-1.1L7 12V9l-4.6 1.3V8.9L7 6.3V2.9c0-.6.4-1.1 1-1.1z", park: "M8 2 4 8h2.5L4 11.5h8L9.5 8H12zM8 11.5v3" };
    G.landmarks.forEach((m) => {
      L.marker([m.lat, m.lng], { interactive: false, keyboard: false, zIndexOffset: -450,
        icon: L.divIcon({ className: "uw-mk uw-mk--lm", iconSize: [0, 0], html: '<span class="uw-mk__badge uw-mk__badge--lm"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="' + ICON[m.kind] + '" stroke="#fff" stroke-width="1.4" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg></span><span class="uw-mk__lab">' + E(m.short || m.name) + "</span>" }) }).addTo(placeLayer);
    });
    G.communities.forEach((c) => {
      L.marker([c.lat, c.lng], { interactive: false, keyboard: false, zIndexOffset: -800,
        icon: L.divIcon({ className: "uw-commlab", iconSize: [0, 0], html: "<span>" + E(c.name) + "</span>" }) }).addTo(placeLayer);
    });

    UW.listings.forEach((l) => {
      const m = L.circleMarker([l.lat, l.lng], { renderer, radius: 5, weight: 1, color: "#fff", fillOpacity: 0.9, bubblingMouseEvents: false });
      m.listing = l;
      m.bindTooltip(() => dotTip(l), { direction: "top", offset: [0, -6], className: "uw-tip uw-tip--dot", opacity: 1 });
      m.on("click", () => onDotClick(m));
      m.addTo(map);
      dots.push(m);
      dotById.set(l.id, m);
    });
    propLayer = L.layerGroup().addTo(map);
    badgeLayer = L.layerGroup().addTo(map);
    ringLayer = L.layerGroup().addTo(map);
    flashLayer = L.layerGroup().addTo(map);

    // Start on every comp and the San Francisco Peaks.
    const pts = UW.listings.map((l) => [l.lat, l.lng]).concat(G.peaks.filter((p) => p.name === "Humphreys Peak").map((p) => [p.lat, p.lng]), [[G.range.lat + 0.004, G.range.lng]]);
    // With whole zoom steps a fit lands a level too far out; zoom 11 on a desktop-sized map shows
    // Kachina Village (south) to Humphreys Peak (north). Smaller maps use the fit.
    overviewFit = L.latLngBounds(pts).pad(0.02);
    M.overview(false);
    legendCtl = L.control({ position: "bottomleft" });
    legendCtl.onAdd = () => { const d = L.DomUtil.create("div", "uw-legend"); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; };
    legendCtl.addTo(map);
    viewCtl = L.control({ position: "topright" });
    viewCtl.onAdd = () => { const d = L.DomUtil.create("div", "uw-viewctl"); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); d.addEventListener("click", onViewClick); return d; };
    viewCtl.addTo(map);
    pickCtl = L.control({ position: "topleft" });
    pickCtl.onAdd = () => { const d = L.DomUtil.create("div", "uw-pickctl"); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); d.addEventListener("click", onPickCtlClick); return d; };
    pickCtl.addTo(map);
    trayEl = document.createElement("div");
    trayEl.className = "uw-tray";
    map.getContainer().appendChild(trayEl);
    L.DomEvent.disableClickPropagation(trayEl); L.DomEvent.disableScrollPropagation(trayEl);
    trayEl.addEventListener("click", onTrayClick);

    map.on("popupopen", () => { const d = legendCtl.getContainer().querySelector("details"); if (d) d.open = false; });
    map.on("zoomend", zoomClass);
    zoomClass();
    map.getContainer().addEventListener("click", onMapClick);
    map.on("click", (e) => { if (placing) finishPlace(e.latlng); });
    // Esc, one step at a time: finish placing a pin, cancel a box, close a popup, then leave property mode
    // for the overview. Capture phase, so Leaflet's own Esc-closes-popup doesn't also trigger the last step.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target, typing = t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !/^(checkbox|radio|button|submit)$/.test(t.type)));
      if (placing) { cancelPlace(); return; }
      if (boxMode) { setBoxMode(false); return; }
      if (typing || document.querySelector("dialog[open]")) return;
      if (document.querySelector(".uw-leaflet .leaflet-popup")) { map.closePopup(); return; }
      if (UW.ui.selected) UW.overview();
    }, true);
    initBoxSelect();
    M.layers();
    M.refresh();
  };

  /** The whole-map view (the page's starting view); closes any popup. animate:false on first draw. */
  M.overview = function (animate) {
    if (!map) return;
    map.closePopup();
    if (flashLayer) flashLayer.clearLayers();
    const o = { animate: animate !== false };
    if (map.getSize().y >= 560 && map.getSize().x >= 760) map.setView([35.205, -111.63], 11, o);
    else map.fitBounds(overviewFit, o);
  };
  /** Show a target on the map (fly to its pin, open its popup) without entering property mode. */
  M.reveal = function (pid) {
    const p = UW.property(pid);
    if (!p || !p.geo) return;
    map.once("moveend", () => setTimeout(() => M.openTarget(pid), 50));
    map.flyTo([p.geo.lat, p.geo.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
  };

  // "City of Flagstaff" sits on the city's own land in its empty east lobe (no listing within 1.5 km).
  function cityLabelAt() { return [35.168, -111.572]; }
  // Minor peak and community labels only once zoomed in (the major ones always show).
  function zoomClass() {
    const z = map.getZoom(), c = map.getContainer();
    c.classList.toggle("uw-z-lo", z < 12.5);
    c.classList.toggle("uw-z-hi", z >= 13);
  }

  // ---------------------------------------------------------------------------
  // Hover summary and click behaviour of a comp dot
  // ---------------------------------------------------------------------------
  function dotTip(l) {
    const F = UW.fmt, picked = UW.ui.picked.has(l.id), a = UW.areaById[l.area];
    const am = UW.ICON_ORDER.filter((k) => l.flagSet.has(k)).slice(0, 6).map((k) => UW.AMEN_LABEL[k].toLowerCase());
    const hint = UW.ui.pickMode === "select" && !placing ? (picked ? "✓ Selected · click to remove" : "Click to select") : "Click for details";
    return '<div class="uw-dtip"><p class="uw-dtip__t">' + E(l.title) + "</p>" +
      '<p class="uw-dtip__k"><strong>' + F.money(l.revenue) + "</strong> · " + F.beds(l.bedrooms) + " / " + F.num(l.baths) + " BA · sleeps " + F.num(l.sleeps) + "</p>" +
      '<p class="uw-dtip__m">' + F.money(l.adr) + "/night · " + F.pct(l.occ, 0) + " occupied" + (l.rating ? " · ★ " + F.num(l.rating) : "") + "</p>" +
      '<p class="uw-dtip__m"><span class="uw-dot" style="background:' + UW.LOC_COLORS[l.loc] + '"></span>' + E(l.loc) + " · " + E(a.name) + "</p>" +
      (am.length ? '<p class="uw-dtip__m">' + E(am.join(" · ")) + "</p>" : "") +
      '<p class="uw-dtip__h' + (picked ? " is-on" : "") + '">' + hint + "</p></div>";
  }
  function onDotClick(m) {
    if (placing) return;
    const l = m.listing;
    if (UW.ui.pickMode === "select") {
      UW.togglePick(l.id);
      m.closeTooltip();
      setTimeout(() => { if (m._map) m.openTooltip(); }, 0);  // refreshed hint ("Selected")
    } else showPopup(m);
  }
  function showPopup(m) {
    L.popup({ maxWidth: 340, minWidth: 260, autoPanPaddingTopLeft: [24, 24], autoPanPaddingBottomRight: [24, 24], autoPanPaddingBottomLeft: [24, 70], className: "uw-popup", offset: [0, -2] })
      .setLatLng(m.getLatLng()).setContent(listingPopup(m.listing)).openOn(map);
    m.closeTooltip();
  }

  // ---------------------------------------------------------------------------
  // Top-left control: what a click does, box select, basemap
  // ---------------------------------------------------------------------------
  function drawPickCtl() {
    const host = pickCtl && pickCtl.getContainer();
    if (!host) return;
    const sel = UW.ui.selected && UW.property(UW.ui.selected);
    map.getContainer().classList.toggle("is-property", !!sel);
    const seg = (k, t, tip) => '<button type="button" data-pk="mode" data-v="' + k + '" aria-pressed="' + (UW.ui.pickMode === k) + '" title="' + tip + '">' + t + "</button>";
    const home = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 8 8 2.5 14 8M3.8 7v6.5h8.4V7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg> ';
    const modeRow = sel ?
      '<div class="uw-pickctl__row uw-pickctl__mode is-prop"><span class="uw-pickctl__prop">Viewing only <b>' + E(sel.street) + '</b></span>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-pk="overview" title="Leave this property and show the whole map again (Esc)">← Overview</button><span class="uw-pickctl__hint">or press Esc</span></div>' :
      '<div class="uw-pickctl__row uw-pickctl__mode"><button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-pk="overview" title="Frame the whole of Flagstaff again">' + home + 'Overview</button>' +
      (UW.properties().length ? '<span class="uw-pickctl__hint">Click a target to view only it</span>' : "") + "</div>";
    const pick = UW.ui.picked.size;
    host.innerHTML = modeRow +
      '<div class="uw-pickctl__row"><span class="uw-pickctl__l">Click a dot to</span><span class="uw-seg uw-seg--sm" role="group" aria-label="What clicking a comp does">' +
      seg("select", "Select", "Click a comp to add it to (or remove it from) your selection") + seg("details", "See details", "Click a comp to open its full details") + "</span></div>" +
      '<div class="uw-pickctl__row"><button type="button" class="uw-btn uw-btn--small' + (boxMode === "add" ? " uw-btn--primary" : " uw-btn--ghost") + '" data-pk="box" aria-pressed="' + (boxMode === "add") + '" title="Drag a box over the map to select every comp shown inside it (or hold Shift and drag)">' +
      '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/></svg> ' +
      (boxMode === "add" ? "Drag on the map…" : "Box select") + "</button>" +
      (pick ? '<button type="button" class="uw-btn uw-btn--small' + (boxMode === "remove" ? " uw-btn--danger" : " uw-btn--ghost") + '" data-pk="boxrm" aria-pressed="' + (boxMode === "remove") + '" title="Drag a box to unselect the selected comps inside it (or hold Alt / Option and drag)">' +
        (boxMode === "remove" ? "Drag on the map…" : "Box remove") + "</button>" : "") +
      '<span class="uw-pickctl__hint">Shift-drag adds' + (pick ? " · Alt-drag removes" : "") + "</span></div>" +
      '<div class="uw-pickctl__row"><span class="uw-pickctl__l">Map</span><span class="uw-seg uw-seg--sm" role="group" aria-label="Basemap">' +
      Object.entries(BASEMAPS).map(([k, b]) => '<button type="button" data-pk="base" data-v="' + k + '" aria-pressed="' + (UW.ui.basemap === k) + '">' + b.label + "</button>").join("") + "</span></div>";
  }
  function onPickCtlClick(e) {
    const b = e.target.closest("[data-pk]");
    if (!b) return;
    const k = b.dataset.pk;
    if (k === "mode") { UW.ui.pickMode = b.dataset.v; saveView(); drawPickCtl(); map.closePopup(); }
    else if (k === "overview") UW.overview();
    else if (k === "box") setBoxMode(boxMode === "add" ? false : "add");
    else if (k === "boxrm") setBoxMode(boxMode === "remove" ? false : "remove");
    else if (k === "base") setBase(b.dataset.v);
  }
  // kind: "add" | "remove" | false
  function setBoxMode(kind) {
    boxMode = kind || false;
    map.getContainer().classList.toggle("is-boxing", !!kind);
    if (kind) map.dragging.disable(); else if (!box) map.dragging.enable();
    drawPickCtl();
  }

  // Box select: the Box select button, or Shift + drag, anywhere on the map; Box remove, or Alt / Option + drag, unselects.
  function initBoxSelect() {
    const c = map.getContainer();
    let start = null, rect = null, justBoxed = false, removing = false;
    // The click that ends a box drag must not toggle the dot under the cursor.
    c.addEventListener("click", (ev) => { if (justBoxed) { ev.stopPropagation(); ev.preventDefault(); justBoxed = false; } }, true);
    const ptOf = (ev) => map.mouseEventToContainerPoint(ev);
    c.addEventListener("mousedown", (ev) => {
      if (placing || ev.button !== 0 || !(boxMode || ev.shiftKey || ev.altKey)) return;
      if (ev.target.closest(".leaflet-control, .uw-tray, .leaflet-popup")) return;
      ev.preventDefault(); ev.stopPropagation();
      map.dragging.disable();
      start = ptOf(ev);
      box = true;
      removing = boxMode === "remove" || (boxMode !== "add" && ev.altKey && !ev.shiftKey);
      const c1 = removing ? "#b3261e" : "#1d4ed8", c2 = removing ? "#e0574d" : "#3b82f6";
      rect = L.rectangle(L.latLngBounds(map.containerPointToLatLng(start), map.containerPointToLatLng(start)), { color: c1, weight: 1.5, dashArray: "4 3", fillColor: c2, fillOpacity: 0.12, interactive: false }).addTo(map);
    }, true);
    window.addEventListener("mousemove", (ev) => {
      if (!start) return;
      rect.setBounds(L.latLngBounds(map.containerPointToLatLng(start), map.containerPointToLatLng(ptOf(ev))));
    });
    window.addEventListener("mouseup", (ev) => {
      if (!start) return;
      const end = ptOf(ev), b = L.latLngBounds(map.containerPointToLatLng(start), map.containerPointToLatLng(end));
      const big = Math.abs(end.x - start.x) > 4 && Math.abs(end.y - start.y) > 4;
      start = null; box = null; justBoxed = true;
      setTimeout(() => { justBoxed = false; }, 60);
      map.removeLayer(rect); rect = null;
      if (big && removing) {
        const gone = [...UW.ui.picked].filter((id) => { const l = UW.byId.get(id); return l && b.contains([l.lat, l.lng]); });
        if (gone.length) { UW.pickMany(gone, false); UW.toast("Removed " + gone.length + " comp" + (gone.length === 1 ? "" : "s") + " from your selection (" + UW.ui.picked.size + " left)"); }
        else UW.toast("None of your selected comps are inside that box", "warn");
      } else if (big) {
        const ids = dots.filter((m) => m._shown && b.contains(m.getLatLng())).map((m) => m.listing.id);
        const add = ids.filter((id) => !UW.ui.picked.has(id));
        if (add.length) { UW.pickMany(add); UW.toast("Selected " + add.length + " more comp" + (add.length === 1 ? "" : "s") + " (" + UW.ui.picked.size + " in all)"); }
        else UW.toast(ids.length ? "Those comps were already selected" : "No comps shown inside that box", ids.length ? undefined : "warn");
      }
      if (boxMode) setBoxMode(false); else map.dragging.enable();
    });
  }

  // ---------------------------------------------------------------------------
  // Selection tray (bottom of the map)
  // ---------------------------------------------------------------------------
  function drawTray() {
    if (!trayEl) return;
    const n = UW.ui.picked.size;
    trayEl.classList.toggle("is-empty", !n);
    trayEl.innerHTML = n ?
      '<span class="uw-tray__n"><b>' + n + "</b> comp" + (n === 1 ? "" : "s") + " selected</span>" +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-tr="copy" title="Tab-separated rows in the UW sheet’s 15 comp columns, revenue high to low">Copy for UW sheet</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-tr="list">Open comp list ↓</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-tr="fit" title="Zoom to the selected comps">Zoom to them</button>' +
      '<button type="button" class="uw-linkbtn" data-tr="clear">Clear</button>' :
      '<span class="uw-tray__hint">' + (UW.ui.pickMode === "select" ? "Click comps to select them · Shift + drag to box-select" : "Details mode: click a comp for its details, or switch to Select (top left)") + "</span>";
  }
  function onTrayClick(e) {
    const b = e.target.closest("[data-tr]");
    if (!b) return;
    const k = b.dataset.tr, ids = [...UW.ui.picked];
    if (k === "copy") UW.copyListings(ids.map((id) => UW.byId.get(id)).filter(Boolean), UW.ui.selected ? UW.property(UW.ui.selected) : null, "selected");
    else if (k === "list") { if (UW.listApi) UW.listApi.show("picked"); }
    else if (k === "fit") { const pts = ids.map((id) => UW.byId.get(id)).filter(Boolean).map((l) => [l.lat, l.lng]); if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 15, duration: 0.6 }); }
    else if (k === "clear") UW.clearPicked();
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const PICK = "#1d4ed8";
  function styleFor(l, state) {
    const c = UW.colorOf(l);
    if (state === "ghost") return UW.ui.layers.ghosts ? { radius: 3.2, fillColor: "#76838c", fillOpacity: 0.55, color: "#fff", weight: 0.8, opacity: 0.8 } : { radius: 0, fillOpacity: 0, opacity: 0, weight: 0 };
    if (state === "dim") return { radius: 3.6, fillColor: c, fillOpacity: 0.3, color: "#fff", weight: 0.5, opacity: 0.4 };
    if (state === "hl") return { radius: 7.5, fillColor: c, fillOpacity: 1, color: "#0b2f28", weight: 2.2, opacity: 1 };
    if (state === "am") return { radius: 7.5, fillColor: c, fillOpacity: 1, color: amRing(l._amFrac), weight: 4, opacity: 1 };
    if (state === "set") return { radius: 6.5, fillColor: c, fillOpacity: 1, color: "#ecaa4a", weight: 3, opacity: 1 };
    return { radius: 5, fillColor: c, fillOpacity: 0.92, color: "#fff", weight: 1, opacity: 1 };
  }
  const pickStyle = (l, base) => Object.assign({}, base, { radius: Math.max(base.radius || 5, 7), fillColor: UW.colorOf(l), fillOpacity: 1, color: PICK, weight: 3.4, opacity: 1 });

  // Amenity-mode results: a ring coloured by the share of the profile's preferred amenities the comp has.
  const AM_RING = [[1, "#1B7A43", "all preferred amenities"], [0.75, "#5f9e8f", "most"], [0.5, "#d99132", "about half"], [0, "#8b94a3", "few, or beds / sleeps / pool off"]];
  function amRing(frac) { return (AM_RING.find((r) => frac >= r[0]) || AM_RING[AM_RING.length - 1])[1]; }
  M.amRing = amRing;
  M.refresh = function () {
    if (!map) return;
    const p = UW.ui.selected ? UW.property(UW.ui.selected) : null;
    const near = p ? UW.nearest(p) : [];
    M.lastNearest = near;
    const amMode = p && UW.ui.mode === "amenity" && !UW.ui.pure;
    const hl = new Map(near.map((x) => [x.l.id, x]));
    near.forEach((x) => { x.l._amFrac = x.bedsTier || x.sleepsTier || x.poolOk === false ? -1 : x.info && x.info.prefTotal ? x.info.prefMatched / x.info.prefTotal : 1; });
    const inSet = new Set(p ? UW.activeVersion(p).comps.map((c) => UW.compId(c)).filter(Boolean) : []);
    const front = [], mid = [], keep = SCORE[UW.ui.score] || SCORE.all;
    hiddenN = 0;
    dots.forEach((m) => {
      const l = m.listing, match = UW.matchSet.has(l.id), picked = UW.ui.picked.has(l.id);
      let state = !match ? "ghost" : p ? "dim" : "match";
      if (hl.has(l.id)) state = amMode ? "am" : "hl";
      else if (inSet.has(l.id)) state = "set";
      // The View control hides background dots only: ranked matches, the comp set and the selection always stay.
      const hide = !picked && ((state === "ghost" && !UW.ui.layers.ghosts) || ((state === "match" || state === "dim" || state === "ghost") && !keep(l)));
      if (hide) hiddenN++;
      const st = hide ? { radius: 0, fillOpacity: 0, opacity: 0, weight: 0 } : picked ? pickStyle(l, styleFor(l, state === "ghost" ? "match" : state)) : styleFor(l, state);
      m.setStyle(st);
      m._shown = !hide && state !== "ghost";  // what a box selection picks up
      // Filtered-out (grey) dots can't be clicked, so a click always lands on a comp that passes the filters.
      m.options.interactive = !placing && !hide && (state !== "ghost" || inSet.has(l.id) || picked);
      if (state === "hl" || state === "am" || state === "set") front.push(m);
      else if (state !== "ghost") mid.push(m);
    });
    mid.forEach((m) => m.bringToFront());
    front.forEach((m) => m.bringToFront());
    dots.forEach((m) => { if (UW.ui.picked.has(m.listing.id)) m.bringToFront(); });

    badgeLayer.clearLayers();
    ringLayer.clearLayers();
    if (UW.ui.layers.ranks) near.slice(0, 50).forEach((x) => {
      const b = L.marker([x.l.lat, x.l.lng], { keyboard: false, zIndexOffset: 500, title: "#" + x.rank + " " + x.l.title,
        icon: L.divIcon({ className: "uw-rank" + (amMode ? " uw-rank--am" : "") + (inSet.has(x.l.id) ? " uw-rank--set" : ""), iconSize: [20, 20], iconAnchor: [-3, 22], html: String(x.rank) }) });
      b.on("click", () => openListing(x.l.id));
      b.addTo(badgeLayer);
    });
    if (p && p.geo && near.length && !amMode && UW.ui.layers.ring) {
      const r = UW.ui.radius != null ? UW.ui.radius : near[near.length - 1].d * 1.03;
      L.circle([p.geo.lat, p.geo.lng], { renderer, radius: r * 1609.344, color: "#0b4b40", weight: 1.2, dashArray: "4 5", fill: true, fillColor: "#0b4b40", fillOpacity: 0.035, interactive: false })
        .addTo(ringLayer).bringToBack();
    }
    drawProperties(p);
    drawLegend();
    drawView();
    drawPickCtl();
    drawTray();
  };

  // Briefly ring a comp (hovering its row in the comp list).
  M.flash = function (id) {
    flashLayer.clearLayers();
    const l = id && UW.byId.get(id);
    if (!l) return;
    L.circleMarker([l.lat, l.lng], { radius: 13, color: "#1d4ed8", weight: 3, fill: false, opacity: 0.9, interactive: false, className: "uw-flash" }).addTo(flashLayer);
  };

  // ---------------------------------------------------------------------------
  // View control (top right): declutter the map and choose the markings. Display only:
  // filters, rankings and copies don't change. Remembered in this browser.
  // ---------------------------------------------------------------------------
  const VIEW_KEY = "flagstaffUW.view";
  const VIEW_KEYS = ["ghosts", "areas", "labels", "village", "peaks", "places", "ranks", "ring"];
  const SCORE = {
    all: () => true,
    hideLow: (l) => l.sizeTier !== "Bottom 25% for its size",
    top: (l) => l.sizeTier === "Top 25% for its size",
  };
  const VIEW_ALL = { score: "all", ghosts: true, areas: true, labels: true, village: true, peaks: true, places: true, ranks: true, ring: true };
  const VIEW_CLEAN = { score: "hideLow", ghosts: false, areas: false, labels: false, village: true, peaks: true, places: false, ranks: true, ring: false };
  function applyView(v) {
    if (v.score && SCORE[v.score]) UW.ui.score = v.score;
    VIEW_KEYS.forEach((k) => { if (typeof v[k] === "boolean") UW.ui.layers[k] = v[k]; });
    if (v.pickMode === "select" || v.pickMode === "details") UW.ui.pickMode = v.pickMode;
    if (v.basemap && BASEMAPS[v.basemap]) UW.ui.basemap = v.basemap;
  }
  function saveView() {
    const v = { score: UW.ui.score, pickMode: UW.ui.pickMode, basemap: UW.ui.basemap };
    VIEW_KEYS.forEach((k) => (v[k] = !!UW.ui.layers[k]));
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch (e) { /* storage blocked: this session only */ }
  }
  M.loadView = function () { try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); if (v) applyView(v); } catch (e) { /* use the defaults */ } };
  M.setView = function (v) { applyView(v); saveView(); M.layers(); if (UW.panelApi && UW.panelApi.renderAll) UW.panelApi.renderAll(); };
  function drawView() {
    const host = viewCtl && viewCtl.getContainer();
    if (!host) return;
    const was = host.querySelector("details");
    if (was) viewOpen = was.open;
    const Ly = UW.ui.layers;
    const seg = [["all", "All"], ["hideLow", "Hide bottom 25%"], ["top", "Top 25% only"]].map(([k, t]) =>
      '<button type="button" data-view="score" data-v="' + k + '" aria-pressed="' + (UW.ui.score === k) + '">' + t + "</button>").join("");
    const chip = (k, t) => '<button type="button" class="uw-chip" data-view="toggle" data-k="' + k + '" aria-pressed="' + !!Ly[k] + '">' + E(t) + "</button>";
    host.innerHTML = '<details class="uw-viewctl__box"' + (viewOpen ? " open" : "") + "><summary>View" + (hiddenN ? ' <span class="uw-viewctl__n">' + hiddenN + " dots hidden</span>" : "") + "</summary>" +
      '<p class="uw-viewctl__t">Airbnb comps on the map</p><div class="uw-seg uw-seg--sm uw-viewctl__seg" role="group" aria-label="Which comps to show">' + seg + "</div>" +
      '<p class="uw-viewctl__hint">Against same-size homes. Ranked matches, the comp set and your selection always show.</p>' +
      '<p class="uw-viewctl__t">Markings</p><div class="uw-viewctl__chips">' + chip("village", "City limits & downtown") + chip("peaks", "Mountains & Snowbowl") + chip("places", "Landmarks & communities") +
      chip("ghosts", "Filtered-out dots") + chip("areas", "Area outlines") + chip("labels", "Area names") + chip("ranks", "Rank numbers") + chip("ring", "Search ring") + "</div>" +
      '<div class="uw-viewctl__acts"><button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-view="clean">Clean map</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-view="all">Show everything</button></div></details>';
  }
  function onViewClick(e) {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    const act = b.dataset.view;
    if (act === "score") M.setView({ score: b.dataset.v });
    else if (act === "toggle") M.setView({ [b.dataset.k]: !UW.ui.layers[b.dataset.k] });
    else if (act === "clean") M.setView(VIEW_CLEAN);
    else if (act === "all") M.setView(VIEW_ALL);
  }

  function houseIcon(color, selected, edited) {
    const s = selected ? 40 : 30;
    return L.divIcon({ className: "uw-house" + (selected ? " is-selected" : ""), iconSize: [s, s], iconAnchor: [s / 2, s - 2], popupAnchor: [0, -s + 4],
      html: '<svg viewBox="0 0 32 32" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M16 2.8 29.2 14.2V29H2.8V14.2Z" fill="' + color + '" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>' +
        '<path d="M12.6 29v-7.4h6.8V29" fill="none" stroke="#fff" stroke-width="2"/>' + (edited ? '<circle cx="26" cy="7" r="4.4" fill="#ecaa4a" stroke="#fff" stroke-width="1.6"/>' : "") + "</svg>" });
  }
  function pinIcon(color, selected) {
    const w = selected ? 34 : 26, h = Math.round(w * 1.25);
    return L.divIcon({ className: "uw-pin" + (selected ? " is-selected" : ""), iconSize: [w, h], iconAnchor: [w / 2, h - 1], popupAnchor: [0, -h + 4],
      html: '<svg viewBox="0 0 32 40" width="' + w + '" height="' + h + '" aria-hidden="true"><path d="M16 38.5S28 26.4 28 16.2A12 12 0 0 0 4 16.2C4 26.4 16 38.5 16 38.5Z" fill="' + color + '" stroke="#fff" stroke-width="2.4"/>' +
        '<path d="m16 9 2 4.1 4.5.6-3.3 3.2.8 4.5-4-2.1-4 2.1.8-4.5-3.3-3.2 4.5-.6Z" fill="#fff"/></svg>' });
  }

  // Target markers are kept (not rebuilt) so an open popup survives a redraw, e.g. a scenario switch inside it.
  const targetMarkers = new Map();
  function targetTip(p) {
    const v = UW.activeVersion(p), d = v.details, F = UW.fmt;
    const bb = d.beds != null ? F.num(d.beds) + " / " + F.num(d.baths) : p.listing ? F.num(p.listing.facts.beds) + " / " + F.num(p.listing.facts.baths) : "—";
    const err = UW.compErrors(v).length;
    return "<strong>" + E(p.street) + "</strong>" + (p.versions.length > 1 ? " · " + E(UW.scenarioName(v)) : "") + "<br>" + F.money(v.inputs.price) + " · " + bb + " bed / bath projected" +
      "<br>Mid revenue " + F.k(v.inputs.revenue.mid) + " · low-case cash on cash " + F.pct(v.outputs.cases.low.coc) + (err ? '<br><span class="uw-tip__err">' + err + " comp error" + (err === 1 ? "" : "s") + "</span>" : "");
  }
  function drawProperties(sel) {
    const seen = new Set();
    UW.properties().forEach((p) => {
      if (!p.geo) return;
      const isNew = p.kind !== "underwritten";
      if ((isNew && !UW.ui.layers.newl) || (!isNew && !UW.ui.layers.uw)) return;
      seen.add(p.id);
      const v = UW.activeVersion(p), low = v.outputs.cases.low.coc, st = UW.cocStatus(low);
      const selected = sel && sel.id === p.id;
      const icon = isNew ? pinIcon(UW.COC_COLORS[st], selected) : houseIcon(UW.COC_COLORS[st], selected, v.edited.inputs);
      let m = targetMarkers.get(p.id);
      if (!m) {
        m = L.marker([p.geo.lat, p.geo.lng], { icon, keyboard: true, title: p.street, alt: "Acquisition target: " + p.street, riseOnHover: true });
        m.bindTooltip(() => targetTip(UW.property(p.id)), { direction: "top", offset: [0, -24], className: "uw-tip" });
        m.bindPopup(() => targetPopup(UW.property(p.id)), { maxWidth: 380, minWidth: 290, className: "uw-popup uw-popup--target", autoPanPaddingTopLeft: [24, 24], autoPanPaddingBottomLeft: [24, 24] });
        m.on("popupopen", () => m.closeTooltip());
        m.on("dragend", () => { const ll = m.getLatLng(); UW.setPropertyField(p.id, "pin", { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), source: "manual" }); });
        m.addTo(propLayer);
        targetMarkers.set(p.id, m);
      } else {
        m.setLatLng([p.geo.lat, p.geo.lng]);
        m.setIcon(icon);
        if (m.isPopupOpen()) m.setPopupContent(targetPopup(p));
      }
      m.setZIndexOffset(selected ? 2000 : 1000);
      const drag = !!(placing && placing.pid === p.id);
      if (m.dragging) { if (drag) m.dragging.enable(); else m.dragging.disable(); }
    });
    targetMarkers.forEach((m, id) => { if (!seen.has(id)) { propLayer.removeLayer(m); targetMarkers.delete(id); } });
    drawNoPin();
  }
  M.openTarget = function (pid) {
    const m = targetMarkers.get(pid);
    if (m) { if (!map.getBounds().contains(m.getLatLng())) map.panTo(m.getLatLng()); m.openPopup(); }
  };

  function targetPopup(p) {
    const v = UW.activeVersion(p), d = v.details, F = UW.fmt, o = v.outputs, rev = v.inputs.revenue || {}, L_ = p.listing && p.listing.facts;
    const bb = d.beds != null ? F.num(d.beds) + " / " + F.num(d.baths) : L_ ? F.num(L_.beds) + " / " + F.num(L_.baths) : "—";
    const tgt = v.target.beds != null && (v.target.beds !== d.beds || v.target.baths !== d.baths) ? " (target " + F.num(v.target.beds) + " / " + F.num(v.target.baths) + ")" : "";
    const sqft = d.size != null ? Number(d.size).toLocaleString("en-US") + " sqft" : L_ && L_.sqft ? Number(L_.sqft).toLocaleString("en-US") + " sqft" : null;
    const lot = d.lot != null ? "lot " + Number(d.lot).toLocaleString("en-US") + " sqft" : L_ && L_.lot ? "lot " + Number(L_.lot).toLocaleString("en-US") + " sqft" : null;
    const scen = p.versions.length > 1 ? '<div class="uw-seg uw-seg--sm uw-tpop__scen" role="group" aria-label="Scenario">' + p.versions.map((x) => '<button type="button" data-act="tp-ver" data-pid="' + E(p.id) + '" data-v="' + E(x.label) + '" aria-pressed="' + (x.label === v.label) + '">' + E(UW.scenarioName(x)) + "</button>").join("") + "</div>" : "";
    return '<div class="uw-tpop"><p class="uw-tpop__kicker">Acquisition target' + (p.kind !== "underwritten" ? " · new listing" : "") + (p.versions.length > 1 ? " · " + E(UW.scenarioName(v)) : "") + "</p>" +
      "<h3>" + E(p.street) + "</h3>" +
      (p.url ? '<a class="uw-btn uw-btn--primary uw-tpop__zl" href="' + E(p.url) + '" target="_blank" rel="noopener">Open on Zillow ↗</a>' : "") +
      '<p class="uw-tpop__facts"><strong>' + F.money(v.inputs.price) + "</strong> · " + bb + " bed / bath" + tgt + [sqft, lot].filter(Boolean).map((x) => " · " + x).join("") + "</p>" + scen +
      (p.place ? '<p class="uw-tpop__facts">' + E(p.place.loc) + " · " + E(p.place.areaName) + " · " + F.km(p.place.beachKm) + " to downtown · " + F.km(p.place.snowKm) + " to Snowbowl</p>" : "") +
      '<table class="uw-tpop__t"><thead><tr><th></th><th>Low</th><th>Mid</th><th>High</th></tr></thead><tbody>' +
      "<tr><th>Revenue</th>" + ["low", "mid", "high"].map((c) => "<td>" + F.k(rev[c]) + "</td>").join("") + "</tr>" +
      "<tr><th>Cash on cash</th>" + ["low", "mid", "high"].map((c) => '<td class="uw-coc--' + UW.cocStatus(o.cases[c].coc) + '">' + F.pct(o.cases[c].coc) + "</td>").join("") + "</tr></tbody></table>" +
      '<div class="uw-head__badges">' + UW.targetBadges(p, v) + "</div>" +
      (p.versions.length > 1 ? UW.scenarioTable(p, true) : "") +
      '<div class="uw-tpop__acts"><button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-act="tp-rank" data-mode="location" data-pid="' + E(p.id) + '">Match by location</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--primary" data-act="tp-rank" data-mode="amenity" data-pid="' + E(p.id) + '">Match by amenities</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-act="tp-card" data-pid="' + E(p.id) + '">Open card</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-act="tp-copy" data-pid="' + E(p.id) + '"' + (v.comps.length ? "" : " disabled") + ">Copy comps</button>" +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-act="tp-rev" data-pid="' + E(p.id) + '">Copy revenue cases</button>' +
      '<button type="button" class="uw-btn uw-btn--small uw-btn--ghost" data-act="tp-csv" data-pid="' + E(p.id) + '">Download UW CSV</button></div></div>';
  }

  // Targets without a pin get a prompt at the top of the map (they're also listed, tagged, in the panel).
  function drawNoPin() {
    const host = map.getContainer();
    let bar = document.getElementById("uw-nopin-bar");
    const missing = UW.properties().filter((p) => !p.geo);
    if (!missing.length || placing) { if (bar) bar.hidden = true; return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "uw-nopin-bar"; bar.className = "uw-nopin-bar"; host.appendChild(bar); L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableScrollPropagation(bar); }
    bar.hidden = false;
    bar.innerHTML = missing.map((p) => '<span><strong>' + E(p.street) + "</strong> has no map pin" + (p.geocodeNote ? ' <span class="uw-nopin-bar__why" title="' + E(p.geocodeNote) + '">(geocoders couldn’t find the house)</span>' : "") +
      '</span><button type="button" class="uw-btn uw-btn--small" data-act="place-target" data-pid="' + E(p.id) + '">Place this target on the map</button>').join("");
  }

  function drawLegend() {
    const host = legendCtl && legendCtl.getContainer();
    if (!host) return;
    const by = UW.ui.colorBy, Ly = UW.ui.layers;
    let items;
    if (by === "tier") items = Object.entries(UW.TIER_LABEL).map(([k, lab]) => [UW.TIER_COLORS[k], lab]);
    else if (by === "area") items = UW.areas.map((a) => [a.color, a.name]);
    else if (by === "loc") items = UW.data.comps.locOrder.map((l) => [UW.LOC_COLORS[l], l]);
    else items = UW.REV_BANDS.map((b) => [b[3], b[2]]);
    const title = { revenue: "Airbnb comps · revenue potential", tier: "Against same-size homes", area: "Area", loc: "Setting" }[by];
    const n = UW.matchSet.size;
    const was = host.querySelector("details");
    const open = was ? was.open : false;
    const tri = '<svg width="12" height="10" viewBox="0 0 14 12" aria-hidden="true"><path d="M7 1 13 11H1Z" fill="#5b4636"/></svg>';
    host.innerHTML = '<details class="uw-legend__box"' + (open ? " open" : "") + "><summary>Legend · " + n + " of " + UW.listings.length + " Airbnb comps shown</summary>" +
      '<p class="uw-legend__t">' + title + "</p>" + items.map((i) => '<span class="uw-legend__i"><i style="background:' + i[0] + '"></i>' + E(i[1]) + "</span>").join("") +
      '<span class="uw-legend__i"><i class="uw-legend__pick"></i>Selected by you</span>' +
      '<span class="uw-legend__i"><i class="uw-legend__ring"></i>In the selected target’s comp set</span>' +
      (Ly.ghosts ? '<span class="uw-legend__i"><i style="background:#76838c;width:7px;height:7px;opacity:.6"></i>Filtered out (bedrooms, baths, setting…)</span>' : "") +
      '<p class="uw-legend__t">Map markings</p>' +
      (Ly.village ? '<span class="uw-legend__i"><i class="uw-legend__line" style="--c:#16324f"></i>City of Flagstaff limits (Census TIGER)</span>' +
        '<span class="uw-legend__i"><i class="uw-legend__line uw-legend__line--dash" style="--c:#b3261e"></i>Downtown: 1 km round Heritage Square</span>' : "") +
      (Ly.peaks ? '<span class="uw-legend__i">' + tri + "Peak, height in feet</span>" +
        '<span class="uw-legend__i"><i class="uw-legend__area" style="--c:#1f6fb2"></i>Arizona Snowbowl ski area</span>' : "") +
      '<p class="uw-legend__t">Acquisition targets · colour = low-case cash on cash</p>' +
      '<span class="uw-legend__i"><svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.8 29.2 14.2V29H2.8V14.2Z" fill="' + UW.COC_COLORS.good + '"/></svg>Underwritten target · 4%+</span>' +
      '<span class="uw-legend__i"><svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.8 29.2 14.2V29H2.8V14.2Z" fill="' + UW.COC_COLORS.warn + '"/></svg>0–4%</span>' +
      '<span class="uw-legend__i"><svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.8 29.2 14.2V29H2.8V14.2Z" fill="' + UW.COC_COLORS.bad + '"/></svg>below 0%</span>' +
      '<span class="uw-legend__i"><svg width="12" height="15" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 38.5S28 26.4 28 16.2A12 12 0 0 0 4 16.2C4 26.4 16 38.5 16 38.5Z" fill="' + UW.COC_COLORS.none + '"/></svg>New-listing target (grey = no revenue yet)</span>' +
      (UW.ui.selected && UW.ui.mode === "amenity" && !UW.ui.pure ? '<p class="uw-legend__t">Amenity matches, best to worst · ring = how well it fits</p>' +
        AM_RING.map((r) => '<span class="uw-legend__i"><i class="uw-legend__am" style="--r:' + r[1] + '"></i>' + r[2] + "</span>").join("") : "") + "</details>";
  }

  M.layers = function () {
    const Ly = UW.ui.layers;
    [[areaLayer, Ly.areas], [labelLayer, Ly.labels], [villageLayer, Ly.village], [peakLayer, Ly.peaks], [placeLayer, Ly.places]].forEach(([layer, on]) => {
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    });
    // Outlines sit under the dots on the shared canvas.
    [villageLayer, peakLayer, areaLayer].forEach((g) => { if (map.hasLayer(g)) g.eachLayer((l) => l.bringToBack && l.bringToBack()); });
    M.refresh();
  };

  // ---------------------------------------------------------------------------
  // Focus / popups
  // ---------------------------------------------------------------------------
  M.focus = function (pid) {
    const p = UW.property(pid);
    if (!p) return;
    const near = UW.nearest(p);
    const pts = (p.geo ? [[p.geo.lat, p.geo.lng]] : []).concat(near.map((x) => [x.l.lat, x.l.lng]));
    if (!pts.length) return;
    if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 15, duration: 0.7 });
    else map.flyTo([p.geo.lat, p.geo.lng], 15, { duration: 0.7 });
  };
  M.invalidate = () => map && map.invalidateSize();

  function openListing(id) {
    const m = dotById.get(id);
    if (!m) return;
    if (!map.getBounds().contains(m.getLatLng())) map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: false });
    showPopup(m);
  }
  M.openListing = openListing;

  function listingPopup(l) {
    const p = UW.ui.selected ? UW.property(UW.ui.selected) : null;
    const v = p && UW.activeVersion(p);
    const inSet = v && v.comps.some((c) => UW.compId(c) === l.id);
    const full = v && v.comps.length >= 15;
    const d = p && p.geo ? UWGeo.miles(p.geo.lat, p.geo.lng, l.lat, l.lng) : null;
    const a = UW.areaById[l.area], F = UW.fmt;
    const row = (k, val) => "<dt>" + k + "</dt><dd>" + val + "</dd>";
    const amen = UW.ICON_ORDER.concat(["movie_theater", "golf_simulator", "gym", "outdoor_dining_area", "crib", "pack_n_play_travel_crib", "lake_access"]).filter((k) => l.flagSet.has(k));
    const picked = UW.ui.picked.has(l.id);
    let btn = '<button type="button" class="uw-btn ' + (picked ? "uw-btn--ghost" : "uw-btn--primary") + '" data-act="pop-pick" data-id="' + l.id + '">' + (picked ? "✓ Selected · remove from selection" : "Select this comp") + "</button>";
    if (!p) btn += "";
    else if (inSet) btn += '<button type="button" class="uw-btn uw-btn--ghost" data-act="pop-remove" data-id="' + l.id + '">In the comp set for ' + E(p.street) + " · remove</button>";
    else if (full) btn += '<p class="uw-pop__hint">The comp set for ' + E(p.street) + " already has 15 rows (the sheet's limit).</p>";
    else btn += '<button type="button" class="uw-btn uw-btn--ghost" data-act="pop-add" data-id="' + l.id + '">Add to comp set for ' + E(p.street) + "</button>";
    btn += '<button type="button" class="uw-btn uw-btn--ghost" data-act="pop-copy" data-id="' + l.id + '">Copy row</button>' +
      '<p class="uw-pop__hint">Copy row = the UW sheet’s 15 comp columns; note: ' + E(UW.noteFor(l, p)) + "</p>";
    return '<div class="uw-pop"><p class="uw-pop__kicker">Airbnb comp' + (l.quality === "Possibly Good" ? ' · <span class="uw-tag uw-tag--possibly">possibly good</span>' : "") + '</p><a class="uw-pop__title" href="' + E(l.url) + '" target="_blank" rel="noopener">' + E(l.title) + ' <span aria-hidden="true">↗</span></a>' +
      '<p class="uw-pop__rev"><strong>' + F.money(l.revenue) + '</strong> revenue potential · <span class="uw-pop__tier" style="--c:' + UW.TIER_COLORS[l.sizeTop] + '">' + UW.TIER_LABEL[l.sizeTop] + "</span></p>" +
      '<dl class="uw-pop__dl">' +
      row("Earns vs. a typical home its size", F.x(l.vsSize) + " the " + E(l.size.replace("Studio-1BR", "studio–1BR")) + " median") +
      row("Nightly rate · occupancy", F.money2(l.adr) + " · " + F.pct(l.occ, 1)) +
      row("Bedrooms · baths · sleeps · beds", F.beds(l.bedrooms) + " · " + F.num(l.baths) + " · " + F.num(l.sleeps) + " · " + F.num(l.beds)) +
      row("Setting", '<span class="uw-dot" style="background:' + UW.LOC_COLORS[l.loc] + '"></span>' + E(l.loc) + " · " + F.km(l.beachKm) + " to downtown · " + F.km(l.snowKm) + " to Snowbowl") +
      row("Area", '<span class="region-dot" style="background:' + a.color + '"></span>' + E(a.name) + " · ZIP " + E(l.zip || "—") + (l.type === "condo" ? " · condo" : "")) +
      row("Rating", F.num(l.rating) + " from " + (l.reviews == null ? "—" : l.reviews) + " reviews") +
      row("Data quality · listing", E(l.quality || "—") + " · " + E(l.status || "—") + (l.fav ? " · guest favourite" : "")) +
      row("Reviews: with kids · group trips", (l.kids == null ? "—" : Math.round(l.kids) + "%") + " · " + (l.group == null ? "—" : Math.round(l.group) + "%")) +
      row("Market-wide tier", { top10: "Top 10% of the market", top25: "Top 25% of the market", bottom75: "Below the top 25%" }[l.tier]) +
      (d != null ? row("Distance to " + E(p.street), F.mi(d)) : "") +
      "</dl>" +
      '<p class="uw-pop__amen">' + (amen.length ? amen.map((k) => (UW.ICON_SVG[k] ? UW.icon(k) : "") + '<span class="uw-pop__amen-l">' + E(UW.AMEN_LABEL[k]) + "</span>").join("") : '<span class="muted">No amenity flags</span>') + "</p>" +
      btn + "</div>";
  }

  function onMapClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    const pid = b.dataset.pid;
    if (act === "pop-pick") { UW.togglePick(id); map.closePopup(); }
    if (act === "pop-add" || act === "pop-remove") {
      const p = UW.property(UW.ui.selected), v = UW.activeVersion(p), l = UW.byId.get(id);
      if (act === "pop-add") UW.addComp(p.id, v.label, l);
      else UW.actions.removeComp(p.id, v.label, id);
      map.closePopup();
    }
    if (act === "pop-copy") UW.copyListings([UW.byId.get(id)], UW.ui.selected ? UW.property(UW.ui.selected) : null, "");
    if (act === "tp-ver") UW.setVersion(pid, b.dataset.v);
    if (act === "tp-rank") { map.closePopup(); UW.actions.rank(pid, b.dataset.mode); }
    if (act === "tp-card") { map.closePopup(); UW.actions.openCard(pid); }
    if (act === "tp-copy") UW.actions.copyComps(pid);
    if (act === "tp-rev") UW.actions.copyRevenue(pid);
    if (act === "tp-csv") UW.actions.downloadCsv(pid);
    if (act === "place-target") M.startPlace(pid);
    if (act === "place-cancel") cancelPlace();
  }

  // ---------------------------------------------------------------------------
  // Placing / adjusting a pin
  // ---------------------------------------------------------------------------
  M.startPlace = function (pid, label) {
    placing = { pid, label };
    map.closePopup();
    map.getContainer().classList.add("is-placing");
    const p = UW.property(pid);
    let bar = document.getElementById("uw-place-bar");
    if (!bar) { bar = document.createElement("div"); bar.id = "uw-place-bar"; bar.className = "uw-place-bar"; map.getContainer().appendChild(bar); L.DomEvent.disableClickPropagation(bar); }
    bar.innerHTML = "<span>" + (p && p.geo ? "Drag the marker for <strong>" + E(label || p.street) + "</strong> or click the map to move it." : "Click the map where <strong>" + E(label || (p && p.street) || "the property") + "</strong> is.") +
      '</span> <button type="button" class="uw-btn uw-btn--small" data-act="place-cancel">Done</button>';
    bar.hidden = false;
    drawNoPin();
    document.getElementById("uw-map").scrollIntoView({ behavior: "smooth", block: "start" });
    if (p && p.geo) map.flyTo([p.geo.lat, p.geo.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
    M.refresh();
  };
  function finishPlace(ll) {
    const pid = placing.pid;
    UW.setPropertyField(pid, "pin", { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), source: "manual" });
    UW.toast("Pin placed. Drag it to fine-tune, then press Done.");
    M.refresh();
  }
  function cancelPlace() {
    placing = null;
    map.getContainer().classList.remove("is-placing");
    const bar = document.getElementById("uw-place-bar");
    if (bar) bar.hidden = true;
    M.refresh();
    UW.emit("places");
  }
})();
