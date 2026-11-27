/**
 * The Sheet tab of an expanded target: the scenario's own "New Market UW'ing"
 * CSV drawn as the sheet it came from. All 22 columns (A–V), every row (the
 * amortization block included), and every cell exactly as the CSV has it.
 *   Unedited scenarios show the source CSV untouched. Edited ones and new
 *   listings show what Download UW CSV writes (UWCsv.exportSheet), with the
 *   calculated cells recalculated here; the amortization block always stays
 *   as the source wrote it.
 *   Input cells (yellow) are edited in place: price, down payment %, rate,
 *   closing %, the setup list, OPEX amounts, cleaning cost and turns, the
 *   Low / Mid / High revenue and the analyst notes. Comp rows come from the
 *   Comp set tab; rows that aren't valid comps are tinted red.
 */
/* global UWCsv */
(function () {
  const UW = window.UW, E = UW.esc;
  const S = (UW.sheetApi = {});
  const NCOL = 22;
  const LETTERS = Array.from({ length: NCOL }, (_, i) => String.fromCharCode(65 + i));
  const texts = {}, state = {};
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const group = (n, d) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const textOf = (file) => (texts[file] = texts[file] || UW.sourceCsv(file).catch((e) => { delete texts[file]; throw e; }));
  const fileOf = (p, v) => (p.kind === "underwritten" ? v.file : UW.data.uw.templateFile);
  const pristine = (p, v) => p.kind === "underwritten" && v.source === "sheet" && !v.edited.notes && !v.edited.comps;
  const ref = (r, c) => LETTERS[c] + (r + 1);

  // ---------------------------------------------------------------------------
  // The grid: the CSV's rows, padded to A–V
  // ---------------------------------------------------------------------------
  function modelOf(p, v) {
    return Object.assign({}, UW.clone(v.inputs), {
      notes: v.notes, url: p.kind === "underwritten" ? v.url : p.url,
      comps: v.comps.map((c) => ({ url: c.url, revenue: c.revenue, bedrooms: c.bedrooms, sleeps: c.sleeps, adr: c.adr, occupancy: c.occupancy, flags: c.flags, notes: c.notes })),
    });
  }
  function grid(text, p, v) {
    const out = pristine(p, v) ? text : UWCsv.exportSheet(text, modelOf(p, v));
    const rows = UWCsv.parse(out).rows.map((r) => { const a = r.slice(0, NCOL); while (a.length < NCOL) a.push(""); return a; });
    const L = UWCsv.locate(rows);
    return { rows, L, calc: calcCells(rows, L), slots: L.setup.last - L.setup.first + 1 };
  }

  // Calculated cells, found by their row labels, and the output each one shows.
  function findIn(rows, test, r0, r1, col) {
    for (let i = Math.max(0, r0); i <= Math.min(r1, rows.length - 1); i++) if (test(norm(rows[i][col]))) return i;
    return -1;
  }
  function calcCells(rows, L) {
    const out = [], vc = L.price[1], pc = vc - 2, last = rows.length - 1;
    const add = (key, r, c, pct) => { if (r >= 0) out.push({ key, r, c, pct: !!pct, sample: rows[r][c] }); };
    const inPurchase = (re) => findIn(rows, (t) => re.test(t), L.price[0], L.revenue[0][0] - 1, pc);
    add("down", inPurchase(/^down payment/), vc);
    add("loan", inPurchase(/^loan amount/), vc);
    add("closing", inPurchase(/^closing costs/), vc);
    add("setupTotal", inPurchase(/^renovation/), vc);
    add("oop", inPurchase(/^total out of pocket/), vc);
    add("setupTotal", L.setup.last + 1, L.setup.col + 1);
    add("opexMonthly", L.opex.last + 1, L.opex.col + 1);
    add("cleaning", findIn(rows, (t) => t === "cleaning", L.opex.first, L.opex.last, L.opex.col), L.opex.col + 1);
    const r0 = L.revenue[0][0] + 1, taxRow = findIn(rows, (t) => t === "taxes", r0, last, pc);
    const r1 = taxRow > 0 ? taxRow - 1 : r0 + 12;
    [[/^operating expenses/, "opex"], [/^property management/, "pm"], [/^net operating income/, "noi"], [/^debt service/, "ds"],
      [/^free cash ?flow/, "fcf"], [/^cash on cash/, "coc", 1], [/^principal pay ?down/, "principal"], [/appreciation/, "appr"],
      [/^total return$/, "totalReturn", 1], [/^total return \+/, "totalReturnTax", 1]].forEach(([re, k, pct]) => {
      const r = findIn(rows, (t) => re.test(t), r0, r1, pc);
      ["low", "mid", "high"].forEach((c, j) => add("case:" + c + ":" + k, r, L.revenue[j][1], pct));
    });
    if (taxRow > 0) [[/^improvement basis/, "basis"], [/^short life assets/, "slas"], [/^y1 loss/, "y1Loss"], [/^tax savings/, "taxSavings"]]
      .forEach(([re, k]) => add("tax:" + k, findIn(rows, (t) => re.test(t), taxRow, taxRow + 9, pc), pc + 1));
    const fy = findIn(rows, (t) => t === "5 year", r0, last, L.setup.col);
    if (fy > 0) [[/^cash flow/, "cashFlow"], [/^equity/, "equity"], [/^appreciation/, "appreciation"], [/^total$/, "total"]]
      .forEach(([re, k]) => add("five:" + k, findIn(rows, (t) => re.test(t), fy + 1, fy + 6, L.setup.col), L.setup.col + 1));
    return out;
  }
  function valueOf(key, o) {
    const [a, b, c] = key.split(":");
    if (a === "case") return o.cases && o.cases[b] ? o.cases[b][c] : null;
    if (a === "tax") return o.taxes ? o.taxes[b] : null;
    if (a === "five") return o.fiveYear ? o.fiveYear[b] : null;
    return o[key];
  }
  // A recalculated value, written the way that cell already is (" $ 1,234 ", "$1,234", "$1,234.00", "12.34%").
  function fmtLike(sample, v, pct) {
    if (v == null || isNaN(v)) return "";
    const s = String(sample || "").trim();
    if (pct || /%$/.test(s)) { const m = s.match(/\.(\d+)%$/); return (Number(v) * 100).toFixed(m ? m[1].length : pct ? 2 : 0) + "%"; }
    if (/^-?\$[\d,]+\.\d\d$/.test(s)) return (v < 0 ? "-$" : "$") + group(v, 2);
    if (/^-?\$[\d,]+$/.test(s)) return (v < 0 ? "-$" : "$") + group(Math.round(v), 0);
    return UWCsv.acct(v);
  }

  // ---------------------------------------------------------------------------
  // Cells
  // ---------------------------------------------------------------------------
  const ACCT = /^\s*\$\s+(\(?[\d,]+(?:\.\d+)?\)?|-)\s*$/;
  const NUMLIKE = /^\s*-?\(?-?\$?[\d,]+(?:\.\d+)?\)?%?\s*$/;
  const HEAD = /^(purchase details|set up|optimi?zation list.*|operating expenses \(opex\)|monthly|analyst notes|disclaimer|common extras|low|mid|high|taxes|5 year|beginning|ending)$/;
  function show(text) {
    const t = text == null ? "" : String(text);
    if (!t.trim()) return { cls: "", html: "" };
    const m = t.match(ACCT);
    if (m) return { cls: "sh-n", html: '<span class="sh-acct"><span>$</span><span>' + E(m[1]) + "</span></span>" };
    if (NUMLIKE.test(t)) return { cls: "sh-n", html: E(t.trim()) };
    if (/^https?:\/\/\S+$/.test(t.trim())) return { cls: "sh-url", html: '<a href="' + E(t.trim()) + '" target="_blank" rel="noopener">' + E(t.trim()) + "</a>" };
    return { cls: HEAD.test(norm(t)) ? "sh-h" : "", html: E(t) };
  }

  // Input cells and what each one edits.
  function inputsMap(rows, L, v) {
    const m = {}, put = (rc, d) => { m[rc[0] + "," + rc[1]] = d; };
    put(L.price, { sh: "price", f: "acct" });
    put(L.dpPct, { sh: "dpPct", f: "pct", d: 0 });
    put(L.rate, { sh: "rate", f: "pct", d: 2 });
    put(L.closingPct, { sh: "closingPct", f: "pct", d: 2 });
    for (let r = 0; r <= L.setup.last - L.setup.first; r++) {
      put([L.setup.first + r, L.setup.col], { sh: "setupLabel", r, f: "text" });
      put([L.setup.first + r, L.setup.col + 1], { sh: "setupAmt", r, f: "acct" });
    }
    const opex = v.inputs.opex || [];
    for (let i = L.opex.first; i <= L.opex.last; i++) {
      const lab = norm(rows[i][L.opex.col]), k = opex.findIndex((o) => norm(o.label) === lab);
      if (lab && k >= 0 && !opex[k].cleaning) put([i, L.opex.col + 1], { sh: "opex", k, f: "acct" });
    }
    put(L.cleaningCost, { sh: "cleanCost", f: "acct" });
    put(L.cleaningTurns, { sh: "cleanTurns", f: "num" });
    ["low", "mid", "high"].forEach((c, j) => put(L.revenue[j], { sh: "rev", k: c, f: "acct" }));
    put(L.notes, { sh: "notes", f: "notes" });
    // The comp table: every cell of every filled row. A row is tied to its comp by its URL (the table's
    // row order is the sheet's, which can differ from the stored order), so an edit can't land on another comp.
    for (let i = L.comps.first; i <= L.comps.last; i++) {
      const url = String(rows[i][L.comps.col] || "").trim(), ci = url ? (v.comps || []).findIndex((c) => String(c.url || "").trim() === url) : -1;
      for (let k = 0; k < 15; k++) put([i, L.comps.col + k], { sh: "comp", ci, k, cr: i - L.comps.first, f: "comp" });
    }
    return m;
  }
  const COMP_LABEL = ["Listing URL", "Revenue Potential", "Bedrooms", "Sleeps", "ADR", "Occupancy", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Amenity 1 or 0", "Notes"];
  const LABEL = { price: "Purchase price", dpPct: "Down payment %", rate: "Interest rate", closingPct: "Closing costs %", setupLabel: "Setup item", setupAmt: "Setup item cost",
    opex: "Monthly OPEX", cleanCost: "Cleaning cost", cleanTurns: "Number of turns", rev: "Forecasted revenue", notes: "Analyst notes" };
  function inputCell(d, text, i, j, spanAttr) {
    const attrs = ' data-sh="' + d.sh + '"' + (d.r != null ? ' data-r="' + d.r + '"' : "") + (d.k != null ? ' data-k="' + d.k + '"' : "") + (d.d != null ? ' data-dec="' + d.d + '"' : "") +
      ' aria-label="' + E(LABEL[d.sh] + (d.k != null && d.sh === "rev" ? " (" + d.k + ")" : "") + ", cell " + ref(i, j)) + '" spellcheck="false"';
    const t = String(text || "");
    if (d.f === "comp") {
      const ca = ' data-sh="comp" data-ci="' + d.ci + '" data-cr="' + d.cr + '" data-k="' + d.k + '" aria-label="' + E((d.ci < 0 ? "New comp row" : "Comp " + (d.ci + 1)) + ", " + COMP_LABEL[d.k] + ", cell " + ref(i, j)) + '" spellcheck="false"';
      return '<td class="sh-in sh-comp sh-comp--' + (d.k === 0 ? "url" : d.k === 14 ? "notes" : d.k > 5 ? "flag" : "n") + '"><input class="sh-input" type="text" value="' + E(t.trim()) + '"' + ca + "></td>";
    }
    if (d.f === "notes") return '<td class="sh-in sh-block"' + spanAttr + '><textarea class="sh-notes"' + attrs + ">" + E(t) + "</textarea></td>";
    if (d.f === "text") return '<td class="sh-in sh-in--text"><div class="sh-ce" contenteditable="plaintext-only" role="textbox"' + attrs + ">" + E(t) + "</div></td>";
    if (d.f === "acct") {
      const m = t.match(ACCT), shown = m ? m[1] : t.trim();
      return '<td class="sh-in sh-n' + (shown ? "" : " is-empty") + '"><span class="sh-acct"><span>$</span><input class="sh-input" type="text" inputmode="decimal" value="' + E(shown) + '"' + attrs + "></span></td>";
    }
    return '<td class="sh-in sh-n"><input class="sh-input" type="text" inputmode="decimal" value="' + E(t.trim()) + '"' + attrs + "></td>";
  }

  // Long text (the analyst notes, the disclaimers) spans the empty cells beside and below it, as in the sheet.
  function merges(rows, L, inMap) {
    const span = {}, covered = new Set();
    rows.forEach((r, i) => r.forEach((t, j) => {
      const key = i + "," + j;
      if (covered.has(key) || !(t.length > 200 || /\n/.test(t)) || (inMap[key] && inMap[key].sh !== "notes")) return;
      let w = 1;
      while (j + w < NCOL && !r[j + w] && !inMap[i + "," + (j + w)]) w++;
      if (w === 1) return;
      let h = 1;
      while (i + h < rows.length && h < 24 && rows[i + h].slice(j, j + w).every((x, b) => !x && !inMap[(i + h) + "," + (j + b)])) h++;
      span[key] = { w, h };
      for (let a = 0; a < h; a++) for (let b = 0; b < w; b++) if (a || b) covered.add((i + a) + "," + (j + b));
    }));
    return { span, covered };
  }

  // Comp rows that aren't valid comps, tinted with their reason.
  function badComps(rows, L, v) {
    const out = {};
    for (let i = L.comps.first; i <= L.comps.last; i++) {
      const url = (rows[i][L.comps.col] || "").trim();
      if (!url) continue;
      const c = v.comps.find((x) => (x.url || "").trim() === url);
      if (c && !c.valid) out[i] = c.label + (c.reason ? ": " + c.reason : "");
    }
    return out;
  }

  function tableHtml(G, v) {
    const { rows, L, calc } = G;
    const inMap = inputsMap(rows, L, v);
    const calcAt = {};
    calc.forEach((x, n) => { calcAt[x.r + "," + x.c] = n; });
    const edited = v.source !== "sheet";
    const { span, covered } = merges(rows, L, inMap);
    const bad = badComps(rows, L, v);
    const compHead = L.comps.first - 1;
    let h = '<table class="sh-t"><thead><tr><th class="sh-corner" scope="col"><span class="visually-hidden">Row</span></th>' +
      LETTERS.map((l) => '<th scope="col" class="sh-col sh-col--' + l + '">' + l + "</th>").join("") + "</tr></thead><tbody>";
    rows.forEach((r, i) => {
      h += '<tr><th scope="row" class="sh-row">' + (i + 1) + "</th>";
      for (let j = 0; j < NCOL; j++) {
        const key = i + "," + j;
        if (covered.has(key)) continue;
        const sp = span[key], spanAttr = sp ? ' colspan="' + sp.w + '" rowspan="' + sp.h + '"' : "";
        const d = inMap[key];
        if (d) { h += inputCell(d, r[j], i, j, spanAttr); continue; }
        const badCls = bad[i] && j >= L.comps.col ? " sh-bad" : "";
        const badTitle = bad[i] && j === L.comps.col ? ' title="' + E(bad[i]) + '"' : "";
        if (calcAt[key] != null) {
          const x = calc[calcAt[key]];
          const s = show(edited ? fmtLike(x.sample, valueOf(x.key, v.outputs), x.pct) : r[j]);
          h += '<td class="sh-calc ' + s.cls + badCls + '" data-sc="' + calcAt[key] + '">' + s.html + "</td>";
          continue;
        }
        if (sp) { h += '<td class="sh-block"' + spanAttr + '><div class="sh-block__in">' + E(r[j]) + "</div></td>"; continue; }
        const s = show(r[j]);
        const free = (k) => j + k >= NCOL || (!r[j + k] && !inMap[i + "," + (j + k)] && !covered.has(i + "," + (j + k)));
        const spill = r[j] && s.cls !== "sh-n" && i !== compHead && free(1) && free(2) && free(3);
        const cls = (s.cls + (spill ? " sh-spill" : "") + (i === compHead && j >= L.comps.col && r[j] ? " sh-h" : "") + badCls).trim();
        h += "<td" + (cls ? ' class="' + cls + '"' : "") + badTitle + ">" + (spill ? '<div class="sh-spill__in">' + s.html + "</div>" : s.html) + "</td>";
      }
      h += "</tr>";
    });
    return h + "</tbody></table>";
  }

  // ---------------------------------------------------------------------------
  // Mount / refresh
  // ---------------------------------------------------------------------------
  S.html = function (p, v) {
    const isUW = p.kind === "underwritten", file = fileOf(p, v);
    const edited = v.source !== "sheet";
    return '<div class="sh-legend"><p><strong>' + E(file.replace(/\.csv$/, "")) + "</strong>" + (isUW ? "" : " <span class=\"muted\">(the template, with this listing’s inputs)</span>") +
      ' · every cell as the CSV has it, columns A–V. <span class="sh-swatch" aria-hidden="true"></span>Yellow cells are inputs: click one to edit it, and the totals and returns update as you type. The comp table works like Google Sheets: paste rows copied from Sheets or Excel into any cell and they fill right and down; drag, Shift+click or click a row number to select, then copy, cut or Delete; arrows and Enter move between cells. A row with a Listing URL is a comp; the rows are put back in revenue order the next time the sheet is opened.</p>' +
      '<p class="sh-legend__edited"' + (edited ? "" : " hidden") + ">Edited: totals and returns are recalculated here. The amortization block stays as the sheet wrote it, and Download UW CSV copies it byte for byte.</p></div>" +
      '<div class="uw-sheet" data-pid="' + E(p.id) + '" data-label="' + E(v.label) + '"><p class="uw-hint">Loading the sheet…</p></div>';
  };
  S.fill = function (root) {
    (root || document).querySelectorAll('.uw-pane:not([hidden]) .uw-sheet:not([data-ready])').forEach((el) => {
      const p = UW.property(el.dataset.pid);
      if (!p) return;
      const file = fileOf(p, UW.activeVersion(p));
      el.dataset.ready = "loading";
      textOf(file).then((text) => {
        if (!el.isConnected) return;
        const v = UW.activeVersion(p);
        const G = grid(text, p, v);
        state[p.id] = Object.assign(G, { label: v.label });
        el.innerHTML = '<div class="sh-wrap" tabindex="0" aria-label="Sheet for ' + E(p.street) + '">' + tableHtml(G, v) + "</div>";
        el.dataset.ready = "1";
      }).catch((err) => {
        el.innerHTML = '<p class="uw-empty">Couldn’t draw the sheet from ' + E(file) + ": " + E(err.message) + "</p>";
        el.dataset.ready = "error";
      });
    });
  };
  // Recalculated cells only; never the field being typed in.
  S.refresh = function (card, p, v) {
    const st = state[p.id], host = card.querySelector('.uw-sheet[data-ready="1"]');
    if (!st || !host || st.label !== v.label) return;
    const edited = v.source !== "sheet";
    host.querySelectorAll("[data-sc]").forEach((td) => {
      const x = st.calc[+td.dataset.sc];
      const s = show(edited ? fmtLike(x.sample, valueOf(x.key, v.outputs), x.pct) : st.rows[x.r][x.c]);
      td.className = ("sh-calc " + s.cls).trim();
      td.innerHTML = s.html;
    });
    const note = card.querySelector(".sh-legend__edited");
    if (note) note.hidden = !edited;
  };

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------
  function parseNum(s) {
    let t = String(s == null ? "" : s).trim();
    if (!t) return null;
    if (t === "-") return 0;
    const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
    t = t.replace(/[$,%()\s-]/g, "");
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : neg ? -n : n;
  }
  const acctNum = (x) => { const m = UWCsv.acct(x).match(ACCT); return m ? m[1] : ""; };
  // The setup item in slot r: by its saved row, else where the sheet places it (see UWCsv.placeSetup).
  function setupIndex(I, r, st) {
    const items = I.setup || [];
    if (items.every((x) => Number.isInteger(x.row))) return items.findIndex((x) => x.row === r);
    return st ? UWCsv.placeSetup(st.rows, st.L, items)[r] : -1;
  }
  const setupAt = (I, r, st) => { const k = setupIndex(I, r, st); return k >= 0 ? I.setup[k] : null; };
  // What a cell shows when it isn't being edited (the sheet's own format).
  function shown(ds, v, st) {
    const I = v.inputs, n = (x) => (x == null ? "" : x);
    switch (ds.sh) {
      case "price": return acctNum(I.price);
      case "dpPct": case "rate": case "closingPct": return I[ds.sh] == null ? "" : UWCsv.pctCell(I[ds.sh], +ds.dec);
      case "rev": return acctNum(I.revenue[ds.k]);
      case "opex": return acctNum(I.opex[+ds.k].amount);
      case "cleanCost": return acctNum(I.cleaningCost);
      case "cleanTurns": return I.cleaningTurns == null ? "" : String(Math.round(I.cleaningTurns * 100) / 100);
      case "setupAmt": { const it = setupAt(I, +ds.r, st); return it ? acctNum(it.amount) : null; }
      case "setupLabel": { const it = setupAt(I, +ds.r, st); return it ? n(it.label) : null; }
    }
    return null;
  }
  // What it shows while being edited: the plain number.
  function raw(ds, v, st) {
    const I = v.inputs, n = (x) => (x == null ? "" : String(+Number(x).toFixed(4)));
    switch (ds.sh) {
      case "price": return n(I.price);
      case "dpPct": case "rate": case "closingPct": return I[ds.sh] == null ? "" : n(I[ds.sh] * 100);
      case "rev": return n(I.revenue[ds.k]);
      case "opex": return n(I.opex[+ds.k].amount);
      case "cleanCost": return n(I.cleaningCost);
      case "cleanTurns": return n(I.cleaningTurns);
      case "setupAmt": { const it = setupAt(I, +ds.r, st); return it ? n(it.amount) : null; }
    }
    return null;
  }
  // Give every setup item the row it sits in, so renaming one never moves it.
  function pinRows(items, st) {
    if (items.every((x) => Number.isInteger(x.row))) return;
    UWCsv.placeSetup(st.rows, st.L, items).forEach((k, r) => { if (k >= 0) items[k].row = r; });
  }
  const ctx = (t) => {
    const card = t.closest && t.closest(".uw-card");
    const p = card && UW.property(card.dataset.pid);
    return p ? { card, p, v: UW.activeVersion(p), st: state[p.id] } : null;
  };

  function onInput(e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.sh) return;
    const c = ctx(t);
    if (!c || !c.st) return;
    const { p, v, st } = c, sh = t.dataset.sh;
    if (sh === "comp") return;  // saved when you leave the cell (onCompChange)
    if (sh === "notes") { UW.setNotes(p.id, v.label, t.value.replace(/\r\n/g, "\n")); return; }
    const text = t.isContentEditable ? t.textContent : t.value;
    const inputs = UW.clone(v.inputs), n = parseNum(text), pct = (x) => (x == null ? null : x / 100);
    switch (sh) {
      case "price": inputs.price = n; break;
      case "dpPct": case "rate": case "closingPct": inputs[sh] = pct(n); break;
      case "rev": inputs.revenue = Object.assign({}, inputs.revenue, { [t.dataset.k]: n }); break;
      case "opex": inputs.opex[+t.dataset.k].amount = n; break;
      case "cleanCost": inputs.cleaningCost = n; break;
      case "cleanTurns": inputs.cleaningTurns = n; break;
      case "setupLabel": case "setupAmt": {
        inputs.setup = inputs.setup || [];
        pinRows(inputs.setup, st);
        const r = +t.dataset.r;
        let k = inputs.setup.findIndex((x) => x.row === r);
        if (k < 0) {
          if (inputs.setup.length >= st.slots) return;
          inputs.setup.push({ label: "", amount: null, row: r });
          k = inputs.setup.length - 1;
        }
        if (sh === "setupLabel") inputs.setup[k].label = text.replace(/\n/g, " "); else inputs.setup[k].amount = n;
        break;
      }
      default: return;
    }
    const td = t.closest("td");
    if (td && td.querySelector(".sh-acct")) td.classList.toggle("is-empty", !text.trim());
    UW.setInputs(p.id, v.label, inputs);
  }
  function onFocus(e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.sh || t.dataset.sh === "notes" || t.dataset.sh === "setupLabel") return;
    if (t.dataset.sh === "comp") { if (t.select) t.select(); return; }
    const c = ctx(t);
    if (!c) return;
    const r = raw(t.dataset, c.v, c.st);
    if (r != null) t.value = r;
    if (t.select) t.select();
  }
  function onBlur(e) {
    const t = e.target;
    if (!t.dataset || !t.dataset.sh || t.dataset.sh === "notes" || t.dataset.sh === "comp") return;
    const c = ctx(t);
    if (!c) return;
    let { p, v } = c;
    if (t.dataset.sh === "setupLabel" || t.dataset.sh === "setupAmt") {
      // A setup row left with neither a label nor a cost is removed (the sheet row goes blank).
      const r = +t.dataset.r, k = setupIndex(v.inputs, r, c.st);
      const it = k >= 0 ? v.inputs.setup[k] : null;
      const other = c.card.querySelector('[data-sh="' + (t.dataset.sh === "setupLabel" ? "setupAmt" : "setupLabel") + '"][data-r="' + r + '"]');
      if (it && !String(it.label || "").trim() && it.amount == null && other !== e.relatedTarget) {
        const inputs = UW.clone(v.inputs);
        inputs.setup.splice(k, 1);
        UW.setInputs(p.id, v.label, inputs);
        v = UW.activeVersion(p);
      }
    }
    const s = shown(t.dataset, v, c.st) || "";
    if (t.isContentEditable) { if (t.textContent !== s) t.textContent = s; } else t.value = s;
    const td = t.closest("td");
    if (td && td.querySelector(".sh-acct")) td.classList.toggle("is-empty", !s.trim());
  }

  // ---------------------------------------------------------------------------
  // The comp table works like a spreadsheet grid (Google Sheets / Excel):
  //  - paste a block (rows x columns, tab separated, as Sheets and Excel copy it) from the cell
  //    you are in: it fills to the right and down; a header row ("Listing URL ...") is skipped;
  //    one value pasted onto a selected range fills the range;
  //  - click-drag, Shift+click or Shift+arrows select a range; the row number selects a row;
  //    Cmd/Ctrl+C copies the range as tab-separated rows, Cmd/Ctrl+X cuts, Delete clears;
  //  - arrows move between cells (Left/Right once the caret is at the edge of the text),
  //    Enter moves down, Tab moves right, Esc puts the cell back.
  // A row is a comp once it has a Listing URL; clearing the URL takes the comp out (with Undo).
  // The stored comps stay in revenue order; on screen the rows don't jump (each row's data-ci
  // is re-pointed to its comp's place in the stored order).
  // ---------------------------------------------------------------------------
  const FLAG_ON = /^(1|y|yes|true|x|✓)$/i;
  const NCOMP = 15, NROW = 15;
  let sel = null, dragging = false;   // sel = {card, ar, ak (anchor), r, k (other corner)}

  const compCell = (card, r, k) => card.querySelector('input[data-sh="comp"][data-cr="' + r + '"][data-k="' + k + '"]');
  const isComp = (t) => t && t.dataset && t.dataset.sh === "comp";
  const rect = (s) => ({ r0: Math.min(s.ar, s.r), r1: Math.max(s.ar, s.r), k0: Math.min(s.ak, s.k), k1: Math.max(s.ak, s.k) });
  const multi = () => sel && (sel.ar !== sel.r || sel.ak !== sel.k);

  function paint() {
    document.querySelectorAll(".sh-t td.is-sel").forEach((td) => td.classList.remove("is-sel", "sel-t", "sel-b", "sel-l", "sel-r"));
    if (!multi() || !sel.card.isConnected) return;
    const R = rect(sel);
    for (let r = R.r0; r <= R.r1; r++) for (let k = R.k0; k <= R.k1; k++) {
      const el = compCell(sel.card, r, k), td = el && el.closest("td");
      if (!td) continue;
      td.classList.add("is-sel");
      if (r === R.r0) td.classList.add("sel-t");
      if (r === R.r1) td.classList.add("sel-b");
      if (k === R.k0) td.classList.add("sel-l");
      if (k === R.k1) td.classList.add("sel-r");
    }
  }
  function setSel(card, ar, ak, r, k) { sel = { card, ar, ak, r: r == null ? ar : r, k: k == null ? ak : k }; paint(); }
  function goTo(card, r, k, extend) {
    r = Math.max(0, Math.min(NROW - 1, r)); k = Math.max(0, Math.min(NCOMP - 1, k));
    if (extend && sel && sel.card === card) { sel.r = r; sel.k = k; paint(); const el = compCell(card, r, k); if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" }); return; }
    const el = compCell(card, r, k);
    if (!el) return;
    setSel(card, r, k);
    el.focus();
  }

  // Tab-separated text as Sheets / Excel put it on the clipboard (a cell with a tab, newline or quote is quoted).
  function parseTSV(text) {
    const rows = [];
    let row = [], cell = "", q = false, i = 0;
    text = String(text).replace(/\r\n?/g, "\n");
    for (; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"' && cell === "") q = true;
      else if (ch === "\t") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const tsvCell = (x) => (/[\t\n"]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x);

  // Read the cells of the touched rows back into comps and save. touched = Set of inputs whose text changed.
  function syncComps(card, touched) {
    const c = ctx(card);
    if (!c || !c.st) return;
    const { p, v } = c, flagKeys = c.st.L.comps.flags, prev = v.comps || [];
    const rowsTouched = new Set([...touched].map((el) => +el.dataset.cr));
    const out = [], rowComp = [];
    let bad = 0;
    for (let r = 0; r < NROW; r++) {
      const ins = []; for (let k = 0; k < NCOMP; k++) ins.push(compCell(card, r, k));
      if (!ins[0]) { rowComp.push(null); continue; }
      const ci = +ins[0].dataset.ci, old = ci >= 0 ? prev[ci] : null;
      if (!rowsTouched.has(r)) { if (old) { out.push(old); rowComp.push(old); } else rowComp.push(null); continue; }
      const url = ins[0].value.trim();
      if (!url) { rowComp.push(null); continue; }   // not a comp (yet): what was typed stays on screen
      const comp = old ? Object.assign({}, old, { flags: Object.assign({}, old.flags) }) : { url, revenue: null, bedrooms: null, sleeps: null, adr: null, occupancy: null, flags: {}, notes: "" };
      if (comp.url !== url) { comp.url = url; delete comp.id; delete comp.match; }
      ["revenue", "bedrooms", "sleeps", "adr", "occupancy"].forEach((f, j) => {
        const el = ins[j + 1], text = el.value.trim();
        if (!touched.has(el) && old) return;
        if (!text) { comp[f] = null; return; }
        let n = parseNum(text);
        if (n == null) { bad++; return; }   // not a number: the cell goes back to what it was
        // Occupancy: "41.5%" or "41.5" is a percent; 0.415 (a fraction, as some sheets copy it) is taken as is.
        if (f === "occupancy") n = /%/.test(text) || n > 1 ? Math.round(Math.max(0, n) * 100) / 10000 : Math.max(0, n);
        comp[f] = n;
      });
      flagKeys.forEach((f, j) => { const el = ins[6 + j]; if (touched.has(el) || !old) comp.flags[f] = FLAG_ON.test(el.value.trim()) ? 1 : 0; });
      if (touched.has(ins[14]) || !old) comp.notes = ins[14].value;
      out.push(comp); rowComp.push(comp);
    }
    const removed = prev.filter((x) => !out.includes(x));
    const before = prev.map((x) => Object.assign({}, x, { flags: Object.assign({}, x.flags) }));
    UW.setComps(p.id, v.label, out, { quiet: true });
    const order = UWCsv.sortComps(out);
    rowComp.forEach((comp, r) => {
      for (let k = 0; k < NCOMP; k++) {
        const el = compCell(card, r, k);
        if (!el) continue;
        el.dataset.ci = comp ? order.indexOf(comp) : -1;
        if (comp && rowsTouched.has(r)) el.value = compText(comp, k, flagKeys);
      }
    });
    if (bad) UW.toast(bad + " cell" + (bad === 1 ? " was" : "s were") + " not a number and kept the old value", "warn");
    if (removed.length) {
      UW.toast(removed.length + " comp" + (removed.length === 1 ? "" : "s") + " taken out (Listing URL cleared)", "", { label: "Undo", fn: () => {
        UW.setComps(p.id, v.label, before, { quiet: true }); UW.cardsApi.renderCard(p.id); UW.emit("property", p.id);
      } });
    }
    UW.emit("property", p.id);
  }

  function writeCells(card, cells) {   // cells: [[r, k, text]]
    const touched = new Set();
    cells.forEach(([r, k, text]) => { const el = compCell(card, r, k); if (el && el.value !== text) { el.value = text; touched.add(el); } });
    if (touched.size) syncComps(card, touched);
    return touched.size;
  }
  function rangeText(card) {
    const R = rect(sel), lines = [];
    for (let r = R.r0; r <= R.r1; r++) {
      const row = [];
      for (let k = R.k0; k <= R.k1; k++) { const el = compCell(card, r, k); row.push(tsvCell(el ? el.value : "")); }
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  }
  function clearRange(card) {
    const R = rect(sel), cells = [];
    for (let r = R.r0; r <= R.r1; r++) for (let k = R.k0; k <= R.k1; k++) cells.push([r, k, ""]);
    writeCells(card, cells);
  }

  function onPaste(e) {
    const t = e.target;
    if (!isComp(t)) return;
    const text = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
    let grid = parseTSV(text);
    const one = grid.length === 1 && grid[0].length === 1;
    if (one && !multi()) return;   // a single value into a single cell: the normal paste (saved when you leave the cell)
    e.preventDefault();
    const card = t.closest(".uw-card");
    if (grid.length && /listing\s*url/i.test(grid[0][0] || "")) grid = grid.slice(1);   // a copied header row
    if (!grid.length) return;
    const cells = [];
    let lost = 0;
    if (one) {
      const R = rect(sel);
      for (let r = R.r0; r <= R.r1; r++) for (let k = R.k0; k <= R.k1; k++) cells.push([r, k, grid[0][0].trim()]);
    } else {
      const R = multi() ? rect(sel) : null, r0 = R ? R.r0 : +t.dataset.cr, k0 = R ? R.k0 : +t.dataset.k;
      grid.forEach((row, i) => row.forEach((x, j) => {
        if (r0 + i < NROW && k0 + j < NCOMP) cells.push([r0 + i, k0 + j, x.trim()]); else if (x.trim()) lost++;
      }));
      const h = Math.min(grid.length, NROW - r0), w = Math.min(Math.max(...grid.map((r) => r.length)), NCOMP - k0);
      setSel(card, r0, k0, r0 + h - 1, k0 + w - 1);
    }
    writeCells(card, cells);
    if (lost) UW.toast(lost + " pasted cell" + (lost === 1 ? "" : "s") + " fell outside the comp table (15 rows x 15 columns) and were left out", "warn");
  }
  function onCopy(e, cut) {
    const t = e.target;
    if (!isComp(t) || !multi() || sel.card !== t.closest(".uw-card")) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", rangeText(sel.card));
    if (cut) clearRange(sel.card);
  }
  function onKey(e) {
    const t = e.target;
    if (!isComp(t)) return;
    const card = t.closest(".uw-card"), r = +t.dataset.cr, k = +t.dataset.k;
    const len = t.value.length, a = t.selectionStart, b = t.selectionEnd, all = a === 0 && b === len;
    if (!sel || sel.card !== card || (!multi() && (sel.ar !== r || sel.ak !== k))) setSel(card, r, k);
    const sr = sel.r, sk = sel.k;   // the moving corner
    switch (e.key) {
      case "ArrowUp": case "ArrowDown": {
        e.preventDefault();
        const d = e.key === "ArrowUp" ? -1 : 1;
        if (e.shiftKey) goTo(card, sr + d, sk, true); else { t.blur(); goTo(card, r + d, k); }
        return;
      }
      case "ArrowLeft": case "ArrowRight": {
        const d = e.key === "ArrowLeft" ? -1 : 1;
        if (e.shiftKey && (all || multi())) { e.preventDefault(); goTo(card, sr, sk + d, true); return; }
        if (e.shiftKey) return;   // selecting text inside the cell
        if (all || (d < 0 && a === 0 && b === 0) || (d > 0 && a === len && b === len)) { e.preventDefault(); t.blur(); goTo(card, r, k + d); }
        return;
      }
      case "Enter": e.preventDefault(); t.blur(); goTo(card, r + (e.shiftKey ? -1 : 1), k); return;
      case "Delete": case "Backspace":
        if (multi()) { e.preventDefault(); clearRange(card); }
        return;
      case "Escape": {
        const c = ctx(card), ci = +t.dataset.ci, comp = c && ci >= 0 ? c.v.comps[ci] : null;
        t.value = comp ? compText(comp, k, c.st.L.comps.flags) : "";
        t.select();
        return;
      }
      case "a":
        if ((e.metaKey || e.ctrlKey) && all) { e.preventDefault(); setSel(card, 0, 0, NROW - 1, NCOMP - 1); }   // second Cmd+A: the whole table
        return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && multi()) setSel(card, r, k);   // typing collapses the range to the cell
  }
  function onDown(e) {
    const th = e.target.closest && e.target.closest("th.sh-row");
    if (th) {   // a row number: select that comp row
      const tr = th.parentElement, el = tr.querySelector('input[data-sh="comp"]');
      if (!el) return;
      e.preventDefault();
      const card = el.closest(".uw-card"), r = +el.dataset.cr;
      if (e.shiftKey && sel && sel.card === card) { sel.ak = 0; sel.r = r; sel.k = NCOMP - 1; paint(); return; }
      else setSel(card, r, 0, r, NCOMP - 1);
      el.focus({ preventScroll: true }); el.select();
      return;
    }
    const t = e.target;
    if (!isComp(t)) { if (sel && !(e.target.closest && e.target.closest(".uw-toast"))) { sel = null; paint(); } return; }
    const card = t.closest(".uw-card"), r = +t.dataset.cr, k = +t.dataset.k;
    if (e.shiftKey && sel && sel.card === card) { e.preventDefault(); sel.r = r; sel.k = k; paint(); return; }
    setSel(card, r, k);
    dragging = true;
    // As in Sheets, the first click selects the cell (typing replaces it; double-click edits inside it).
    // It also stops the browser treating a drag from here as text selection, which scrolls the sheet.
    if ((document.activeElement !== t || !t.dataset.editing) && e.button === 0) { e.preventDefault(); t.focus({ preventScroll: true }); t.select(); }
  }
  function onOver(e) {
    if (!dragging || !sel) return;
    const td = e.target.closest && e.target.closest("td"), el = td && td.querySelector('input[data-sh="comp"]');
    if (!el || el.closest(".uw-card") !== sel.card) return;
    const r = +el.dataset.cr, k = +el.dataset.k;
    if (r === sel.r && k === sel.k) return;
    sel.r = r; sel.k = k; paint();
    const a = compCell(sel.card, sel.ar, sel.ak);
    if (a && document.activeElement === a && a.setSelectionRange) a.setSelectionRange(0, a.value.length);
  }
  function initGrid(lists) {
    lists.addEventListener("change", (e) => { if (isComp(e.target)) syncComps(e.target.closest(".uw-card"), new Set([e.target])); });
    lists.addEventListener("paste", onPaste);
    lists.addEventListener("copy", (e) => onCopy(e, false));
    lists.addEventListener("cut", (e) => onCopy(e, true));
    lists.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    lists.addEventListener("mouseover", onOver);
    // Edit mode (caret inside the cell): after typing in it or a double-click. Otherwise a drag selects cells.
    lists.addEventListener("dblclick", (e) => { if (isComp(e.target)) { const n = e.target.value.length; e.target.dataset.editing = "1"; e.target.setSelectionRange(n, n); } });
    lists.addEventListener("input", (e) => { if (isComp(e.target)) e.target.dataset.editing = "1"; });
    lists.addEventListener("focusout", (e) => { if (isComp(e.target)) delete e.target.dataset.editing; });
    document.addEventListener("mouseup", () => { dragging = false; });
    UW.on && UW.on("property", () => { if (sel && !sel.card.isConnected) { sel = null; } });
  }

  // What a comp cell shows once saved (the sheet's own formats).
  function compText(c, k, flags) {
    if (k >= 6 && k <= 13) return flags && c.flags ? (c.flags[flags[k - 6]] ? "1" : "0") : "";
    switch (k) {
      case 0: return c.url || "";
      case 1: return c.revenue == null ? "" : UWCsv.dollars2(c.revenue);
      case 2: return c.bedrooms == null ? "" : String(Math.round(c.bedrooms * 100) / 100);
      case 3: return c.sleeps == null ? "" : String(Math.round(c.sleeps * 100) / 100);
      case 4: return c.adr == null ? "" : UWCsv.dollars2(c.adr);
      case 5: return c.occupancy == null ? "" : UWCsv.pctCell(c.occupancy, 2);
      case 14: return c.notes || "";
    }
    return "";
  }

  S.init = function () {
    const lists = document.getElementById("uw-lists");
    initGrid(lists);
    lists.addEventListener("input", onInput);
    lists.addEventListener("focusin", onFocus);
    lists.addEventListener("focusout", onBlur);
  };
})();
