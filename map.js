// Map page: vector tiles from data/<year>/areas.pmtiles, hover details from areas.json,
// town search from the same file, neighbourhood names from data/area_names.json. Built into site/ by scripts/build_site.py.
"use strict";

// this election's blocs, right camp first; names differ by election (tables/blocs.csv)
let BLOCS = [], TWO_BLOCS = [], ARAB_BLOCS = [], BLOC_HE = {};
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString("en-US");
const pctFmt = x => (Math.round(x * 10) / 10).toFixed(1) + "%";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => matchMedia("(max-width: 720px)").matches;
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });

let PAGES = {};  // locality code -> town page slug (data/places.json)
let NAMES = {};  // "<locality code x 10000 + area>": [English, Hebrew, [w, s, e, n], other CBS names in Hebrew]
let meta, A = null, DOTS = { type: "FeatureCollection", features: [] }, map, parties, colors, blocColor = {};
let hovered = null, mode = "party";
const PREVIEW = window.PREVIEW_DATA === true;

// ---------- the address is the state: ?year=&view=&party=&place=&lang= plus #zoom/lat/lng ----------
// Shared links depend on these names (CLAUDE.md, "Shareable links"): never rename or reuse one.
const Q = new URLSearchParams(location.search);
const MODES = ["party", "bloc", "share"];
let year = null, shareParty = null, place = null;
const slug = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const partySlug = l => slug(parties[l].english);

function stateParams() {
  const q = new URLSearchParams();
  q.set("year", year);
  if (mode !== "party") q.set("view", mode);
  if (mode === "share" && shareParty) q.set("party", partySlug(shareParty));
  if (place) q.set("place", place);
  if (HE) q.set("lang", "he");
  return q;
}
function syncURL() {
  if (!year) return;
  history.replaceState(history.state, "", "?" + stateParams().toString() + location.hash);
}

// ---------- language: English by default, Hebrew with ?lang=he (remembered per browser) ----------
const HE = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  if (q) { try { localStorage.setItem("lang", q); } catch (e) { /* private window */ } return q === "he"; }
  try { return localStorage.getItem("lang") === "he"; } catch (e) { return false; }
})();
const tr = (en, he) => HE ? he : en;
const blocName = b => HE ? (BLOC_HE[b] || b) : b;
// "2019-04" -> "Apr 2019"; plain years stay as they are
const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  he: ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"] };
const yearLabel = y => {
  const [yr, mo] = String(y).split("-");
  return mo ? `${MONTHS[HE ? "he" : "en"][+mo - 1]} ${yr}` : yr;
};
const TOWN_TOTAL = tr("Town total", "סה״כ ביישוב");

function applyLanguage() {
  const sw = $("lang-switch");
  if (sw) {
    // built when followed, so it carries the current view and map position
    const target = () => { const q = stateParams(); q.set("lang", HE ? "en" : "he"); return "?" + q.toString() + location.hash; };
    sw.href = target();
    sw.addEventListener("click", () => { sw.href = target(); });
    sw.textContent = HE ? "English" : "עברית";
    sw.lang = HE ? "en" : "he";
  }
  if (!HE) return;
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
  for (const el of document.querySelectorAll("[data-he]")) el.innerHTML = el.dataset.he;
  for (const el of document.querySelectorAll("[data-he-label]")) el.setAttribute("aria-label", el.dataset.heLabel);
  $("town").placeholder = "למשל חיפה או Haifa";
  for (const a of document.querySelectorAll(".site-header nav a:not(#lang-switch), .site-footer a"))
    a.href = a.getAttribute("href").replace("about.html", "about-he.html").replace("sources.html", "sources-he.html")
      .replace(/^(town|sectors)\/index\.html$/, "$1/he/index.html");
}
const FS = PREVIEW ? { source: "areas" } : { source: "areas", sourceLayer: "areas" };

// ---------- colour mode: leading party (as on the reference map) or bloc ----------

// two-bloc view: dark over 2/3 of valid votes, light over half; Arab parties sit outside both blocs
function twoBlocStops(f = c => c) {
  const light = meta.blocs_light || {};
  return [...TWO_BLOCS.flatMap(x => [`${x}|strong`, f(blocColor[x]), `${x}|majority`, f(light[x] || blocColor[x])]),
    "arab", f(meta.states.arab_majority || "#22b573"), "none", f(meta.states.none), "no_station", meta.states.no_station];
}

// one-party view: the party's share of valid votes in classes, from a pale tint to its full colour
const SHARE_BREAKS = [5, 10, 20, 35, 50];
const SHARE_TINT = [0.1, 0.25, 0.42, 0.6, 0.8, 1];
function mix(hex, t) {  // hex colour blended towards white; t = 1 keeps the colour
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return "#" + c.map(v => Math.round(255 - (255 - v) * t).toString(16).padStart(2, "0")).join("");
}
const shareColors = () => SHARE_TINT.map(t => mix(colors[shareParty], t));
function shareSteps(value, f = c => c) {
  const c = shareColors().map(f);
  return ["step", value, c[0], ...SHARE_BREAKS.flatMap((b, i) => [b, c[i + 1]])];
}


function colorExpr(b, l, k, f = c => c) {
  const grey = meta.states.built_empty || "#bdb9b0";
  if (mode === "share") return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["==", ["get", b], "no_station"], meta.states.no_station,
    // areas take their share from areas.json (feature state); dots carry it as pct_<letters>
    b === "b" ? ["case", ["==", ["typeof", ["feature-state", "v"]], "number"], shareSteps(["feature-state", "v"], f), "#e4e4e1"]
      : shareSteps(["coalesce", ["get", "pct_" + shareParty], 0], f)];
  if (mode === "bloc") return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["match", ["coalesce", ["get", k], ""], ...twoBlocStops(f), "#999999"]];
  return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["==", ["get", b], "no_station"], meta.states.no_station,
    ["==", ["get", b], "none"], f(meta.states.none),
    ["match", ["coalesce", ["get", l], ""], ...Object.entries(colors).flatMap(([x, c]) => [x, f(c)]), "#999999"]];
}
// areas with no station of their own show their nearest area's result in the same plain colour (Ben,
// 30 Oct: no marking, keep the map clean); the hover panel says so
const areaColor = () => colorExpr("b", "l", "k");

