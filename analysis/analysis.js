// Analysis page: decile tables and transfer matrices, read from the CSV copies in data/
// (written by scripts/analysis_deciles.py and scripts/analysis_transfers.py).
// One script for analysis/ (English) and analysis/he/ (Hebrew): the page's lang attribute decides.
(function () {
  "use strict";
  var HE = document.documentElement.lang === "he";
  var DATA = HE ? "../data/" : "data/";
  var tr = function (en, he) { return HE ? he : en; };
  // single-election tables: each election's own bloc names (CLAUDE.md, Decided 31 Oct)
  var SIDES = { "2022": [tr("Bibi bloc", "גוש ביבי"), tr("Change bloc", "גוש השינוי")],
                "2026": [tr("Bibi bloc", "גוש ביבי"), tr("Change bloc", "גוש השינוי")] };
  var MEASURE = { wage: tr("Median wage (NIS a year)", "שכר חציוני (ש״ח לשנה)"),
                  degree: tr("Academic degree (%)", "השכלה אקדמית (%)"), young: tr("Aged 0 to 19 (%)", "בני 0 עד 19 (%)") };
  // list names in Hebrew (tables/parties.csv); a name missing here shows as written in the data
  var HE_NAMES = {"Amcha Yisrael": "עמך ישראל", "Balad": "בל״ד", "Blue and White": "כחול לבן",
    "Dawn Social Power": "שחר כוח חברתי", "Did not vote": "לא הצביעו", "HaKahal": "הקהל", "Hadash-Ta'al": "חד״ש-תע״ל",
    "Israel First": "ישראל תחילה", "Jewish Home": "הבית היהודי", "Joint List": "הרשימה המשותפת", "Labor": "העבודה",
    "Likud": "הליכוד", "Meretz": "מרצ", "National Unity": "המחנה הממלכתי", "New Hope": "תקווה חדשה", "Noam": "נעם",
    "Other lists and invalid": "רשימות אחרות ופסולים", "Other lists": "רשימות אחרות", "Otzma Yehudit": "עוצמה יהודית",
    "Ra'am": "רע״ם", "Religious Zionism": "הציונות הדתית", "Religious Zionism and Zehut": "הציונות הדתית וזהות",
    "Shas": "ש״ס", "The Democrats": "הדמוקרטים", "The Joint List": "הרשימה המשותפת", "The Reservists": "המילואימניקים",
    "Together": "ביחד", "United Torah Judaism": "יהדות התורה", "Yamina": "ימינה", "Yashar!": "ישר!", "Yesh Atid": "יש עתיד",
    "Yisrael Beytenu": "ישראל ביתנו"};
  var name = function (s) { return HE && HE_NAMES[s] ? HE_NAMES[s] : s; };
  var cache = {};
  var state = { year: "2026", set: "jewish", measure: "wage", pair: "2022_2026", ci: false };

  function parseCSV(text) {
    var rows = [], row = [], f = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    var meta = [];
    while (rows.length && rows[0][0].charAt(0) === "#") meta.push(rows.shift().join(",").replace(/^#\s*/, ""));
    var head = rows.shift();
    var out = rows.filter(function (r) { return r.length === head.length; }).map(function (r) {
      var o = {}; head.forEach(function (h, j) { o[h] = r[j]; }); return o;
    });
    out.head = head; out.meta = meta;
    return out;
  }
  function load(file) {
    if (!cache[file]) cache[file] = fetch(DATA + file).then(function (r) {
      if (!r.ok) throw new Error(file + ": " + r.status); return r.text();
    }).then(parseCSV);
    return cache[file];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function p(v) { return n(v, 1) + "%"; }
  function range(r) {
    var a = +r.measure_min, b = +r.measure_max, to = tr(" to ", " עד ");
    return state.measure === "wage" ? n(a / 1000) + "k" + to + n(b / 1000) + "k" : n(a, 1) + to + n(b, 1);
  }
  // the transfers file's first line, in Hebrew on the Hebrew page (same numbers)
  function metaText(m) {
    if (!HE) return m;
    var x = m.match(/(\d+) comparable boxes of (\d+).*?(\d+) eligible voters in (\d{4}) = ([\d.]+)% of all; (\d+) localities; (\d+)/);
    return x ? x[1] + " קלפיות ברות השוואה מתוך " + x[2] + "; " + n(x[3]) + " בעלי זכות בחירה ב-" + x[4] + " (" + x[5] +
      "% מכלל בעלי זכות הבחירה); " + x[6] + " יישובים; " + x[7] + " הרצות bootstrap" : "";
  }

  function deciles() {
    load("deciles_" + state.year + ".csv").then(function (d) {
      var rows = d.filter(function (r) { return r.set === state.set && r.measure === state.measure; });
      var s = SIDES[state.year];
      var h = '<thead><tr><th>' + tr("Decile", "עשירון") + '</th><th class="n">' +
        esc(MEASURE[state.measure]) + '</th><th class="n">' + tr("Areas", "אזורים") + '</th><th class="n">' + tr("Eligible voters", "בעלי זכות בחירה") +
        '</th><th class="n">' + tr("Turnout", "אחוז הצבעה") + '</th>' +
        '<th class="n">' + s[0] + '</th><th class="n">' + s[1] + '</th><th class="n">' + tr("Arab parties", "מפלגות ערביות") +
        '</th><th class="n">' + tr("Other", "אחר") + '</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var other = +r.side_uncommitted_pct + +r.side_other_pct;
        h += '<tr><th scope="row">' + r.decile + (r.decile === "1" ? ' <span class="of">' + tr("(lowest)", "(הנמוך)") + "</span>" : r.decile === "10" ? ' <span class="of">' + tr("(highest)", "(הגבוה)") + "</span>" : "") +
          '</th><td class="n">' + range(r) + '</td><td class="n">' + n(r.units) + '</td><td class="n">' + n(r.eligible) +
          '</td><td class="n">' + p(r.turnout_pct) + '</td><td class="n">' + p(r.side_right_pct) + '</td><td class="n">' +
          p(r.side_left_pct) + '</td><td class="n">' + p(r.side_arab_pct) + '</td><td class="n">' + p(other) + "</td></tr>";
      });
      document.getElementById("d-sides").innerHTML = h + "</tbody>";
      var cols = d.head.filter(function (c) {
        return c.indexOf("party_") === 0 && rows.some(function (r) { return +r[c] >= 1; });
      });
      var t = '<thead><tr><th>' + tr("Decile", "עשירון") + "</th>" +
        cols.map(function (c) { return '<th class="n to">' + esc(name(c.slice(6, -4))) + "</th>"; }).join("") + "</tr></thead><tbody>";
      rows.forEach(function (r) {
        t += '<tr><th scope="row">' + r.decile + "</th>" + cols.map(function (c) { return '<td class="n">' + n(r[c], 1) + "</td>"; }).join("") + "</tr>";
      });
      document.getElementById("d-lists").innerHTML = t + "</tbody>";
    }).catch(fail("d-sides"));
  }

  function transfers() {
    load("transfers_" + state.pair + ".csv").then(function (d) {
      var from = [], to = [], cell = {}, tot = {};
      d.forEach(function (r) {
        if (from.indexOf(r.from) < 0) from.push(r.from);
        if (to.indexOf(r.to) < 0) to.push(r.to);
        cell[r.from + "|" + r.to] = r; tot[r.from] = +r.from_total_in_sample;
      });
      var yrs = state.pair.split("_");
      document.getElementById("t-meta").textContent = d.meta.map(metaText).join(" ");
      var h = '<thead><tr><th>' + yrs[0] + (HE ? " ← " : " → ") + yrs[1] + '</th><th class="n to">' + tr("Votes in sample", "קולות במדגם") + "</th>" +
        to.map(function (t) { return '<th class="n to">' + esc(name(t)) + "</th>"; }).join("") + "</tr></thead><tbody>";
      from.forEach(function (f) {
        h += '<tr><th scope="row">' + esc(name(f)) + '</th><td class="n">' + n(tot[f]) + "</td>";
        to.forEach(function (t) {
          var r = cell[f + "|" + t], v = 100 * r.share, lo = 100 * r.lo95, hi = 100 * r.hi95;
          var bg = "background:color-mix(in srgb, var(--accent) " + Math.round(Math.min(v, 100) * 0.45) + "%, transparent)";
          var tip = HE ? name(f) + " (" + yrs[0] + ") אל " + name(t) + " (" + yrs[1] + "): " + v.toFixed(1) + "%, טווח 95%: " + lo.toFixed(0) + " עד " + hi.toFixed(0)
            : f + " (" + yrs[0] + ") to " + t + " (" + yrs[1] + "): " + v.toFixed(1) + "%, 95% interval " + lo.toFixed(0) + " to " + hi.toFixed(0);
          if (v < 0.5 && hi < 1) { h += '<td class="c z" title="' + esc(tip) + '">·</td>'; return; }
          h += '<td class="c" style="' + bg + '" title="' + esc(tip) + '">' + v.toFixed(0) +
            (state.ci ? '<span class="ci">' + lo.toFixed(0) + "–" + hi.toFixed(0) + "</span>" : "") + "</td>";
        });
        h += "</tr>";
      });
      document.getElementById("t-matrix").innerHTML = h + "</tbody>";
    }).catch(fail("t-matrix"));
  }

  function fail(id) {
    return function (e) { document.getElementById(id).innerHTML = "<tr><td>" + tr("Could not load the data", "לא ניתן לטעון את הנתונים") + " (" + esc(e.message) + ").</td></tr>"; };
  }
  function group(id, key, redraw) {
    var g = document.getElementById(id);
    g.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state[key] = b.getAttribute("data-v");
      g.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      redraw();
    });
  }
  group("d-year", "year", deciles);
  group("d-set", "set", deciles);
  group("d-measure", "measure", deciles);
  group("t-pair", "pair", transfers);
  document.getElementById("t-ci").addEventListener("change", function (e) { state.ci = e.target.checked; transfers(); });
  deciles();
  transfers();
})();
