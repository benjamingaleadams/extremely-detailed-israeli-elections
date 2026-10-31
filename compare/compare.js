// Compare page: any towns, neighbourhoods, statistical areas and groups side by side for one election.
// Data from scripts/build_compare.py (data/units.json, data/census.json, data/votes_<year>.json).
// Every column is a sum of votes over its members; percentages are computed from the sums.
// The address is the state: compare/?ids=town:6100,nb:3000:<slug>,area:30000112,group:<id>&year=2026, and the same
// under compare/he/ in Hebrew (Decided 31 Oct: Hebrew pages live in <page>/he/; old ?lang=he links redirect there).
// Shared links depend on these names: never rename or reuse one.
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

// ---------- language: the address decides (compare/ English, compare/he/ Hebrew; scripts/build_compare.py) ----------
const HE = document.documentElement.lang === "he";
(() => {  // old links: compare/?lang=he goes to compare/he/, compare/he/?lang=en back to compare/
  const q = new URLSearchParams(location.search), l = q.get("lang");
  if (!l || (l === "he") === HE) return;
  q.delete("lang");
  const s = q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  location.replace((l === "he" ? "he/" : "../") + (s ? "?" + s : "") + location.hash);
})();
const ROOT = HE ? "../../" : "../";   // from this page to the site root
const DATA = HE ? "../data/" : "data/";
const tr = (en, he) => HE ? he : en;
const LOC = HE ? "he-IL" : "en-GB";
const fmtN = v => v == null || isNaN(v) ? "–" : Math.round(v).toLocaleString(LOC);
const fmtP = v => v == null || isNaN(v) ? "–" : v.toFixed(1) + "%";
const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  he: ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"] };
const yearLabel = y => { const [yr, mo] = String(y).split("-"); return mo ? `${MONTHS[HE ? "he" : "en"][+mo - 1]} ${yr}` : yr; };
// chart axes: "Apr '19" (Hebrew "אפר׳ 19"), whole years in full (design audit B5)
const yearShort = y => { const [yr, mo] = String(y).split("-"); return mo ? `${MONTHS[HE ? "he" : "en"][+mo - 1]} ${HE ? "" : "'"}${yr.slice(2)}` : yr; };

const SIDES = ["right", "left", "arab", "uncommitted"];
let SIDE_COLOUR = { right: "#2c5aa0", left: "#c2306f", arab: "#16834f", uncommitted: "#8a6fb0" };  // replaced by units.json side_colours (palette.json)
// across elections (the trend) the camps are "Netanyahu's camp" and "Opposing camp" (CLAUDE.md, Decided 31 Oct);
// within one election each bloc keeps that election's own name (units.json blocs)
const SIDE_NAME = { right: ["Netanyahu's camp", "מחנה נתניהו"], left: ["Opposing camp", "המחנה שמולו"], arab: ["Arab parties", "מפלגות ערביות"],
  uncommitted: ["Uncommitted", "לא התחייבו לגוש"] };
const WAY = { secular: ["Secular", "חילוני"], traditional: ["Traditional", "מסורתי"], religious: ["Religious", "דתי"],
  haredi: ["Haredi", "חרדי"], other: ["Other", "אחר"] };
const RELIGION = { jewish: ["Jewish", "יהודים"], muslim: ["Muslim", "מוסלמים"], druze: ["Druze", "דרוזים"],
  christian: ["Christian", "נוצרים"], other: ["Other", "דת אחרת"] };

let U, C, YEARS, year, ids = [];
const V = {};          // votes by election, loaded on demand
const GM = {};         // group members by election, loaded only when a group is shown
const TOWN = new Map(), NB = new Map(), AREA = new Map(), GROUP = new Map(), AREAS_OF = new Map();

// ---------- the address ----------
function readURL() {
  const q = new URLSearchParams(location.search);
  ids = (q.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean);
  year = q.get("year");
}
function params() {
  const q = new URLSearchParams();
  if (ids.length) q.set("ids", ids.join(","));
  q.set("year", year);
  return q;
}
function syncURL() {
  history.replaceState(null, "", "?" + params().toString().replace(/%2C/g, ",").replace(/%3A/g, ":"));
  $("clear").hidden = !ids.length;
}