let showNames = true;
function setNames(on) {
  showNames = on;
  try { localStorage.setItem("town-names", on ? "on" : "off"); } catch (e) { /* private window */ }
  $("names").checked = on;
  if (map && map.getLayer("labels")) map.setLayoutProperty("labels", "visibility", on ? "visible" : "none");
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("colour-mode", m); } catch (e) { /* private window */ }
  for (const btn of $("modes").querySelectorAll("button")) btn.setAttribute("aria-pressed", btn.dataset.mode === m);
  $("party-pick").hidden = m !== "share";
  if (!$("intro").dataset.party) $("intro").dataset.party = $("intro").innerHTML;
  $("intro").innerHTML = m === "bloc"
    ? tr(`Two camps only: dark when a bloc wins more than 2/3 of valid votes, light when it wins a majority.
       Arab parties belong to neither bloc. <a href="about.html">How this works</a>.`,
       `שני מחנות בלבד: כהה כשגוש זוכה ביותר משני שלישים מהקולות הכשרים, בהיר כשהוא זוכה ברוב.
       המפלגות הערביות אינן שייכות לאף גוש. <a href="about-he.html">איך זה עובד</a>.`)
    : m === "share"
    ? tr(`One party's share of valid votes in each area, whichever party leads there.
       <a href="about.html">How this works</a>.`,
       `שיעור הקולות הכשרים של מפלגה אחת בכל אזור, בלי קשר למפלגה המובילה בו.
       <a href="about-he.html">איך זה עובד</a>.`)
    : $("intro").dataset.party;
  legend();
  syncURL();
  repaint();
}

function setShareParty(l) {
  shareParty = l;
  $("party").value = l;
  legend();
  syncURL();
  repaint();
}

// the selected party's share in every area, as feature state (the tiles carry only the leader)
let statesFor = null;
function applyShares() {
  if (mode !== "share" || !A || !map || !map.getSource("areas") || statesFor === shareParty) return;
  const k = A.parties.indexOf(shareParty);
  A.areas.forEach((r, i) => { if (r[8]) map.setFeatureState({ ...FS, id: i }, { v: k < 0 ? 0 : r[8][k] }); });
  statesFor = shareParty;
}

function repaint() {
  if (!map || !map.getLayer("fill")) return;
  applyShares();
  map.setPaintProperty("fill", "fill-color", areaColor());
  map.setPaintProperty("dots-fill", "fill-color", colorExpr("bloc", "leader", "bloc2"));
  map.setPaintProperty("dots", "circle-color", colorExpr("bloc", "leader", "bloc2"));
  map.setLayoutProperty("hatch", "visibility", mode === "party" ? "visible" : "none");
}

function setPlace(p) { place = p; syncURL(); }

// the info panel's starting hint (index.html), kept before the page switches language
const INFO_HINT_EN = $("info-body").innerHTML;
// unpin: no place in the address, no highlight, the panel back to its hint
function clearSelection() {
  setPlace(null);
  if (map) setHover(null);
  if (map && map.getLayer("town-hl")) map.setFilter("town-hl", ["==", ["get", "c"], -1]);
  $("info-body").innerHTML = tr(INFO_HINT_EN, $("info-body").dataset.he);
  $("info-body").classList.add("sub");
  $("info").classList.add("empty");
}

// "Copy link": the address already holds the whole view
async function copyLink() {
  syncURL();
  const done = $("copy-done");
  try { await navigator.clipboard.writeText(location.href); }
  catch (e) { window.prompt(tr("Copy this link:", "העתיקו את הקישור:"), location.href); return; }
  done.textContent = tr("Link copied", "הקישור הועתק");
  clearTimeout(copyLink.t);
  copyLink.t = setTimeout(() => { done.textContent = ""; }, 2500);
}

function status(msg) { const s = $("status"); s.textContent = msg; s.hidden = !msg; }

async function start() {
  if (location.protocol === "file:") {
    status(tr("This page needs a web server. Run scripts/serve_site.py and open the address it prints.",
      "הדף צריך שרת אינטרנט. יש להריץ את scripts/serve_site.py ולפתוח את הכתובת שהוא מדפיס."));
    return;
  }
  let years;
  try { years = await getJSON("data/years.json"); }
  catch (e) { status(tr("Could not load the map data.", "לא ניתן לטעון את נתוני המפה.")); throw e; }
  const asked = Q.get("year");
  year = years.includes(asked) ? asked : years[years.length - 1];
  const base = `data/${year}/`;

  meta = await getJSON(base + "meta.json");
  colors = meta.colors;
  parties = Object.fromEntries(meta.parties.map(p => [p.letters, p]));
  BLOCS = meta.bloc_order || [...new Set(meta.parties.map(p => p.bloc))];
  // the two camps; the Arab parties and uncommitted parties belong to neither
  const side = b => (meta.bloc_side || {})[b] || (b === "Arab parties" ? "arab" : "right");
  TWO_BLOCS = BLOCS.filter(b => side(b) === "right" || side(b) === "left");
  ARAB_BLOCS = BLOCS.filter(b => side(b) === "arab");
  BLOC_HE = meta.bloc_he || {};
  for (const b of BLOCS) {
    const first = meta.parties.find(p => p.bloc === b);
    blocColor[b] = (meta.blocs && meta.blocs[b]) || (first ? colors[first.letters] : "#999");
  }
  // a link's own view wins over this browser's last one
  let saved = null;
  try { saved = localStorage.getItem("colour-mode"); } catch (e) { /* private window */ }
  mode = MODES.includes(Q.get("view")) ? Q.get("view") : MODES.includes(saved) ? saved : "party";
  const askedParty = meta.parties.find(p => slug(p.english) === Q.get("party"));
  shareParty = askedParty ? askedParty.letters : meta.parties[0].letters;
  $("party").innerHTML = meta.parties.map(p => `<option value="${esc(p.letters)}">${esc(label(p.letters))}</option>`).join("");
  $("party").value = shareParty;
  $("party").addEventListener("change", e => setShareParty(e.target.value));
  place = Q.get("place");
  $("modes").addEventListener("click", e => {
    const m = e.target.closest("button")?.dataset.mode;
    if (m) setMode(m);
  });
  $("copy-link").addEventListener("click", copyLink);
  try { showNames = localStorage.getItem("town-names") !== "off"; } catch (e) { showNames = true; }
  $("names").addEventListener("change", e => setNames(e.target.checked));
  setNames(showNames);
  const namesReady = getJSON("data/area_names.json").then(d => { NAMES = d; }).catch(e => console.error(e));
  getJSON("data/places.json").then(d => { PAGES = d; }).catch(e => console.error(e));
  const areasReady = Promise.all([getJSON(base + "areas.json"), namesReady])
    .then(([d]) => { A = d; buildSearch(); applyShares(); });
  const dotsReady = getJSON(base + "dots.geojson").then(d => { DOTS = d; });

  applyLanguage();
  $("subtitle").textContent = HE ? (meta.subtitle_he || meta.subtitle) : meta.subtitle;
  document.title = tr(`Extremely Detailed Israeli Elections: ${yearLabel(meta.year)}`,
    `בחירות ישראל ברזולוציה מלאה: ${yearLabel(meta.year)}`);
  yearButtons(years, year);
  setMode(mode);
  envelopes();
  try { await dotsReady; } catch (e) { console.error(e); }
  initMap(base);
  try { await areasReady; } catch (e) { console.error(e); }
  restorePlace();
}

