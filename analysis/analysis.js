// Analysis page: decile tables and transfer matrices, read from the CSV copies in data/
// (written by scripts/analysis_deciles.py and scripts/analysis_transfers.py).
(function () {
  "use strict";
  var SIDES = { "2022": ["Bibi bloc", "Change bloc"], "2026": ["Bibi bloc", "Change bloc"] };
  var MEASURE = { wage: "Median wage (NIS a year)", degree: "Academic degree (%)", young: "Aged 0 to 19 (%)" };
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
  function load(name) {
    if (!cache[name]) cache[name] = fetch("data/" + name).then(function (r) {
      if (!r.ok) throw new Error(name + ": " + r.status); return r.text();
    }).then(parseCSV);
    return cache[name];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n(v, d) { return Number(v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function range(r) {
    var a = +r.measure_min, b = +r.measure_max;
    return state.measure === "wage" ? n(a / 1000) + "k to " + n(b / 1000) + "k" : n(a, 1) + " to " + n(b, 1);
  }

  function deciles() {
    load("deciles_" + state.year + ".csv").then(function (d) {
      var rows = d.filter(function (r) { return r.set === state.set && r.measure === state.measure; });
      var s = SIDES[state.year];
      var h = '<caption class="meta">Shares of valid votes, %</caption><thead><tr><th>Decile</th><th class="n">' +
        esc(MEASURE[state.measure]) + '</th><th class="n">Areas</th><th class="n">Eligible voters</th><th class="n">Turnout</th>' +
        '<th class="n">' + s[0] + '</th><th class="n">' + s[1] + '</th><th class="n">Arab parties</th><th class="n">Other</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var other = +r.side_uncommitted_pct + +r.side_other_pct;
        h += '<tr><th scope="row">' + r.decile + (r.decile === "1" ? ' <span class="of">(lowest)</span>' : r.decile === "10" ? ' <span class="of">(highest)</span>' : "") +
          '</th><td class="n">' + range(r) + '</td><td class="n">' + n(r.units) + '</td><td class="n">' + n(r.eligible) +
          '</td><td class="n">' + n(r.turnout_pct, 1) + '</td><td class="n">' + n(r.side_right_pct, 1) + '</td><td class="n">' +
          n(r.side_left_pct, 1) + '</td><td class="n">' + n(r.side_arab_pct, 1) + '</td><td class="n">' + n(other, 1) + "</td></tr>";
      });
      document.getElementById("d-sides").innerHTML = h + "</tbody>";
      var cols = d.head.filter(function (c) {
        return c.indexOf("party_") === 0 && rows.some(function (r) { return +r[c] >= 1; });
      });
      var t = '<caption class="meta">Lists with 1% or more in any decile, % of valid votes</caption><thead><tr><th>Decile</th>' +
        cols.map(function (c) { return '<th class="n">' + esc(c.slice(6, -4)) + "</th>"; }).join("") + "</tr></thead><tbody>";
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
      document.getElementById("t-meta").textContent = d.meta.join(" ");
      var h = '<thead><tr><th>' + yrs[0] + " → " + yrs[1] + '</th><th class="n">Votes in sample</th>' +
        to.map(function (t) { return '<th class="n to">' + esc(t) + "</th>"; }).join("") + "</tr></thead><tbody>";
      from.forEach(function (f) {
        h += '<tr><th scope="row">' + esc(f) + '</th><td class="n">' + n(tot[f]) + "</td>";
        to.forEach(function (t) {
          var r = cell[f + "|" + t], v = 100 * r.share, lo = 100 * r.lo95, hi = 100 * r.hi95;
          var bg = "background:color-mix(in srgb, var(--accent) " + Math.round(Math.min(v, 100) * 0.45) + "%, transparent)";
          var tip = f + " (" + yrs[0] + ") to " + t + " (" + yrs[1] + "): " + v.toFixed(1) + "%, 95% interval " + lo.toFixed(0) + " to " + hi.toFixed(0);
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
    return function (e) { document.getElementById(id).innerHTML = '<tr><td>Could not load the data (' + esc(e.message) + ").</td></tr>"; };
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