function applyLanguage() {  // the page itself is already in its language; the switch keeps the selection
  const sw = $("lang-switch");
  const target = () => (HE ? "../" : "he/") + "?" + params().toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  sw.addEventListener("click", () => { if (year) sw.href = target(); });
}

// ---------- units ----------
function townName(c) { const t = TOWN.get(c); return t ? (HE ? t[2] : t[1]) : String(c); }
function townLink(c) {
  const t = TOWN.get(c);
  if (t && t[3]) return `${ROOT}town/${t[3]}/${HE ? "he/" : ""}`;
  return `${ROOT}index.html?year=${year}&place=${c}${HE ? "&lang=he" : ""}`;
}
const areaLink = a => `${ROOT}index.html?year=${year}&place=${Math.floor(a / 10000)}-${a % 10000}${HE ? "&lang=he" : ""}`;
function areaName(a) {
  const nb = AREA.get(a), c = Math.floor(a / 10000);
  const g = nb ? NB.get(`${c}:${nb}`) : null;
  return { place: townName(c), nb: g ? (HE ? g[3] : g[2]) : "", stat: a % 10000 };
}

// expand any id into sets of towns and areas (areas inside a member town are dropped)
function expand(id, towns = new Set(), areas = new Set(), seen = new Set()) {
  if (seen.has(id)) return { towns, areas };
  seen.add(id);
  const [kind, a, b] = id.split(":");
  if (kind === "town" && TOWN.has(+a)) towns.add(+a);
  else if (kind === "area" && AREA.has(+a)) areas.add(+a);
  else if (kind === "nb") { const g = NB.get(`${a}:${b}`); if (g) g[4].forEach(x => areas.add(x)); }
  else if (kind === "group") {  // members of the shown election (groups.py may change them by election)
    const m = GM[year] && GM[year][a];
    if (m) { m[0].forEach(x => towns.add(x)); m[1].forEach(x => areas.add(x)); }
  }
  for (const x of [...areas]) if (towns.has(Math.floor(x / 10000))) areas.delete(x);
  return { towns, areas };
}