// ?place=<locality code> (a town) or <locality code>-<statistical area> (one area)
function restorePlace() {
  if (!place || !A) return;
  if (!map.getLayer("fill")) { map.once("load", restorePlace); return; }
  const [code, stat] = place.split("-").map(Number);
  const ti = A.towns.findIndex(t => t[0] === code);
  if (ti < 0) { setPlace(null); return; }
  const i = Number.isNaN(stat) || stat == null ? -1 : A.areas.findIndex(r => r[0] === ti && r[1] === stat);
  if (i < 0) { choose(ti, !location.hash); return; }
  showInfo(recordHtml(areaRecord(i)));
  setHover(i);
  if (!location.hash) {
    const [w, s, e, n] = A.towns[ti][3];
    map.fitBounds([[w, s], [e, n]], { padding: padding(), maxZoom: 14, duration: 0 });
  }
}

// ---------- names ----------

function label(l) {
  const p = parties[l];
  if (!p) return tr("Other lists", "רשימות אחרות");
  if (HE) return p.hebrew;
  return p.english === p.transliteration ? p.english : `${p.english} (${p.transliteration})`;
}
function swatch(c) { return `<span class="sw" style="background:${c}"></span>`; }

// ---------- side panel ----------

function yearButtons(years, year) {
  $("years").innerHTML = [...years].sort().map(y =>
    `<button type="button" data-year="${y}" aria-pressed="${y === year}">${yearLabel(y)}</button>`).join("");
  $("years").addEventListener("click", e => {
    const y = e.target.closest("button")?.dataset.year;
    if (!y || y === year) return;
    const q = stateParams();  // same view, party, place and map position in the other election
    q.set("year", y);
    location.href = "?" + q.toString() + location.hash;
  });
}

// blank land (no voters, not grey) is left clear so the land base and its parks, beaches and industry show;
// everything else is fully opaque
const fillOpacity = () => ["case", ["==", ["coalesce", ["get", "g"], 0], 1], 1,
  ["==", ["get", "b"], "no_station"], 0, 1];

function legend() {
  const lg = $("legend-body");
  let html = "";
  if (mode === "share") {
    const c = shareColors(), edges = [0, ...SHARE_BREAKS];
    html += `<h2>${esc(label(shareParty))}</h2><div class="sub">${tr("Share of valid votes", "שיעור מהקולות הכשרים")}</div>`
      + c.map((col, i) => `<div class="row">${swatch(col)}${i === c.length - 1
        ? tr(`${edges[i]}% or more`, `${edges[i]}% ומעלה`)
        : i === 0 ? tr(`Under ${edges[1]}%`, `פחות מ-${edges[1]}%`) : `${edges[i]}–${edges[i + 1]}%`}</div>`).join("");
  } else if (mode === "bloc") {
    const light = meta.blocs_light || {};
    const pname = l => esc(HE ? parties[l].hebrew : parties[l].english);
    html += TWO_BLOCS.map(b => `<h2>${blocName(b)}</h2><div class="sub">${
      meta.parties.filter(p => p.bloc === b).map(p => pname(p.letters)).join(", ")}</div>
      <div class="row">${swatch(blocColor[b])}${tr("Over 2/3 of valid votes", "יותר משני שלישים מהקולות הכשרים")}</div>
      <div class="row">${swatch(light[b] || blocColor[b])}${tr("Majority (over half)", "רוב (יותר ממחצית)")}</div>`).join("")
      + `<h2>${tr("Neither bloc", "אף גוש")}</h2>
      <div class="row">${swatch(meta.states.arab_majority || "#22b573")}${tr("Arab parties hold a majority", "רוב למפלגות הערביות")} (${
        meta.parties.filter(p => ARAB_BLOCS.includes(p.bloc)).map(p => pname(p.letters)).join(", ")})</div>`
      + (() => {  // parties that committed to neither camp before the vote
        const unc = meta.parties.filter(p => !TWO_BLOCS.includes(p.bloc) && !ARAB_BLOCS.includes(p.bloc));
        return unc.length ? `<div class="sub">${tr("Uncommitted, counted in neither bloc", "לא התחייבו לגוש, לא נספרים באף גוש")}: ${
          unc.map(p => pname(p.letters)).join(", ")}</div>` : "";
      })();
  } else for (const b of BLOCS) {
    const ps = meta.parties.filter(p => p.bloc === b);
    html += `<h2>${blocName(b)}</h2>` + ps.map(p => `<div class="row">${swatch(colors[p.letters])}${esc(label(p.letters))}</div>`).join("");
  }
  html += `<h2>${tr("Other", "אחר")}</h2>
    ${mode === "share" ? "" : `<div class="row">${swatch(meta.states.none)}${mode === "bloc" ? tr("No bloc with a majority", "אין גוש עם רוב")
      : tr("No bloc above 2/3", "אין גוש מעל שני שלישים")}</div>`}
    <div class="row">${swatch(meta.states.no_station)}${tr("Nobody lives here (no polling station)", "אין כאן תושבים (אין קלפי)")}</div>
    <div class="row">${swatch(meta.states.built_empty || "#bdb9b0")}${tr("Built up, nobody lives here (industry, port, airport, campus, offices)",
      "שטח בנוי ללא תושבים (תעשייה, נמל, שדה תעופה, קמפוס, משרדים)")}</div>
    <div class="row">${swatch(meta.states.park || "#cfe1b0")}${tr("Park", "פארק")}</div>
    <div class="row">${swatch(meta.states.beach || "#f0e8d4")}${tr("Beach", "חוף")}</div>
    <div class="row"><span class="sw" style="border:1.5px dashed #333;background:transparent"></span>
      ${tr("Locality without a CBS boundary (outline approximate)", "יישוב ללא גבול למ״ס (קו מתאר משוער)")}</div>`;
  lg.innerHTML = html;
}

