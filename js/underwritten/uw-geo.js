/**
 * Location rules for underwritten.html (Flagstaff, AZ), the same as the Python
 * pipeline (../notebooks/market_common.py and scripts/build_underwritten.py):
 *  - distance to downtown: straight line to Heritage Square on market_common's
 *    local km projection (kept in the field the shared code calls beachKm);
 *  - setting: Downtown within 1 km of Heritage Square, else In the city inside the
 *    City of Flagstaff limits (US Census TIGER rings, even-odd rule: holes are
 *    county islands), else Outside the city. A setting chosen on the card wins;
 *  - distance to Arizona Snowbowl: nearest point of the ski area's OSM outline;
 *  - area: the nearest Airbnb listing's (one of the six clusters; checked
 *    leave-one-out by the build); the "zone" Match by location keeps to is the area;
 *  - Zillow address from the URL slug.
 * Runs in the browser (window.UWGeo) and in Node; tests/test_underwritten.mjs checks it
 * against the build on every point of tests/fixtures/place_check.json.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UWGeo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const COS = Math.cos((35.19 * Math.PI) / 180);
  const xy = (lat, lng) => [(lng + 111.65) * 111 * COS, (lat - 35.19) * 111];  // market_common._xy
  const CITY_LOC = "In the city";
  const CITIES = ["Flagstaff", "Kachina Village", "Munds Park", "Mountainaire", "Parks", "Williams", "Sedona", "Happy Jack", "Mormon Lake"];
  // The settings a card can set, and the setting each one means (the key the shared code calls "waterfront").
  const WATERFRONT_LOC = { Downtown: "Downtown", City: CITY_LOC, Outside: "Outside the city" };
  const LOC_KEY = { Downtown: "Downtown", [CITY_LOC]: "City", "Outside the city": "Outside" };

  let rings = null, down = null, downKm = 1, ski = null, pts = null;
  function init(geo, listings) {
    rings = geo.city.rings;
    down = xy(geo.downtown.lat, geo.downtown.lng);
    downKm = geo.downtown.km;
    ski = geo.ski.ring.map((p) => xy(p[0], p[1]));
    pts = listings.map((l) => ({ xy: xy(l.lat, l.lng), area: l.area }));
  }

  // Even-odd over every ring, the same arithmetic as market_common.in_city.
  function inCity(lat, lng) {
    let inside = false;
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i][0], b = r[i][1], j = (i + 1) % r.length, c = r[j][0], d = r[j][1];
        if ((a > lat) !== (c > lat) && lng < ((d - b) * (lat - a)) / (c - a + 1e-300) + b) inside = !inside;
      }
    }
    return inside;
  }
  function downtownKm(lat, lng) { const [x, y] = xy(lat, lng); return Math.hypot(x - down[0], y - down[1]); }
  function snowKm(lat, lng) {
    const [x, y] = xy(lat, lng);
    let best = Infinity;
    for (const q of ski) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  }

  function areaOf(lat, lng) {
    const [x, y] = xy(lat, lng);
    let best = null, bestD = Infinity;
    pts.forEach((p) => {
      const d = (p.xy[0] - x) ** 2 + (p.xy[1] - y) ** 2;
      if (d < bestD) { bestD = d; best = p.area; }
    });
    return best;
  }

  /** waterfront (= setting key): "Downtown" | "City" | "Outside" | null (null = from the pin). */
  function classify(lat, lng, notesText, waterfront) {
    const km = downtownKm(lat, lng), city = inCity(lat, lng), area = areaOf(lat, lng);
    const auto = km <= downKm ? "Downtown" : city ? CITY_LOC : "Outside the city";
    const loc = waterfront && WATERFRONT_LOC[waterfront] ? WATERFRONT_LOC[waterfront] : auto;
    return { beachKm: Math.round(km * 1000) / 1000, snowKm: Math.round(snowKm(lat, lng) * 100) / 100, inCity: city, area, town: false, zone: area, loc,
      waterfrontDefault: LOC_KEY[auto] };
  }

  // Great-circle miles, for the nearest-comp list.
  function miles(lat1, lng1, lat2, lng2) {
    const R = 3958.8, rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function zillowAddress(url) {
    let path = "";
    try { path = new URL(url).pathname; } catch (e) { return null; }
    const m = path.match(/\/homedetails\/([^/]+)\/(\d+)_zpid/);
    if (!m) return null;
    let tok = m[1].split("-");
    let state = "AZ", zip = null;
    if (tok.length >= 4 && /^[A-Z]{2}$/.test(tok[tok.length - 2]) && /^\d{5}$/.test(tok[tok.length - 1])) {
      state = tok[tok.length - 2]; zip = tok[tok.length - 1]; tok = tok.slice(0, -2);
    }
    let city = null;
    for (const c of CITIES) {
      const ct = c.split(" ");
      if (tok.slice(-ct.length).map((t) => t.toLowerCase()).join(" ") === c.toLowerCase()) { city = c; tok = tok.slice(0, -ct.length); break; }
    }
    if (!city && tok.length > 1) { city = tok[tok.length - 1]; tok = tok.slice(0, -1); }
    const st = [];
    tok.forEach((t) => { if (st.length && t === "2" && st[st.length - 1] === "1") st[st.length - 1] = "1/2"; else st.push(t); });
    const street = st.join(" ");
    return { zpid: m[2], street, city, state, zip, address: street + ", " + city + ", " + state + (zip ? " " + zip : "") };
  }

  function zillowKey(url) {
    try {
      const u = new URL(url);
      return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
    } catch (e) { return null; }
  }

  return { xy, init, beachKm: downtownKm, downtownKm, snowKm, inCity, areaOf, classify, miles, zillowAddress, zillowKey, WATERFRONT_LOC };
});