function describe(id) {
  const [kind, a, b] = id.split(":");
  if (kind === "town" && TOWN.has(+a)) {
    const t = TOWN.get(+a), n = (AREAS_OF.get(+a) || []).length;
    return { id, kind, name: HE ? t[2] : t[1], other: HE ? t[1] : t[2], href: townLink(+a),
      sub: tr(`Town · CBS code ${a}`, `יישוב · סמל ${a}`),
      inc: `<p>${tr(`Every polling station of locality code ${a}`, `כל הקלפיות של יישוב ${a}`)}${n > 1 ? tr(`, in ${n} statistical areas`, `, ב-${n} אזורים סטטיסטיים`) : ""}.</p>`
        + (n > 1 ? list(AREAS_OF.get(+a).map(x => areaItem(x, false))) : "") };
  }
  if (kind === "nb") {
    const g = NB.get(`${a}:${b}`);
    if (!g) return null;
    return { id, kind, name: HE ? g[3] : g[2], other: townName(+a), href: townLink(+a),
      sub: tr(`Neighbourhood, ${townName(+a)}`, `שכונה, ${townName(+a)}`),
      inc: `<p>${tr(`Statistical areas named “${g[2]}”:`, `אזורים סטטיסטיים בשם „${g[3]}”:`)}</p>` + list(g[4].map(x => areaItem(x, true))) };
  }
  if (kind === "area" && AREA.has(+a)) {
    const n = areaName(+a), comb = C.combined[a];
    return { id, kind, name: `${n.place} ${tr("area", "אזור")} ${n.stat}`, other: n.nb, href: areaLink(+a),
      sub: n.nb ? `${n.nb}` : tr("Statistical area", "אזור סטטיסטי"),
      inc: `<p>${tr(`CBS 2022 statistical area ${a}: the polling stations our placement puts in it.`,
        `אזור סטטיסטי ${a} (למ״ס 2022): הקלפיות שהשיבוץ שלנו מציב בו.`)}`
        + (comb ? " " + tr(`Census figures cover areas ${[+a, ...comb].map(x => x % 10000).join(", ")} together.`,
          `נתוני המפקד משותפים לאזורים ${[+a, ...comb].map(x => x % 10000).join(", ")}.`) : "") + `</p>` };
  }
  if (kind === "group" && GROUP.has(id)) {
    const g = GROUP.get(id), m = GM[year] && GM[year][a];
    const head = { id, kind, slug: a, name: HE ? g.he : g.en, other: HE ? g.en : g.he, href: `${ROOT}sector/${a}/${HE ? "he/" : ""}`,
      sub: tr("Sector", "מגזר") };
    if (!m) return { ...head, inc: `<p>${tr("Loading...", "טוען...")}</p>` };
    const byName = (x, y) => townName(x).localeCompare(townName(y), LOC);
    const items = [...m[0].slice().sort(byName).map(c => `<li><a href="${townLink(c)}">${esc(townName(c))}</a>${addBtn("town:" + c)}</li>`),
      ...m[1].map(x => areaItem(x, true)),
      ...m[2].slice().sort(byName).map(c => `<li>${esc(townName(c))}: ${tr("votes not placed in an area", "קולות שלא שובצו באזור")}</li>`)];
    const counts = [m[0].length ? tr(`${m[0].length} whole places`, `${m[0].length} יישובים שלמים`) : "",
      m[1].length ? tr(`${m[1].length} statistical areas`, `${m[1].length} אזורים סטטיסטיים`) : "",
      m[2].length ? tr(`the unplaced votes of ${m[2].length} towns`, `הקולות שלא שובצו של ${m[2].length} יישובים`) : ""].filter(Boolean).join(", ");
    return { ...head,
      inc: `<p>${tr("Rule", "כלל")}: <code dir="ltr">${esc(g.rule)}</code></p>${g.note ? `<p>${esc(g.note)}</p>` : ""}`
        + `<p>${tr(`Members in ${yearLabel(year)}`, `חברים ב-${yearLabel(year)}`)}: ${counts || "–"}.</p>` + list(items) };
  }
  return null;
}
const list = items => `<ul>${items.join("")}</ul>`;
const addBtn = id => ids.includes(id) ? "" : `<button type="button" class="linkbtn add" data-add="${esc(id)}" title="${tr("Add as a column", "הוספה כעמודה")}">+</button>`;
function areaItem(x, withTown) {
  const n = areaName(x);
  const label = `${withTown ? n.place + " " : ""}${tr("area", "אזור")} ${n.stat}${n.nb ? " (" + n.nb + ")" : ""}`;
  return `<li><a href="${areaLink(x)}">${esc(label)}</a>${addBtn("area:" + x)}</li>`;
}

// ---------- sums ----------
function sumVotes(y, towns, areas) {
  const d = V[y];
  if (!d) return null;
  const out = new Array(d.cols.length).fill(0);
  let found = 0;
  const add = r => { if (!r) return; found++; for (let i = 0; i < r.length; i++) out[i] += r[i]; };
  towns.forEach(c => add(d.towns[c]));
  areas.forEach(a => add(d.areas[a]));
  return found ? { v: out, found } : null;
}
function colSum(c, y) {
  if (c.kind === "nat") return national(y);
  if (c.kind === "group") { const r = V[y] && V[y].groups && V[y].groups[c.slug]; return r && r[2] ? { v: r, found: 1 } : null; }
  return sumVotes(y, c.towns, c.areas);
}
function national(y) {
  const d = V[y];
  if (!d) return null;
  const out = d.envelopes.slice();
  for (const r of Object.values(d.towns)) for (let i = 0; i < r.length; i++) out[i] += r[i];
  return { v: out, found: Object.keys(d.towns).length };
}
function shares(y, s) {
  const d = V[y], v = s.v, valid = v[2];
  const party = {}, side = { right: 0, left: 0, arab: 0, uncommitted: 0 };
  const plist = U.parties[y];
  plist.forEach((p, i) => { const n = v[4 + i]; party[p[0]] = n; side[p[3]] = (side[p[3]] || 0) + n; });
  return { valid, eligible: v[0], voters: v[1], stations: v[3], party, other: v[v.length - 1], side,
    pct: n => valid ? n / valid * 100 : null };
}