function envelopes() {
  const n = meta.notes, env = n.double_envelope;
  const blocTotals = Object.fromEntries(BLOCS.map(b => [b, meta.parties.filter(p => p.bloc === b)
    .reduce((s, p) => s + (env.by_party[p.letters] || 0), 0)]));
  const byParty = [...meta.parties].sort((a, b) => (env.by_party[b.letters] || 0) - (env.by_party[a.letters] || 0));
  const offMap = `<div class="sub" style="margin-top:6px">${tr(`Also off the map: ${fmt(n.unplaced.valid)} votes from stations
      that could not be placed in a statistical area.`, `גם מחוץ למפה: ${fmt(n.unplaced.valid)} קולות מקלפיות שלא ניתן היה
      לשייך לאזור סטטיסטי.`)}</div>`;
  if (!env.valid) {  // the committee counts double envelopes days after the regular boxes
    $("envelopes").innerHTML = `
    <h2>${tr("Votes not on the map", "קולות שאינם על המפה")}</h2>
    <div class="sub">${tr(`Double-envelope votes (soldiers, hospitals, prisons, diplomats) have no location and are
      <b>not yet counted</b>: the committee adds them days after the regular boxes (about 459,000 votes in 2022).
      This map shows the regular boxes only.`,
      `קולות המעטפות הכפולות (חיילים, בתי חולים, בתי סוהר, נציגויות) אין להם מיקום ו<b>טרם נספרו</b>: ועדת הבחירות
      מוסיפה אותם ימים אחרי הקלפיות הרגילות (כ-459,000 קולות ב-2022). המפה מציגה את הקלפיות הרגילות בלבד.`)}</div>${offMap}`;
    return;
  }
  $("envelopes").innerHTML = `
    <h2>${tr("Votes not on the map", "קולות שאינם על המפה")}</h2>
    <div class="sub">${tr(`Double-envelope votes (soldiers, hospitals, prisons, diplomats) have no location:
      <b>${fmt(env.valid)}</b>, ${pctFmt(100 * env.valid / n.total_valid)} of ${fmt(n.total_valid)} valid votes.`,
      `לקולות המעטפות הכפולות (חיילים, בתי חולים, בתי סוהר, נציגויות) אין מיקום:
      <b>${fmt(env.valid)}</b>, ${pctFmt(100 * env.valid / n.total_valid)} מתוך ${fmt(n.total_valid)} קולות כשרים.`)}</div>
    <table>${BLOCS.map(b => `<tr><td>${blocName(b)}</td><td class="n">${fmt(blocTotals[b])}</td>
      <td class="n">${pctFmt(100 * blocTotals[b] / env.valid)}</td></tr>`).join("")}</table>
    <details><summary>${tr("By party", "לפי מפלגה")}</summary><table>${byParty.map(p =>
      `<tr><td>${esc(label(p.letters))}</td><td class="n">${fmt(env.by_party[p.letters] || 0)}</td></tr>`).join("")}
    </table></details>${offMap}`;
}

// ---------- info panel ----------

function sharesFromArray(arr) { return arr ? A.parties.map((l, k) => [l, arr[k]]) : []; }

function areaRecord(i) {
  const r = A.areas[i], t = A.towns[r[0]];
  const nb = NAMES[t[0] * 10000 + r[1]];
  return { code: t[0], name: t[2] || t[1], he: t[1], stat: r[1], nb: nb ? nb[HE ? 1 : 0] : "", valid: r[2], stations: r[3], approx: r[4],
    bloc: r[5], shares: sharesFromArray(r[8]), other: r[9] || 0, kind: t[5],
    estFrom: r[10], estVotes: r[11], population: r[12], placeholder: r[13], grey: r[14] === 1, bloc2: r[15] };
}

function dotRecord(p) {
  const shares = Object.keys(p).filter(k => k.startsWith("pct_") && k !== "pct_other").map(k => [k.slice(4), +p[k]]);
  return { code: +p.SEMEL_YISHUV, name: p.SHEM_YISHUV_ENGLISH || p.SHEM_YISHUV, he: p.SHEM_YISHUV, valid: +p.valid, stations: +p.stations,
    approx: +p.approx_stations, bloc: p.bloc, shares, other: +(p.pct_other || 0), kind: "dot", shape: p.shape_source, bloc2: p.bloc2 };
}

function dotKind(he) {
  if (/^מחנה/.test(he)) return tr("Army base", "בסיס צבאי");
  if (/שבט/.test(he)) return tr("Bedouin tribe", "שבט בדואי");
  return tr("Locality without a CBS boundary", "יישוב ללא גבול למ״ס");
}

function blocBar(blocShare) {
  return `<div class="blocbar" aria-hidden="true">${BLOCS.map(b =>
    `<span style="width:${blocShare[b]}%;background:${blocColor[b]}"></span>`).join("")}</div>`;
}

function resultsHtml(rec, verdict) {
  const shares = rec.shares.slice().sort((a, b) => b[1] - a[1]);
  const blocShare = Object.fromEntries(BLOCS.map(b => [b, shares
    .filter(([l]) => parties[l] && parties[l].bloc === b).reduce((s, [, v]) => s + v, 0)]));
  if (mode === "bloc" && verdict !== TOWN_TOTAL) {  // headline in the two-bloc view's own terms
    const top = TWO_BLOCS.find(b => blocShare[b] > 50);
    const arab = ARAB_BLOCS.reduce((s, b) => s + blocShare[b], 0);
    // the map's own class (from unrounded votes) when there is one, so hover and colour agree
    const [b2, level] = (rec.bloc2 || "").split("|");
    if (rec.bloc2 && rec.bloc2 !== "no_station") verdict = level
      ? `${blocName(b2)}, ${level === "strong" ? tr("over 2/3", "מעל שני שלישים") : tr("majority", "רוב")}`
      : b2 === "arab" ? tr("Arab parties majority", "רוב למפלגות הערביות") : tr("No bloc with a majority", "אין גוש עם רוב");
    else verdict = top ? `${blocName(top)}, ${blocShare[top] > 200 / 3 ? tr("over 2/3", "מעל שני שלישים") : tr("majority", "רוב")}`
      : arab > 50 ? tr("Arab parties majority", "רוב למפלגות הערביות") : tr("No bloc with a majority", "אין גוש עם רוב");
  }
  const counts = rec.estFrom != null
    ? tr(`estimated${rec.population ? ` · ${fmt(rec.population)} residents (2022 census)` : ""}`,
         `הערכה${rec.population ? ` · ${fmt(rec.population)} תושבים (מפקד 2022)` : ""}`)
    : tr(`${fmt(rec.valid)} valid votes · ${rec.stations} station${rec.stations === 1 ? "" : "s"}`,
         `${fmt(rec.valid)} קולות כשרים · ${rec.stations === 1 ? "קלפי אחת" : `${rec.stations} קלפיות`}`);
  let html = `<div class="sub">${verdict} · ${counts}</div>
    ${blocBar(blocShare)}
    <table>${BLOCS.map(b => `<tr><td><div class="row">${swatch(blocColor[b])}${blocName(b)}</div></td><td class="n">${pctFmt(blocShare[b])}</td></tr>`).join("")}</table>
    <h2>${tr("Parties", "מפלגות")}</h2><table>`;
  for (const [l, v] of shares.filter(([l, v]) => v >= 0.5 || (mode === "share" && l === shareParty))) {
    html += `<tr${mode === "share" && l === shareParty ? ' class="sel"' : ""}><td><div class="row">${swatch(colors[l])}
      <span>${esc(label(l))}<br><span class="he">${esc(HE ? parties[l].english : parties[l].hebrew)}</span></span></div></td>
      <td class="n">${pctFmt(v)}</td></tr>`;
  }
  return html + `<tr><td>${tr("Other lists", "רשימות אחרות")}</td><td class="n">${pctFmt(rec.other)}</td></tr></table>`;
}