function sumCensus(rowsIdx) {
  const F = C.fields, K = C.kinds, rows = [...rowsIdx].map(i => C.rows[i]).filter(Boolean);
  if (!rows.length) return null;
  const out = {}, pi = F.indexOf("pop_approx");
  const pop = rows.reduce((s, r) => s + (r[pi] || 0), 0);
  F.forEach((f, j) => {
    const k = K[j];
    if (k === "n" && f !== "ses_pop") out[f] = rows.some(r => r[j] != null) ? rows.reduce((s, r) => s + (r[j] || 0), 0) : null;
    else if (k === "p") {
      let w = 0, t = 0;
      for (const r of rows) if (r[j] != null && r[pi]) { w += r[pi]; t += r[j] * r[pi]; }
      out[f] = w ? t / w : null;
    } else if (k === "m") out[f] = rows.length === 1 ? rows[0][j] : null;
    else if (k === "w") {
      const wj = F.indexOf("ses_pop");
      let w = 0, t = 0;
      for (const r of rows) if (r[j] != null && r[wj]) { w += r[wj]; t += r[j] * r[wj]; }
      out[f] = w ? t / w : null;
    } else if (k === "t") {
      if (rows.length === 1) out[f] = rows[0][j] ? { key: rows[0][j], share: null } : null;
      else {
        const by = {};
        for (const r of rows) if (r[j] && r[pi]) by[r[j]] = (by[r[j]] || 0) + r[pi];
        const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
        out[f] = top && pop ? { key: top[0], share: top[1] / pop * 100 } : null;
      }
    }
  });
  out.rows = rows.length;
  return out;
}
function censusRows(towns, areas) {
  const s = new Set();
  let missing = 0;
  towns.forEach(c => { const i = C.town[c]; if (i != null) s.add(i); else missing++; });
  areas.forEach(a => { const i = C.area[a]; if (i != null) s.add(i); else missing++; });
  return { rows: s, missing };
}