// link to the town's own page, when it has one
const pageLink = code => PAGES[code]
  ? ` · <a href="town/${PAGES[code]}/${HE ? "he/" : ""}">${tr("Town page", "דף היישוב")}</a>` : "";

function recordHtml(rec) {
  const isDot = rec.kind === "dot";
  let html = `<h3>${esc(HE ? rec.he : rec.name)}${rec.stat ? ` <span class="sub">${rec.nb ? esc(rec.nb) + ", " : ""}${tr("area", "אזור")} ${rec.stat}</span>` : ""}</h3>
    <div class="he">${esc(HE ? rec.name : rec.he)}${pageLink(rec.code)}</div>`;
  if (isDot && rec.shape !== "cbs_merged") html += `<div class="sub">${dotKind(rec.he || "")}</div>`;
  if (rec.bloc === "no_station") return html + `<div class="sub">${rec.grey
    ? tr("Built up, but nobody lives here (campus, industry or offices), so no polling station.",
         "שטח בנוי, אך אין כאן תושבים (קמפוס, תעשייה או משרדים), ולכן אין קלפי.")
    : tr("No polling station in this area.", "אין קלפי באזור זה.")}</div>`;
  html += resultsHtml(rec, rec.bloc === "none" ? tr("No bloc above 2/3", "אין גוש מעל שני שלישים") : blocName(rec.bloc));
  if (rec.placeholder) html += `<div class="flag">${rec.placeholder === "osm"
    ? tr("CBS publishes only a point for this locality. Outline is its built-up area as mapped in OpenStreetMap, approximate.",
         "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. קו המתאר הוא השטח הבנוי כפי שממופה ב-OpenStreetMap, משוער.")
    : rec.placeholder === "buildings"
    ? tr("CBS publishes only a point for this locality. Outline drawn round its buildings (Microsoft building footprints), approximate.",
         "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. קו המתאר משורטט סביב המבנים שלו (טביעות מבנים של Microsoft), משוער.")
    : tr("CBS publishes only a point for this locality. Shape drawn round that point, approximate.",
         "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. הצורה משורטטת סביב הנקודה, משוערת.")}</div>`;
  if (rec.estFrom === 0) html += `<div class="flag">${tr(`The polling stations in this town could not be placed in
    statistical areas, so every populated area shows the whole town's result (${fmt(rec.estVotes)} valid votes).`,
    `לא ניתן היה לשייך את הקלפיות ביישוב זה לאזורים סטטיסטיים, ולכן כל אזור מיושב מציג את תוצאות היישוב כולו
    (${fmt(rec.estVotes)} קולות כשרים).`)}</div>`;
  else if (rec.estFrom != null) html += `<div class="flag">${tr(`No polling station in this area. People live here, so it shows the results of
    area ${rec.estFrom}, the nearest area in the same town with a station (${fmt(rec.estVotes)} valid votes).`,
    `אין קלפי באזור זה. יש בו תושבים, ולכן מוצגות תוצאות אזור ${rec.estFrom}, האזור הקרוב ביותר באותו יישוב שיש בו
    קלפי (${fmt(rec.estVotes)} קולות כשרים).`)}</div>`;
  if (rec.shape === "cbs_merged") html += `<div class="flag">${tr("Formed after the CBS 2022 boundaries were drawn; shown as the combined boundary of the localities it replaced.",
    "הוקם אחרי ששורטטו גבולות הלמ״ס של 2022; מוצג כגבול המשותף של היישובים שאותם החליף.")}</div>`;
  if (rec.shape === "osm") html += `<div class="flag">${tr("No CBS boundary: outline is the nearest matching area mapped in OpenStreetMap, approximate.",
    "אין גבול למ״ס: קו המתאר הוא השטח המתאים הקרוב ביותר ב-OpenStreetMap, משוער.")}</div>`;
  if (rec.shape === "buildings") html += `<div class="flag">${tr("No CBS boundary: outline drawn round its buildings (Microsoft building footprints), approximate.",
    "אין גבול למ״ס: קו המתאר משורטט סביב המבנים שלו (טביעות מבנים של Microsoft), משוער.")}</div>`;
  // "circle" is the older name for the same fallback
  if (rec.shape === "point" || rec.shape === "circle") html += `<div class="flag">${tr("No CBS boundary and no buildings found: marker at its approximate location.",
    "אין גבול למ״ס ולא נמצאו מבנים: סימון במיקום המשוער.")}</div>`;
  if (!isDot && rec.approx > 0) html += `<div class="flag">${tr(`${rec.approx} of ${rec.stations} station${rec.stations > 1 ? "s" : ""}
    placed approximately (location borrowed from a nearby-numbered station).`,
    `${rec.approx} מתוך ${rec.stations} קלפיות מוקמו בקירוב (לפי קלפי בעלת מספר סמוך).`)}</div>`;
  return html;
}

function townHtml(ti) {
  const t = A.towns[ti];
  let valid = 0, stations = 0, nAreas = 0, withStations = 0, other = 0;
  const votes = Object.fromEntries(A.parties.map(l => [l, 0]));
  for (const r of A.areas) {
    if (r[0] !== ti) continue;
    nAreas++;
    if (!r[8] || r[10] != null) continue;  // no station, or colour borrowed from a neighbour
    withStations++; valid += r[2]; stations += r[3];
    A.parties.forEach((l, k) => { votes[l] += r[8][k] * r[2] / 100; });
    other += (r[9] || 0) * r[2] / 100;
  }
  let html = `<h3>${esc(HE ? t[1] : (t[2] || t[1]))}</h3><div class="he">${esc(HE ? (t[2] || "") : t[1])}${pageLink(t[0])}</div>
    <div class="sub">${tr(`Whole town: ${nAreas} statistical areas, ${withStations} with polling stations.
    Hover an area for its own result.`, `כל היישוב: ${nAreas} אזורים סטטיסטיים, מהם ${withStations} עם קלפיות.
    ריחוף מעל אזור מציג את התוצאה שלו.`)}</div>`;
  if (!valid) return html;
  const rec = { valid, stations, other: 100 * other / valid,
    shares: A.parties.map(l => [l, 100 * votes[l] / valid]) };
  return html + resultsHtml(rec, TOWN_TOTAL);
}

function showInfo(html) {
  $("info-body").innerHTML = html;
  $("info-body").classList.remove("sub");
  $("info").classList.remove("empty");
}

// ---------- map ----------

function hatch(a, b) {
  const s = 12, c = document.createElement("canvas"); c.width = c.height = s;
  const x = c.getContext("2d");
  x.fillStyle = a; x.fillRect(0, 0, s, s);
  x.strokeStyle = b; x.lineWidth = 3;
  for (const o of [-s, 0, s]) { x.beginPath(); x.moveTo(o, s); x.lineTo(o + s, 0); x.stroke(); }
  return x.getImageData(0, 0, s, s);
}

function padding() {
  if (isPhone()) return { top: $("side").offsetHeight + 16, bottom: 16, left: 16, right: 16 };
  return { top: 24, bottom: 24, left: $("side").offsetWidth + 40, right: $("info").offsetWidth + 40 };
}

function initMap(base) {
  // PREVIEW (scripts/build_preview.py, for hosts that can't serve tiles): plain GeoJSON instead
  if (!PREVIEW) maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
  // Hebrew labels need right-to-left shaping; the plugin ships with the site
  if (maplibregl.getRTLTextPluginStatus() === "unavailable")
    maplibregl.setRTLTextPlugin(new URL("vendor/mapbox-gl-rtl-text-0.2.3.js", location.href).href, true);
  const tiles = new URL(base + "areas.pmtiles", location.href).href;
  const mapBg = getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim() || "#e6e6e3";

  map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: {}, glyphs: new URL("fonts/", location.href).href + `{fontstack}/{range}.${PREVIEW ? "woff" : "pbf"}`,
      layers: [{ id: "bg", type: "background", paint: { "background-color": mapBg } }] },
    bounds: meta.bounds, fitBoundsOptions: { padding: padding() },
    // with a frame, panning stops a little past it (more to the sides, where the panels sit)
    maxBounds: meta.frame ? [[meta.frame[0] - 2.5, meta.frame[1] - 0.6], [meta.frame[2] + 2.5, meta.frame[3] + 0.6]] : undefined,
    hash: true, attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 16, minZoom: 4,
  });
  // sea and large water follow the page theme, also when it changes after load
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => map.setPaintProperty("bg", "background-color",
    getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim() || "#e6e6e3"));
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution:
    tr('<a href="sources.html">CEC, CBS and others</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      '<a href="sources-he.html">ועדת הבחירות, הלמ״ס ואחרים</a> · © <a href="https://www.openstreetmap.org/copyright">תורמי OpenStreetMap</a>') }));

  const canvas = map.getCanvas();
  canvas.setAttribute("aria-label", tr("Election map. Arrow keys move, plus and minus zoom, Enter reads the area under the cross.",
    "מפת הבחירות. החיצים מזיזים, פלוס ומינוס לזום, Enter קורא את האזור שמתחת לצלב."));
  // show the cross only for keyboard focus, not after a mouse click or tap
  canvas.addEventListener("focus", () => document.body.classList.toggle("map-focus", canvas.matches(":focus-visible")));
  canvas.addEventListener("blur", () => document.body.classList.remove("map-focus"));
  canvas.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const c = map.getCanvas(), pt = [c.clientWidth / 2, c.clientHeight / 2];
    pick(pt, true);
  });

  map.on("error", e => console.error(e.error || e));
  map.once("idle", () => status(""));

  map.on("load", () => {
    const pairs = new Set();
    for (const b of BLOCS) {
      const ls = meta.parties.filter(p => p.bloc === b).map(p => p.letters);
      for (const a of ls) for (const c of ls) if (a !== c) pairs.add(`${a}|${c}`);
    }
    for (const pr of pairs) {
      const [a, c] = pr.split("|");
      map.addImage(`h-${a}-${c}`, hatch(colors[a], colors[c]));
    }
    // the sea near Israel and the Sea of Galilee in water blue (scripts/land_features.py); the land base
    // sits on top and already stops at the coast
    map.addSource("water", { type: "geojson", data: "data/water.geojson" });
    map.addLayer({ id: "water", type: "fill", source: "water", paint: { "fill-color": meta.states.water || "#c6dcea" } });
    // one land base under everything: CBS areas plus the West Bank, gaps closed, so nothing is unclaimed
    map.addSource("land", { type: "geojson", data: "data/land.geojson" });
    map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": meta.states.no_station } });
    // parks, beaches and industry (OpenStreetMap, scripts/land_features.py): seen only where blank land leaves them clear
    map.addSource("landfeat", { type: "geojson", data: "data/land_features.geojson" });
    map.addLayer({ id: "landfeat", type: "fill", source: "landfeat", minzoom: 9, paint: { "fill-color": ["match", ["get", "t"],
      "park", meta.states.park || "#cfe1b0", "beach", meta.states.beach || "#f0e8d4", meta.states.built_empty || "#bdb9b0"] } });
    map.addSource("west-bank", { type: "geojson", data: "data/west_bank.geojson" });

    if (PREVIEW) {
      map.addSource("areas", { type: "geojson", data: base + "areas.geojson" });
      map.addSource("loc", { type: "geojson", data: base + "loc.geojson" });
    } else map.addSource("areas", { type: "vector", url: "pmtiles://" + tiles });
    const src = PREVIEW ? { source: "areas" } : { source: "areas", "source-layer": "areas" };
    const locSrc = PREVIEW ? { source: "loc" } : { source: "areas", "source-layer": "loc" };
    map.addLayer({ id: "fill", type: "fill", ...src, paint: { "fill-color": areaColor(), "fill-opacity": fillOpacity() } });
    map.addLayer({ id: "hatch", type: "fill", ...src, filter: ["has", "s"],
      layout: { visibility: mode === "party" ? "visible" : "none" },
      paint: { "fill-pattern": ["concat", "h-", ["get", "l"], "-", ["get", "s"]] } });
    // as on the reference: bold outlines round places where people vote, a hairline for regional-council
    // land, and no inner lines on empty land
    map.addLayer({ id: "area-line", type: "line", ...src, filter: ["!=", ["get", "b"], "no_station"],
      paint: { "line-color": meta.states.outline, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.1, 12, 0.6] } });
    map.addLayer({ id: "loc-line", type: "line", ...locSrc, filter: ["==", ["get", "p"], 1],
      paint: { "line-color": meta.states.locality_outline, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1.4] } });
    map.addLayer({ id: "hl", type: "line", ...src,
      paint: { "line-color": "#000", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0] } });
    map.addLayer({ id: "town-hl", type: "line", ...locSrc, filter: ["==", ["get", "c"], -1],
      paint: { "line-color": "#000", "line-width": 3 } });

    map.addSource("dots", { type: "geojson", data: DOTS });
    const poly = ["==", ["geometry-type"], "Polygon"];
    map.addLayer({ id: "dots-fill", type: "fill", source: "dots", filter: poly,
      paint: { "fill-color": colorExpr("bloc", "leader", "bloc2") } });
    map.addLayer({ id: "dots-line", type: "line", source: "dots", filter: poly,
      paint: { "line-color": "#333", "line-width": 1, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "dots", type: "circle", source: "dots", filter: ["==", ["geometry-type"], "Point"], paint: {
      "circle-color": colorExpr("bloc", "leader", "bloc2"), "circle-stroke-color": "#333", "circle-stroke-width": 0.8,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, ["interpolate", ["linear"], ["get", "valid"], 0, 2, 3000, 6],
        12, ["interpolate", ["linear"], ["get", "valid"], 0, 5, 3000, 14]] } });
    map.addLayer({ id: "wb-line", type: "line", source: "west-bank",
      paint: { "line-color": meta.states.west_bank_line || "#5c5c5c", "line-width": 1.2, "line-dasharray": [3, 2] } });
    // the Dead Sea as one solid water shape over every line, when the build includes it (build_site --dead-sea)
    if (meta.dead_sea) {
      map.addSource("dead-sea", { type: "geojson", data: "data/dead_sea.geojson" });
      map.addLayer({ id: "dead-sea", type: "fill", source: "dead-sea", paint: { "fill-color": meta.states.water || "#c6dcea" } });
    }

    // the frame: everything outside the sea's rectangle in the page colour, with a thin border (build_site --frame)
    if (meta.frame) {
      const [w, s, e, n] = meta.frame, ring = [[w, s], [e, s], [e, n], [w, n], [w, s]];
      map.addSource("frame", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon",
        coordinates: [[[-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85]], ring.slice().reverse()] } } });
      map.addSource("frame-line", { type: "geojson", data: { type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: ring } } });
      const pageBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f7f7f5";
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#5f6368";
      map.once("idle", () => {  // above the labels, so nothing spills past the border
        map.addLayer({ id: "frame", type: "fill", source: "frame", paint: { "fill-color": pageBg } });
        map.addLayer({ id: "frame-line", type: "line", source: "frame-line", paint: { "line-color": ink, "line-width": 1.2 } });
      });
    }

    // town names in capitals, as on the reference; bigger places win when labels collide
    map.addSource("labels", { type: "geojson", data: base + "labels.geojson" });
    map.addLayer({ id: "labels", type: "symbol", source: "labels", minzoom: 6,
      filter: ["<=", ["coalesce", ["get", "z"], 9], ["zoom"]],  // each name has its own zoom (build_site.label_minzoom)
      layout: { visibility: showNames ? "visible" : "none",
      "text-field": HE ? ["coalesce", ["get", "nh"], ["get", "n"]] : ["get", "n"], "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"],
        7, ["interpolate", ["linear"], ["get", "v"], 0, 8, 50000, 11],
        12, ["interpolate", ["linear"], ["get", "v"], 0, 11, 50000, 16]],
      "symbol-sort-key": ["-", ["get", "v"]], "text-padding": 3, "text-max-width": 8 },
      paint: { "text-color": "#2b2b2b", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.4 } });

    applyShares();
    map.on("mousemove", e => pick(e.point, false));
    map.on("click", e => pick(e.point, true));
    map.on("mouseout", () => { if (!pinned()) setHover(null); });
  });
}

function setHover(id) {
  if (hovered === id) return;
  if (hovered !== null) map.setFeatureState({ ...FS, id: hovered }, { hover: false });
  hovered = id;
  if (id !== null) map.setFeatureState({ ...FS, id }, { hover: true });
}

// a place is pinned once it is in the address and its details can be shown
const pinned = () => place != null && A != null;

function pick(point, sticky) {
  if (!map.getLayer("fill")) return;
  const f = map.queryRenderedFeatures(point, { layers: ["dots", "dots-fill", "fill"] })
    .find(x => x.properties.b !== "no_station" || x.properties.g === 1);  // empty land: no highlight
  map.getCanvas().style.cursor = f ? "pointer" : "";
  // a pinned place (click, tap, search or link) keeps the panel and highlight; hover leaves it alone
  if (!sticky && pinned()) return;
  if (!f) { if (sticky) clearSelection(); else setHover(null); return; }
  if (sticky) map.setFilter("town-hl", ["==", ["get", "c"], -1]);
  if (f.layer.id === "fill") {
    setHover(f.id);
    if (!A) { showInfo(`<div class="sub">${tr("Loading area details...", "טוען את פרטי האזור...")}</div>`); return; }
    showInfo(recordHtml(areaRecord(f.id)));
    if (sticky) { const r = A.areas[f.id]; setPlace(`${A.towns[r[0]][0]}-${r[1]}`); }
  } else {
    setHover(null);
    showInfo(recordHtml(dotRecord(f.properties)));
    if (sticky) setPlace(String(f.properties.SEMEL_YISHUV));
  }
}

// ---------- town search ----------

const HE_FINAL = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const normHe = s => s.replace(/[֑-ׇ]/g, "").replace(/[^א-ת]/g, "").replace(/[ךםןףץ]/g, c => HE_FINAL[c]);
const normEn = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
function skeleton(s) {
  s = normEn(s).replace(/kh|ch/g, "h").replace(/ph/g, "f").replace(/tz|ts/g, "z").replace(/ck|q|c/g, "k")
    .replace(/w|v/g, "b");
  return (s[0] || "") + s.slice(1).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
}
const hasHebrew = s => /[א-ת]/.test(s);

let townIndex = [], active = -1, results = [];

function buildSearch() {
  const size = new Map();
  for (const r of A.areas) size.set(r[0], (size.get(r[0]) || 0) + (r[2] || 0) + 1);
  const entry = (en, he, extra) => {
    const words = en.flatMap(n => n.toLowerCase().split(/[\s\-()]+/).map(normEn)).filter(Boolean);
    const hes = he.map(normHe).filter(Boolean);
    return { en: en.map(normEn), words, sk: en.map(skeleton), hes,
      heWords: he.flatMap(h => h.split(/[\s\-]+/)).map(normHe).filter(Boolean), ...extra };
  };
  townIndex = A.towns.map((t, i) => t[5] === "none" ? null
    : entry([t[2], ...t[4]].filter(Boolean), [t[1]], { i, size: size.get(i) || 0 })).filter(Boolean);
  // neighbourhoods: one entry per name in a town, covering every area that carries it
  const byCode = new Map(A.areas.map((r, i) => [A.towns[r[0]][0] * 10000 + r[1], i]));
  const groups = new Map();
  for (const [code, [en, he, box, rest]] of Object.entries(NAMES)) {
    const i = byCode.get(+code);
    if (i == null) continue;
    const ti = A.areas[i][0], key = ti + "|" + en;
    const g = groups.get(key) || { ti, en, he, rest: new Set(), areas: [], box: [180, 90, -180, -90] };
    g.areas.push(i);
    (rest || "").split(", ").filter(Boolean).forEach(n => g.rest.add(n));
    g.box = [Math.min(g.box[0], box[0]), Math.min(g.box[1], box[1]), Math.max(g.box[2], box[2]), Math.max(g.box[3], box[3])];
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    townIndex.push(entry(g.en.split(" / "), [...g.he.split(" / "), ...g.rest],
      { nb: g, i: g.ti, size: -1 }));  // after a town of the same score
  }

  const input = $("town"), list = $("town-list");
  input.addEventListener("input", () => { results = search(input.value); active = results.length ? 0 : -1; render(); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) chooseResult(results[Math.max(active, 0)]);
    } else if (e.key === "Escape") {
      if (!list.hidden) { list.hidden = true; input.setAttribute("aria-expanded", "false"); }
      else input.value = "";
    }
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; input.setAttribute("aria-expanded", "false"); }, 150));
  list.addEventListener("mousedown", e => {
    const li = e.target.closest("li[data-k]");
    if (li) { e.preventDefault(); chooseResult(results[+li.dataset.k]); }
  });
}

function search(q) {
  q = q.trim();
  if (!q) return [];
  const scored = [];
  if (hasHebrew(q)) {
    const h = normHe(q);
    if (!h) return [];
    for (const t of townIndex) {
      let s = t.hes.includes(h) ? 0 : t.hes.some(e => e.startsWith(h)) ? 1 : t.heWords.some(w => w.startsWith(h)) ? 2
        : t.hes.some(e => e.includes(h)) ? 3 : 9;
      if (s < 9) scored.push([s, t]);
    }
  } else {
    const n = normEn(q), k = skeleton(q);
    if (!n) return [];
    for (const t of townIndex) {
      let s = 9;
      if (t.en.includes(n)) s = 0;
      else if (t.en.some(e => e.startsWith(n))) s = 1;
      else if (t.words.some(w => w.startsWith(n))) s = 2;
      else if (n.length > 2 && t.en.some(e => e.includes(n))) s = 3;
      else if (k.length > 2 && t.sk.some(e => e.startsWith(k))) s = 4;
      else if (k.length > 3 && t.sk.some(e => e.includes(k))) s = 5;
      if (s < 9) scored.push([s, t]);
    }
  }
  scored.sort((a, b) => a[0] - b[0] || b[1].size - a[1].size);
  return scored.slice(0, 8).map(([, t]) => t);
}

function render() {
  const input = $("town"), list = $("town-list");
  if (!input.value.trim()) { list.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
  list.innerHTML = results.length ? results.map((e, k) => {
    const t = A.towns[e.i];
    const en = e.nb ? `${e.nb.en}, ${t[2] || t[1]}` : t[2] || t[1], he = e.nb ? `${e.nb.he}, ${t[1]}` : t[1];
    return `<li role="option" id="opt-${k}" data-k="${k}" aria-selected="${k === active}">
      <span>${esc(en)}</span><span class="he">${esc(he)}</span></li>`;
  }).join("") : `<li class="none" role="option" aria-disabled="true">${tr("Nothing found", "לא נמצא")}</li>`;
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (active >= 0) {
    input.setAttribute("aria-activedescendant", `opt-${active}`);
    $(`opt-${active}`).scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

// a search result: a town, or a neighbourhood (one area is pinned; several show their town)
function chooseResult(e) {
  if (!e.nb) { choose(e.i); return; }
  const g = e.nb, t = A.towns[g.ti], [w, s, ea, n] = g.box;
  $("town").value = `${HE ? g.he : g.en}, ${HE ? t[1] : t[2] || t[1]}`;
  $("town-list").hidden = true;
  $("town").setAttribute("aria-expanded", "false");
  map.fitBounds([[w, s], [ea, n]], { padding: padding(), maxZoom: 15, duration: reduceMotion ? 0 : 900 });
  map.setFilter("town-hl", ["==", ["get", "c"], -1]);
  if (g.areas.length === 1) {
    const i = g.areas[0];
    setPlace(`${t[0]}-${A.areas[i][1]}`);
    setHover(i);
    showInfo(recordHtml(areaRecord(i)));
    return;
  }
  setPlace(String(t[0]));
  setHover(null);
  showInfo(`<h3>${esc(HE ? g.he : g.en)}</h3><div class="he">${esc(HE ? g.en : g.he)}</div>
    <div class="sub">${esc(HE ? t[1] : t[2] || t[1])}, ${tr("areas", "אזורים")} ${g.areas.map(i => A.areas[i][1]).sort((a, b) => a - b).join(", ")}.
    ${tr("Hover an area for its own result.", "ריחוף מעל אזור מציג את התוצאה שלו.")}</div>`);
}

function choose(ti, fly = true) {
  const t = A.towns[ti], [w, s, e, n] = t[3];
  const input = $("town");
  input.value = t[2] || t[1];
  $("town-list").hidden = true;
  input.setAttribute("aria-expanded", "false");
  setPlace(String(t[0]));
  if (fly) map.fitBounds([[w, s], [e, n]], { padding: padding(), maxZoom: t[5] === "dot" ? 13 : 14, duration: reduceMotion ? 0 : 900 });
  map.setFilter("town-hl", ["==", ["get", "c"], t[5] === "area" ? t[0] : -1]);
  setHover(null);
  if (t[5] === "dot") {
    const f = DOTS.features.find(f => +f.properties.SEMEL_YISHUV === t[0]);
    showInfo(f ? recordHtml(dotRecord(f.properties)) : `<h3>${esc(t[2])}</h3>`);
    return;
  }
  const own = A.areas.reduce((acc, r, i) => (r[0] === ti ? acc.concat(i) : acc), []);
  showInfo(own.length === 1 ? recordHtml(areaRecord(own[0])) : townHtml(ti));
}

// ---------- page wiring ----------

document.addEventListener("keydown", e => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    $("town").focus();
  }
});
document.querySelector("#info .close").addEventListener("click", clearSelection);
if (isPhone()) $("legend-box").open = false;
if (HE) $("status").textContent = $("status").dataset.he;  // before the rest of the page switches language

start().catch(e => { console.error(e); status(tr("Something went wrong loading the map.", "משהו השתבש בטעינת המפה.")); });