// ---------- drawing ----------
function trendSVG(series) {
  const W = 220, H = 110, l = 20, r = 4, t = 4, b = 14, n = YEARS.length;
  const X = i => l + i * (W - l - r) / (n - 1), Y = v => t + (100 - v) / 100 * (H - t - b);
  let s = "";
  for (const g of [0, 50, 100]) s += `<line class="grid" x1="${l}" x2="${W - r}" y1="${Y(g)}" y2="${Y(g)}"/><text class="ax" x="${l - 3}" y="${Y(g) + 3}" text-anchor="end">${g}</text>`;
  const yi = YEARS.indexOf(year);
  s += `<line class="now" x1="${X(yi)}" x2="${X(yi)}" y1="${t}" y2="${H - b}"/>`;
  s += `<text class="ax" x="${X(0)}" y="${H - 3}" text-anchor="start">${yearShort(YEARS[0])}</text><text class="ax" x="${X(n - 1)}" y="${H - 3}" text-anchor="end">${yearShort(YEARS[n - 1])}</text>`;
  for (const side of ["right", "left", "arab"]) {
    const segs = []; let cur = [];
    series.forEach((v, i) => { if (v && v[side] != null) cur.push(`${X(i).toFixed(1)},${Y(v[side]).toFixed(1)}`); else { if (cur.length) segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    for (const sg of segs) s += sg.length > 1 ? `<polyline points="${sg.join(" ")}" stroke="${SIDE_COLOUR[side]}"/>`
      : `<circle cx="${sg[0].split(",")[0]}" cy="${sg[0].split(",")[1]}" r="2" fill="${SIDE_COLOUR[side]}"/>`;
  }
  const title = series.map((v, i) => v ? `${yearLabel(YEARS[i])}: ${["right", "left", "arab"].map(x => `${tr(...SIDE_NAME[x])} ${fmtP(v[x])}`).join(", ")}` : null).filter(Boolean).join("\n");
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" direction="ltr" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${s}</svg>`;
}

function render() {
  const table = $("cmp"), status = $("status");
  const d = V[year];
  if (!d) return;
  if (ids.some(i => i.startsWith("group:")) && !GM[year] && U.groups.length) {
    const y = year;
    GM[y] = null;
    getJSON(`${DATA}groups_${y}.json`).then(m => { GM[y] = m; if (y === year) render(); }).catch(e => console.error(e));
  }
  const cols = ids.map(id => {
    const desc = describe(id);
    if (!desc) return null;
    const { towns, areas } = expand(id);
    return { ...desc, towns, areas };
  }).filter(Boolean);
  if (!cols.length) {
    status.hidden = false;
    status.className = "muted empty-msg";
    status.innerHTML = tr(`Nothing chosen yet. Search above, or start from an example: <a href="?ids=town:5000,town:3000,town:6100,town:4000&year=${year}">Tel Aviv-Yafo, Jerusalem, Bnei Brak and Haifa</a>.`,
      `עדיין לא נבחר דבר. אפשר לחפש למעלה, או להתחיל מדוגמה: <a href="?ids=town:5000,town:3000,town:6100,town:4000&year=${year}">תל אביב-יפו, ירושלים, בני ברק וחיפה</a>.`);
    $("wrap").hidden = true;
    return;
  }
  status.hidden = true; status.textContent = "";
  $("wrap").hidden = false;
  const nat = { id: null, kind: "nat", name: tr("Israel", "ישראל"), sub: tr("All valid votes, double envelopes included", "כל הקולות הכשרים, כולל מעטפות כפולות") };
  const all = [...cols, nat];
  // per column: this election's sums, census and trend
  for (const c of all) {
    c.s = colSum(c, year);
    c.sh = c.s ? shares(year, c.s) : null;
    c.cen = c.kind === "nat" ? sumCensus(new Set([C.nat])) : (() => { const r = censusRows(c.towns, c.areas); const s = sumCensus(r.rows); if (s) s.missing = r.missing; return s; })();
    c.trend = YEARS.map(y => {
      const s = colSum(c, y);
      if (!s) return null;
      const sh = shares(y, s);
      return { right: sh.pct(sh.side.right), left: sh.pct(sh.side.left), arab: sh.pct(sh.side.arab) };
    });
  }
  const plist = U.parties[year], blocs = U.blocs[year] || {};
  const cell = (c, html, cls = "") => `<td class="${cls}${c.kind === "nat" ? " nat" : ""}">${html}</td>`;
  const row = (label, f, title = "") => `<tr><th class="m" scope="row"${title ? ` title="${esc(title)}"` : ""}>${label}</th>${all.map(c => f(c)).join("")}</tr>`;
  const sec = t => `<tr class="sec"><th class="m" scope="rowgroup">${t}</th><th colspan="${all.length}"></th></tr>`;
  const na = c => cell(c, "–", "na");

  let h = `<thead><tr><th class="m"></th>${all.map((c, i) => `<th scope="col" class="${c.kind === "nat" ? "nat" : ""}">`
    + (c.id ? `<button type="button" class="x" data-rm="${i}" aria-label="${tr("Remove", "הסרה")} ${esc(c.name)}" title="${tr("Remove", "הסרה")}">×</button>` : "")
    + `<span class="name">${c.href ? `<a href="${c.href}">${esc(c.name)}</a>` : esc(c.name)}</span><span class="sub">${esc(c.sub)}</span></th>`).join("")}</tr></thead><tbody>`;
  h += row(tr("Includes", "כולל"), c => c.kind === "nat" ? cell(c, "", "na")
    : `<td><details class="inc"><summary>${tr("Show", "הצגה")}</summary>${c.inc}</details></td>`);

  h += sec(`${tr("Votes", "הצבעה")}, ${yearLabel(year)}`);
  h += row(tr("Valid votes", "קולות כשרים"), c => c.sh ? cell(c, fmtN(c.sh.valid))
    : cell(c, tr(`No polling station placed here in ${yearLabel(year)}`, `לא שובצה כאן קלפי ב-${yearLabel(year)}`), "na"));
  h += row(tr("Turnout", "שיעור הצבעה"), c => c.sh && c.sh.eligible ? cell(c, fmtP(c.sh.voters / c.sh.eligible * 100), "") : na(c),
    tr("Voters as a share of eligible voters at these polling stations", "מצביעים מתוך בעלי זכות הבחירה בקלפיות אלה"));
  h += row(tr("Polling stations", "קלפיות"), c => c.sh ? cell(c, fmtN(c.sh.stations)) : na(c));

  h += sec(tr("Blocs", "גושים"));
  h += row("", c => c.sh ? cell(c, `<div class="bar" aria-hidden="true">${SIDES.map(s => c.sh.side[s] ? `<span style="width:${c.sh.pct(c.sh.side[s])}%;background:${SIDE_COLOUR[s]}"></span>` : "").join("")}</div>`) : na(c));
  for (const s of SIDES) {
    if (!blocs[s]) continue;
    const top = c => c.sh && SIDES.every(o => c.sh.side[s] >= (c.sh.side[o] || 0));
    h += row(`<span class="sw" style="background:${SIDE_COLOUR[s]}"></span>${esc(HE ? blocs[s][1] : blocs[s][0])}`,
      c => c.sh ? cell(c, fmtP(c.sh.pct(c.sh.side[s])), top(c) ? "lead" : "") : na(c));
  }

  h += sec(tr("Lists", "רשימות"));
  const order = [...plist].sort((a, b) => SIDES.indexOf(a[3]) - SIDES.indexOf(b[3]) || (a[5] || 0) - (b[5] || 0));
  const below = `<span class="below">${tr("below threshold", "מתחת לאחוז החסימה")}</span>`;  // as on the map (B9)
  for (const p of order) {
    const lead = c => c.sh && plist.every(q => c.sh.party[p[0]] >= c.sh.party[q[0]]);
    h += row(`<span class="sw" style="background:${p[4]}"></span>${esc(HE ? p[2] : p[1])}${p[5] ? " " + below : ""}`,
      c => c.sh ? `<td class="${lead(c) ? "lead" : ""}${c.kind === "nat" ? " nat" : ""}" title="${fmtN(c.sh.party[p[0]])} ${tr("votes", "קולות")}">${fmtP(c.sh.pct(c.sh.party[p[0]]))}</td>` : na(c));
  }
  h += row(tr("Other lists", "רשימות אחרות"), c => c.sh ? cell(c, fmtP(c.sh.pct(c.sh.other))) : na(c),
    tr("Smaller lists that won no seats", "רשימות קטנות שלא נכנסו לכנסת"));

  h += sec(tr(`Trend, ${YEARS[0]} to ${YEARS[YEARS.length - 1]}`, `מגמה, ${YEARS[0]} עד ${YEARS[YEARS.length - 1]}`));
  const ready = YEARS.every(y => V[y]);
  h += row(`<span class="key">${["right", "left", "arab"].map(s => `<span style="color:${SIDE_COLOUR[s]}">${tr(...SIDE_NAME[s])}</span>`).join("<br>")}</span>`,
    c => cell(c, ready ? trendSVG(c.trend) : `<span class="muted">${tr("Loading...", "טוען...")}</span>`));

  h += sec(tr("2022 census", "מפקד 2022"));
  const cen = (label, f, title) => row(label, c => c.cen ? cell(c, f(c.cen), "") : na(c), title);
  const multi = tr("Shown only for a single census row", "מוצג רק לשורת מפקד אחת");
  h += cen(tr("Population", "אוכלוסייה"), x => fmtN(x.pop_approx));
  h += cen(tr("Median age", "גיל חציוני"), x => x.age_median != null ? x.age_median.toFixed(0) : "–", multi);
  h += cen(tr("Aged 65 and over", "בני 65 ומעלה"), x => fmtP(x.age65_pcnt));
  h += cen(tr("Academic degree", "השכלה אקדמית"), x => fmtP(x.AcadmCert_pcnt), tr("Of people aged 15 and over; population-weighted where several rows are summed", "מבני 15 ומעלה"));
  h += cen(tr("Immigrated since 2002", "עלו מ-2002"), x => fmtP(x.aliya2002_pcnt));
  h += cen(tr("Median yearly wage (NIS)", "שכר שנתי חציוני (ש״ח)"), x => fmtN(x.employeesAnnual_medWage), multi);
  h += cen(tr("Socio-economic index (2021)", "מדד חברתי-כלכלי (2021)"), x => x.ses != null ? `<bdi dir="ltr">${x.ses.toFixed(2)}</bdi>` : "–",
    tr("CBS 2021 index by statistical area, weighted by population; 0 is the national average", "מדד הלמ״ס 2021 לפי אזור סטטיסטי, משוקלל באוכלוסייה"));
  const lab = (x, M, ofPeople) => x ? `${tr(...M[x.key])}${x.share != null ? ` <bdi class="muted">(${x.share.toFixed(0)}%${ofPeople})</bdi>` : ""}` : "–";
  h += cen(tr("Main religion", "דת עיקרית"), x => lab(x.religion, RELIGION, tr(" of people", " מהתושבים")),
    tr("Where several census rows are summed: the most common label and the share of people in rows with it", "כשמסוכמות כמה שורות: התווית הנפוצה ושיעור התושבים בשורות שלה"));
  h += cen(tr("Household way of life", "אורח חיים במשקי הבית"), x => lab(x.way, WAY, tr(" of people", " מהתושבים")),
    tr("Most common household way of life; where several census rows are summed, the share of people in rows with it", "אורח החיים הנפוץ במשקי הבית"));
  h += "</tbody>";
  table.innerHTML = h;
}

// ---------- search ----------
const HE_FINAL = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const normHe = s => s.replace(/[֑-ׇ]/g, "").replace(/[^א-ת0-9]/g, "").replace(/[ךםןףץ]/g, c => HE_FINAL[c]);
const normEn = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function skeleton(s) {
  s = normEn(s).replace(/kh|ch/g, "h").replace(/ph/g, "f").replace(/tz|ts/g, "z").replace(/ck|q|c/g, "k").replace(/w|v/g, "b");
  return (s[0] || "") + s.slice(1).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
}
let index = [], results = [], active = -1;
function buildIndex() {
  const size = new Map();
  const d = V[year] || {};
  for (const [c, r] of Object.entries(d.towns || {})) size.set(+c, r[2]);
  const entry = (id, en, he, kind, inEn, inHe, sz) => ({ id, en, he, kind, inEn, inHe, size: sz,
    n: [normEn(en)], w: en.toLowerCase().split(/[\s\-()\/,]+/).map(normEn).filter(Boolean), sk: skeleton(en), h: normHe(he),
    hw: he.split(/[\s\-\/,]+/).map(normHe).filter(Boolean) });
  index = [];
  for (const t of U.towns) index.push(entry(`town:${t[0]}`, t[1], t[2], "town", "", "", size.get(t[0]) || 0));
  for (const g of U.nbs) index.push(entry(`nb:${g[0]}:${g[1]}`, g[2], g[3], "nb", townName(g[0]), townName(g[0]), -1));
  for (const g of U.groups) index.push(entry(g.id, g.en, g.he, "group", "", "", 1e9));
}
const KIND = { town: ["town", "יישוב"], nb: ["neighbourhood", "שכונה"], area: ["statistical area", "אזור סטטיסטי"],
  group: ["sector", "מגזר"] };
function search(q) {
  q = q.trim();
  if (!q) return [];
  const out = [];
  // an area by its full code (30000112), or a town and an area number ("Jerusalem 112")
  const code = q.match(/^(\d{5,8})$/), tail = q.match(/^(.*\D)\s*(\d{1,4})$/);
  if (code && AREA.has(+code[1])) out.push([0, areaEntry(+code[1])]);
  const he = /[א-ת]/.test(q), base = tail ? tail[1].trim() : q;
  const scored = [];
  const hq = normHe(base), nq = normEn(base), kq = skeleton(base);
  for (const e of index) {
    let s = 9;
    if (he) {
      if (!hq) break;
      s = e.h === hq ? 0 : e.h.startsWith(hq) ? 1 : e.hw.some(w => w.startsWith(hq)) ? 2 : e.h.includes(hq) ? 3 : 9;
    } else {
      if (!nq) break;
      if (e.n[0] === nq) s = 0;
      else if (e.n[0].startsWith(nq)) s = 1;
      else if (e.w.some(w => w.startsWith(nq))) s = 2;
      else if (nq.length > 2 && e.n[0].includes(nq)) s = 3;
      else if (kq.length > 2 && e.sk.startsWith(kq)) s = 4;
    }
    if (s < 9) scored.push([s, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || b[1].size - a[1].size);
  if (tail) {  // "Jerusalem 112": the area of the best-matching town
    const t = scored.find(([, e]) => e.kind === "town");
    if (t) { const a = +t[1].id.split(":")[1] * 10000 + +tail[2]; if (AREA.has(a)) out.push([0, areaEntry(a)]); }
  }
  return [...out, ...scored].slice(0, 10).map(x => x[1]);
}
function areaEntry(a) {
  const n = areaName(a);
  return { id: `area:${a}`, en: `${n.place} ${tr("area", "אזור")} ${n.stat}`, he: "", kind: "area", inEn: n.nb, inHe: n.nb };
}
function renderList() {
  const input = $("add"), ul = $("add-list");
  if (!input.value.trim()) { ul.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
  ul.innerHTML = results.length ? results.map((e, k) => {
    const name = e.kind === "area" ? e.en : (HE ? e.he : e.en);
    const where = HE ? e.inHe : e.inEn;
    return `<li role="option" id="opt-${k}" data-k="${k}" aria-selected="${k === active}"><span>${esc(name)}${where ? `<span class="in">, ${esc(where)}</span>` : ""}</span><span class="kind">${tr(...KIND[e.kind])}</span></li>`;
  }).join("") : `<li class="none" role="option" aria-disabled="true">${tr("Nothing found", "לא נמצא")}</li>`;
  ul.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (active >= 0) { input.setAttribute("aria-activedescendant", `opt-${active}`); $(`opt-${active}`).scrollIntoView({ block: "nearest" }); }
  else input.removeAttribute("aria-activedescendant");
}
function addId(id) {
  if (!ids.includes(id)) ids.push(id);
  syncURL();
  render();
}
function wireSearch() {
  const input = $("add"), ul = $("add-list");
  input.addEventListener("input", () => { results = search(input.value); active = results.length ? 0 : -1; renderList(); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) pick(results[Math.max(active, 0)]);
    } else if (e.key === "Escape") { ul.hidden = true; input.setAttribute("aria-expanded", "false"); }
  });
  input.addEventListener("blur", () => setTimeout(() => { ul.hidden = true; input.setAttribute("aria-expanded", "false"); }, 150));
  ul.addEventListener("mousedown", e => { const li = e.target.closest("li[data-k]"); if (li) { e.preventDefault(); pick(results[+li.dataset.k]); } });
  const pick = e => { addId(e.id); input.value = ""; results = []; renderList(); input.focus(); };
}

// ---------- years ----------
function setYear(y) {
  year = y;
  for (const b of $("years").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.y === y));
  syncURL();
  load(y).then(render);
}
function load(y) {
  if (V[y]) return Promise.resolve(V[y]);
  return getJSON(`${DATA}votes_${y}.json`).then(d => (V[y] = d));
}

// ---------- start ----------
applyLanguage();
readURL();
Promise.all([getJSON(DATA + "units.json"), getJSON(DATA + "census.json")]).then(([u, c]) => {
  U = u; C = c; YEARS = u.years;
  if (u.side_colours) SIDE_COLOUR = u.side_colours;
  if (!YEARS.includes(year)) year = YEARS[YEARS.length - 1];
  for (const t of U.towns) TOWN.set(t[0], t);
  for (const g of U.nbs) NB.set(`${g[0]}:${g[1]}`, g);
  for (const [a, nb] of U.areas) { AREA.set(a, nb); const c = Math.floor(a / 10000); if (!AREAS_OF.has(c)) AREAS_OF.set(c, []); AREAS_OF.get(c).push(a); }
  const OLD = new Map();
  for (const g of U.groups) { GROUP.set(g.id, g); for (const o of g.old || []) OLD.set("group:" + o, g.id); }
  ids = [...new Set(ids.map(i => OLD.get(i) || i))];
  $("years").innerHTML = YEARS.map(y => `<button type="button" data-y="${y}" aria-pressed="${y === year}">${yearLabel(y)}</button>`).join("");
  $("years").addEventListener("click", e => { const b = e.target.closest("button[data-y]"); if (b) setYear(b.dataset.y); });
  $("cmp").addEventListener("click", e => {
    const rm = e.target.closest("button[data-rm]");
    if (rm) { ids.splice(+rm.dataset.rm, 1); syncURL(); render(); return; }
    const add = e.target.closest("button[data-add]");
    if (add) addId(add.dataset.add);
  });
  $("clear").addEventListener("click", () => { ids = []; syncURL(); render(); });
  $("copy-link").addEventListener("click", () => {
    const done = () => { $("copy-done").textContent = tr("Copied", "הועתק"); setTimeout(() => { $("copy-done").textContent = ""; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, () => {});
  });
  syncURL();
  return load(year).then(() => {
    buildIndex();
    wireSearch();
    render();
    // the trend needs every election: fetch the rest after the first drawing
    return Promise.all(YEARS.filter(y => y !== year).map(load)).then(render);
  });
}).catch(e => { console.error(e); $("status").textContent = tr("Could not load the data.", "לא ניתן לטעון את הנתונים."); });
