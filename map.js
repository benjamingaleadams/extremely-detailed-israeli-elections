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
const isPhone = () => matchMedia("(max-width: 900px)").matches;
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });

let PAGES = {};  // locality code -> town page slug (data/places.json)
let NAMES = {};  // "<locality code x 10000 + area>": [English, Hebrew, [w, s, e, n], other CBS names in Hebrew]
// the election being drawn: these names always point at one loaded election (see bind below); outside
// inCtx they are the main map's election
let meta, A = null, DOTS = { type: "FeatureCollection", features: [] }, map, parties, colors, blocColor = {};
let hovered = null, mode = "party";
const PREVIEW = window.PREVIEW_DATA === true;

// ---------- the address is the state: ?year=&view=&party=&place=&lang= plus #zoom/lat/lng ----------
// Shared links depend on these names (CLAUDE.md, "Shareable links"): never rename or reuse one.
// Added 31 Oct: view=change with from=<election> and side=right|left|arab (or party=<slug>);
// compare=<election> (a second map beside the first); blocs=<list>.<side>_... (bloc coding changed by the reader)
const Q = new URLSearchParams(location.search);
// a shared link (one with a year) shows exactly what the sender saw: this browser's last view is ignored,
// and a link that already had a map position keeps it (MapLibre writes a hash of its own on load)
const SHARED = Q.has("year");
const linkHadHash = !!location.hash;
const MODES = ["party", "bloc", "share", "change"];
let year = null, shareParty = null, place = null, YEARS = [];
const slug = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const partySlug = l => slug(parties[l].english);

// ---------- loaded elections: the main one (P), the "since" election of the change view (F) and the
// second map's (C). Each holds its own meta, parties, blocs, areas and map ----------
let P = null, F = null, C = null, cur = null;
function bind(E) {
  cur = E; meta = E.meta; colors = E.colors; parties = E.parties; A = E.A; DOTS = E.DOTS;
  BLOCS = E.BLOCS; TWO_BLOCS = E.TWO_BLOCS; ARAB_BLOCS = E.ARAB_BLOCS; BLOC_HE = E.BLOC_HE;
  blocColor = E.blocColor; map = E.map; shareParty = E.shareParty;
}
// run f with another election's data in the shared names; synchronous, so nothing else sees the switch
function inCtx(E, f) { const prev = cur; bind(E); try { return f(); } finally { bind(prev); } }

// ---------- bloc coding: which side each list counts for (tables/blocs.csv by default; the reader can change it) ----------
const SIDES = ["right", "left", "arab", "none"];
const SIDE_ORDER = ["right", "left", "none", "arab"];  // legends and tables, as build_site.SIDE_ORDER
const SIDE_FALLBACK = { right: "Right-wing bloc", left: "Centre-left bloc", arab: "Arab parties", none: "Uncommitted" };
const BLOC_HE_FALLBACK = { "Right-wing bloc": "גוש הימין", "Centre-left bloc": "גוש המרכז-שמאל",
  "Arab parties": "המפלגות הערביות", "Uncommitted": "לא התחייבו לגוש" };
const codeSide = s => s === "uncommitted" ? "none" : s;  // blocs.csv says "uncommitted"
const codingKey = p => slug(p.english).replace(/^the-/, "");  // "the-joint-list" and "joint-list" are one list
// blocs=<list>.<side>_<list>.<side>: only the lists the reader moved
const CODING = {};
for (const part of (Q.get("blocs") || "").split("_")) {
  const k = part.lastIndexOf("."), s = part.slice(k + 1);
  if (k > 0 && SIDES.includes(s)) CODING[part.slice(0, k)] = s;
}
const codingParam = () => Object.keys(CODING).sort().map(k => `${k}.${CODING[k]}`).join("_");

function sideOfBloc(E, b) {
  const s = (E.meta.bloc_side || {})[b];
  if (s) return codeSide(s);
  return SIDES.find(k => E.sideBloc[k] === b) || (b === "Arab parties" ? "arab" : "right");
}
function newCtx(y, m) {
  const E = { year: y, base: `data/${y}/`, meta: m, colors: m.colors, A: null,
    DOTS: { type: "FeatureCollection", features: [] }, map: null, hovered: null, shareParty: null, blocColor: {} };
  for (const p of m.parties) p.bloc0 = p.bloc;
  E.parties = Object.fromEntries(m.parties.map(p => [p.letters, p]));
  E.sideBloc = {};  // the bloc that stands for each side in this election
  for (const b of m.bloc_order || [...new Set(m.parties.map(p => p.bloc))]) {
    const s = codeSide((m.bloc_side || {})[b] || (b === "Arab parties" ? "arab" : "right"));
    if (!E.sideBloc[s]) E.sideBloc[s] = b;
  }
  for (const s of SIDES) if (!E.sideBloc[s]) E.sideBloc[s] = SIDE_FALLBACK[s];
  recode(E);
  return E;
}
// apply the reader's coding to one election: each list's bloc, the bloc order and colours
function recode(E) {
  const m = E.meta;
  for (const p of m.parties) { const o = CODING[codingKey(p)]; p.bloc = o ? E.sideBloc[o] : p.bloc0; }
  E.custom = m.parties.some(p => p.bloc !== p.bloc0);
  const order = m.bloc_order || [];
  E.BLOCS = [...new Set(m.parties.map(p => p.bloc))].sort((a, b) =>
    SIDE_ORDER.indexOf(sideOfBloc(E, a)) - SIDE_ORDER.indexOf(sideOfBloc(E, b)) || order.indexOf(a) - order.indexOf(b));
  E.TWO_BLOCS = E.BLOCS.filter(b => ["right", "left"].includes(sideOfBloc(E, b)));
  E.ARAB_BLOCS = E.BLOCS.filter(b => sideOfBloc(E, b) === "arab");
  E.BLOC_HE = { ...BLOC_HE_FALLBACK, ...(m.bloc_he || {}) };
  E.blocColor = {};
  for (const b of E.BLOCS) {
    const first = m.parties.find(p => p.bloc === b);
    E.blocColor[b] = (m.blocs && m.blocs[b]) || (first ? E.colors[first.letters] : "#999");
  }
  for (const s of SIDES) if (!E.blocColor[E.sideBloc[s]])
    E.blocColor[E.sideBloc[s]] = (m.blocs && m.blocs[E.sideBloc[s]]) || "#999";
  E.cFor = E.hatchFor = E.dotsFor = null;  // colours to redo
}
function setAreas(E, a) {
  E.A = a;
  E.pidx = Object.fromEntries(a.parties.map((l, k) => [l, k]));
  E.keyIdx = new Map(a.areas.map((r, i) => [keyOf(a, r), i]));
}
const keyOf = (a, r) => a.towns[r[0]][0] * 10000 + (r[1] || 0);  // the same 2022 area in every election
// another election, loaded once (meta, areas, rough shapes)
const CACHE = {};
function loadCtx(y) {
  return CACHE[y] ||= (async () => {
    const b = `data/${y}/`;
    const [m, a, d] = await Promise.all([getJSON(b + "meta.json"), getJSON(b + "areas.json"),
      getJSON(b + "dots.geojson").catch(() => ({ type: "FeatureCollection", features: [] }))]);
    const E = newCtx(y, m);
    setAreas(E, a);
    E.DOTS = d;
    DONE[y] = E;
    return E;
  })();
}
const allCtx = () => [P, F, C].filter((E, i, all) => E && all.indexOf(E) === i);

// a list's results under the current coding: party view (bloc over 2/3, its leader and second) and
// two-bloc view class, as scripts/areas.py does; get(letters) is the list's share
function classify(E, get) {
  const bs = {};
  for (const p of E.meta.parties) bs[p.bloc] = (bs[p.bloc] || 0) + (get(p.letters) || 0);
  let top = null;
  for (const b of E.BLOCS) if (top === null || bs[b] > bs[top]) top = b;
  let bloc = "none", leader = null, second = null;
  if (top !== null && bs[top] > 200 / 3) {
    const ranked = E.meta.parties.filter(p => p.bloc === top).map(p => [p.letters, get(p.letters) || 0])
      .sort((a, b) => b[1] - a[1]);
    bloc = top; leader = ranked[0][0];
    if (ranked.length > 1 && ranked[1][1] > 0 && ranked[1][1] >= ranked[0][1] / 2) second = ranked[1][0];
  }
  let bloc2 = "none";
  for (const b of E.TWO_BLOCS) if (bs[b] > 50) bloc2 = `${b}|majority`;
  for (const b of E.TWO_BLOCS) if (bs[b] > 200 / 3) bloc2 = `${b}|strong`;
  if (E.ARAB_BLOCS.reduce((s, b) => s + (bs[b] || 0), 0) > 50) bloc2 = "arab";
  return { bloc, leader, second, bloc2 };
}
const rowGet = (E, r) => l => (r[8] && E.pidx[l] != null ? r[8][E.pidx[l]] : 0);
const propGet = p => l => +(p["pct_" + l] || 0);

// ---------- change view: one side's (or one party's) share now minus in an earlier election ----------
let FROM = null, MEASURE = { side: "right" };
const CHG_BREAKS = [1, 3, 6, 10, 20];
const CHG_TINT = [0.2, 0.38, 0.58, 0.8, 1];
const CHG_MID = "#ecebe6", NO_CMP = "#c5c8ce";  // under a point either way; no result in one of the two
const measureKey = () => MEASURE.side ? "side:" + MEASURE.side : "party:" + MEASURE.party;
// the measure's share in one result of election E (null: the party did not run there)
function measureIn(E, get) {
  if (MEASURE.side) return E.meta.parties.reduce((s, p) => s + (sideOfBloc(E, p.bloc) === MEASURE.side ? get(p.letters) || 0 : 0), 0);
  const p = findParty(MEASURE.party, E.meta);
  return p ? get(p.letters) || 0 : null;
}
function measureName() {
  if (MEASURE.side) return blocName(P.sideBloc[MEASURE.side]);
  const p = findParty(MEASURE.party, P.meta);
  return p ? esc(HE ? p.hebrew : p.english) : MEASURE.party;
}
function measureColors() {
  const right = P.blocColor[P.sideBloc.right], left = P.blocColor[P.sideBloc.left];
  if (MEASURE.side === "right") return [right, left];
  if (MEASURE.side === "left") return [left, right];
  const gain = MEASURE.side === "arab" ? (P.meta.states.arab_majority || "#16834f")
    : P.colors[(findParty(MEASURE.party, P.meta) || {}).letters] || "#555555";
  // losses in whichever of two plain colours is further from the gain colour
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const dist = (a, b) => rgb(a).reduce((s, v, i) => s + (v - rgb(b)[i]) ** 2, 0);
  return [gain, ["#b35806", "#5e3c99"].sort((a, b) => dist(b, gain) - dist(a, gain))[0]];
}
function changeColor(d) {
  if (d == null) return NO_CMP;
  if (Math.abs(d) < CHG_BREAKS[0]) return CHG_MID;
  const [gain, loss] = measureColors();
  const k = CHG_BREAKS.filter(b => Math.abs(d) >= b).length - 1;
  return mix(d > 0 ? gain : loss, CHG_TINT[k]);
}
// an area of election E against the same area in F: { now, then, d } (then and d null when not comparable)
function changeOfArea(E, i) {
  const r = E.A.areas[i];
  if (!r[8]) return null;
  const now = measureIn(E, rowGet(E, r));
  const j = F && F.A ? F.keyIdx.get(keyOf(E.A, r)) : null;
  const rf = j != null ? F.A.areas[j] : null;
  const then = rf && rf[8] ? measureIn(F, rowGet(F, rf)) : null;
  return { now, then, d: now != null && then != null ? now - then : null };
}
function changeOfDot(props) {
  const now = measureIn(cur, propGet(props));
  const f = F && F.DOTS.features.find(x => +x.properties.SEMEL_YISHUV === +props.SEMEL_YISHUV);
  const then = f ? measureIn(F, propGet(f.properties)) : null;
  return { now, then, d: now != null && then != null ? now - then : null };
}

function stateParams() {
  const q = new URLSearchParams();
  q.set("year", year);
  if (mode !== "party") q.set("view", mode);
  if (mode === "share" && shareParty) q.set("party", partySlug(shareParty));
  if (place) q.set("place", place);
  if (HE) q.set("lang", "he");
  if (mode === "change" && FROM) {
    q.set("from", FROM);
    if (MEASURE.side) q.set("side", MEASURE.side); else q.set("party", MEASURE.party);
  }
  if (C) q.set("compare", C.year);
  if (codingParam()) q.set("blocs", codingParam());
  return q;
}
function syncURL() {
  if (!year) return;
  history.replaceState(history.state, "", "?" + stateParams().toString() + location.hash);
  langHref();
}
// the language link always points at this view in the other language (also for middle-click)
function langHref() {
  const sw = $("lang-switch");
  if (!sw || !year) return;
  const q = stateParams();
  if (HE) q.delete("lang"); else q.set("lang", "he");
  sw.href = "?" + q.toString() + location.hash;
}

// ---------- language: English by default, Hebrew with ?lang=he ----------
// only the address decides, so a link without lang= always opens in English (technical review H2);
// Hebrew pages link to the map with lang=he
const HE = Q.get("lang") === "he";
const tr = (en, he) => HE ? he : en;
const blocName = b => HE ? (BLOC_HE[b] || b) : b;
// "2019-04" -> "Apr 2019"; plain years stay as they are
const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  he: ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"] };
const yearLabel = y => {
  const [yr, mo] = String(y).split("-");
  return mo ? `${MONTHS[HE ? "he" : "en"][+mo - 1]} ${yr}` : yr;
};
// year buttons: "Apr '19", so the eight elections fit in two rows
const yearShort = y => {
  const [yr, mo] = String(y).split("-");
  return mo ? `${MONTHS[HE ? "he" : "en"][+mo - 1]} '${yr.slice(2)}` : yr;
};
const TOWN_TOTAL = tr("Town total", "סה״כ ביישוב");
// a name's other-language form on a second line or after it: Hebrew runs right to left, English left to right
const otherName = (en, he) => HE ? `<span class="alt" dir="ltr">${esc(en)}</span>` : `<span class="he">${esc(he)}</span>`;

function applyLanguage() {
  const sw = $("lang-switch");
  if (sw) {
    // kept current by syncURL, and refreshed when followed so it carries the map position
    langHref();
    sw.addEventListener("click", langHref);
    window.addEventListener("hashchange", langHref);
    sw.textContent = HE ? "English" : "עברית";
    sw.lang = HE ? "en" : "he";
  }
  if (!HE) return;
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
  for (const el of document.querySelectorAll("[data-he]")) el.innerHTML = el.dataset.he;
  for (const el of document.querySelectorAll("[data-he-label]")) el.setAttribute("aria-label", el.dataset.heLabel);
  $("town").placeholder = "למשל חיפה או Haifa";
  for (const a of document.querySelectorAll("[data-he-href]")) a.href = a.dataset.heHref;
  for (const a of document.querySelectorAll(".site-footer a"))
    a.href = a.getAttribute("href").replace("sources.html", "sources-he.html");
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
const SHARE_TINT = [0.2, 0.33, 0.48, 0.64, 0.82, 1];  // the lowest step stays clear of the cream empty land
function mix(hex, t) {  // hex colour blended towards white; t = 1 keeps the colour
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return "#" + c.map(v => Math.round(255 - (255 - v) * t).toString(16).padStart(2, "0")).join("");
}
// on the second map the party may be missing (it did not run): its tints come from the main map's party
const shareColors = () => SHARE_TINT.map(t => mix(colors[shareParty] || P.colors[P.shareParty] || "#777777", t));
function shareSteps(value, f = c => c) {
  const c = shareColors().map(f);
  return ["step", value, c[0], ...SHARE_BREAKS.flatMap((b, i) => [b, c[i + 1]])];
}

// colours worked out here rather than from the tiles (reader's bloc coding, change view) go to the areas
// as feature state "c"
const ST = ["feature-state", "c"];
const byState = fallback => ["case", ["==", ["typeof", ST], "string"], ["to-color", ST], fallback];

function colorExpr(b, l, k, f = c => c) {
  const grey = meta.states.built_empty || "#bdb9b0";
  const isArea = b === "b";
  if (mode === "change") return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["==", ["get", b], "no_station"], meta.states.no_station,
    isArea ? byState("#e4e4e1") : ["to-color", ["coalesce", ["get", "_chg"], NO_CMP]]];
  if (mode === "share") return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["==", ["get", b], "no_station"], meta.states.no_station,
    // areas take their share from areas.json (feature state); dots carry it as pct_<letters>
    isArea ? ["case", ["==", ["typeof", ["feature-state", "v"]], "number"], shareSteps(["feature-state", "v"], f), "#e4e4e1"]
      : shareSteps(["coalesce", ["get", "pct_" + shareParty], 0], f)];
  const own = isArea ? byState : x => x;
  if (mode === "bloc") return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    own(["match", ["coalesce", ["get", k], ""], ...twoBlocStops(f), "#999999"])];
  return ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
    ["==", ["get", b], "no_station"], meta.states.no_station,
    own(["case", ["==", ["get", b], "none"], f(meta.states.none),
      ["match", ["coalesce", ["get", l], ""], ...Object.entries(colors).flatMap(([x, c]) => [x, f(c)]), "#999999"]])];
}
// one area's colour worked out here, in the current election (bind): reader's coding or change view
function stateColor(i) {
  const r = A.areas[i];
  if (mode === "change") { const c = changeOfArea(cur, i); return changeColor(c && c.d); }
  const c = classify(cur, rowGet(cur, r));
  if (mode === "bloc") {
    if (c.bloc2 === "arab") return meta.states.arab_majority || "#22b573";
    if (c.bloc2 === "none") return meta.states.none;
    const [b, lv] = c.bloc2.split("|");
    return lv === "strong" ? blocColor[b] : (meta.blocs_light || {})[b] || blocColor[b];
  }
  return c.bloc === "none" ? meta.states.none : colors[c.leader] || "#999999";
}
// which colours the areas need from here: null when the tiles' own classes are right
const stateWant = () => mode === "change" ? `change|${FROM}|${measureKey()}|${codingParam()}|${F && F.A ? 1 : 0}`
  : cur.custom && mode !== "share" ? `${mode}|${codingParam()}` : null;
function applyStates() {
  if (!A || !map || !map.getSource("areas")) return;
  const want = stateWant();
  if (cur.cFor === want) return;
  A.areas.forEach((r, i) => { if (r[8]) map.setFeatureState({ ...FS, id: i }, { c: want ? stateColor(i) : null }); });
  cur.cFor = want;
}
// rough shapes are GeoJSON: their own properties are rewritten (coding) and given a change colour
function paintDots() {
  if (!map || !map.getSource("dots")) return;
  const want = `${codingParam()}|${mode === "change" ? `${FROM}|${measureKey()}|${F && F.A ? 1 : 0}` : ""}`;
  if (cur.dotsFor === want) return;
  for (const f of DOTS.features) {
    const p = f.properties;
    p._orig ||= { bloc: p.bloc, leader: p.leader, second: p.second, bloc2: p.bloc2 };
    Object.assign(p, p._orig);
    if (cur.custom) {
      const c = classify(cur, propGet(p));
      Object.assign(p, { bloc: c.bloc, leader: c.leader, second: c.second, bloc2: c.bloc2 });
    }
    if (mode === "change") p._chg = changeColor(changeOfDot(p).d); else delete p._chg;
  }
  map.getSource("dots").setData(DOTS);
  cur.dotsFor = want;
}
// stripes: from the tiles, or under the reader's coding by area id
function applyHatch() {
  if (!map || !map.getLayer("hatch")) return;
  map.setLayoutProperty("hatch", "visibility", mode === "party" ? "visible" : "none");
  if (mode !== "party") return;
  const want = cur.custom ? codingParam() + (A ? "|a" : "") : "";
  if (cur.hatchFor === want) return;
  cur.hatchFor = want;
  if (!cur.custom) {
    map.setFilter("hatch", ["has", "s"]);
    map.setPaintProperty("hatch", "fill-pattern", ["concat", "h-", ["get", "l"], "-", ["get", "s"]]);
    return;
  }
  const groups = {};
  if (A) A.areas.forEach((r, i) => {
    if (!r[8]) return;
    const c = classify(cur, rowGet(cur, r));
    if (c.second) (groups[`h-${c.leader}-${c.second}`] ||= []).push(i);
  });
  const ids = Object.values(groups).flat();
  if (!ids.length) { map.setFilter("hatch", ["==", ["get", "c"], -1]); return; }
  map.setFilter("hatch", ["in", ["id"], ["literal", ids]]);
  map.setPaintProperty("hatch", "fill-pattern",
    ["match", ["id"], ...Object.entries(groups).flatMap(([img, list]) => [list, img]), Object.keys(groups)[0]]);
}
// areas with no station of their own show their nearest area's result in the same plain colour (Ben,
// 30 Oct: no marking, keep the map clean); the hover panel says so
const areaColor = () => colorExpr("b", "l", "k");

let showNames = true;
function setNames(on) {
  showNames = on;
  try { localStorage.setItem("town-names", on ? "on" : "off"); } catch (e) { /* private window */ }
  $("names").checked = on;
  for (const id of ["labels", "feature-labels"])
    if (map && map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function setMode(m) {
  mode = m;
  try { localStorage.setItem("colour-mode", m); } catch (e) { /* private window */ }
  for (const btn of $("modes").querySelectorAll("button")) btn.setAttribute("aria-pressed", btn.dataset.mode === m);
  $("party-pick").hidden = m !== "share";
  $("change-pick").hidden = m !== "change";
  if (m === "change") ensureFrom();
  if (!$("intro").dataset.party) $("intro").dataset.party = $("intro").innerHTML;
  $("intro").innerHTML = m === "change"
    ? tr(`How much a bloc's or a party's share of valid votes rose or fell in each area since an earlier election,
       in percentage points. The areas are the same in every election. <a href="about.html">How this works</a>.`,
       `בכמה עלה או ירד שיעור הקולות הכשרים של גוש או של מפלגה בכל אזור מאז בחירות קודמות, בנקודות אחוז.
       האזורים זהים בכל הבחירות. <a href="about-he.html">איך זה עובד</a>.`)
    : m === "bloc"
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
  refreshInfo();
}

function setShareParty(l) {
  shareParty = P.shareParty = l;
  if (C) C.shareParty = (findParty(partySlug(l), C.meta) || {}).letters || null;
  $("party").value = l;
  legend();
  syncURL();
  repaint();
  refreshInfo();
}

// the selected party's share in every area, as feature state (the tiles carry only the leader)
function applyShares() {
  if (mode !== "share" || !A || !map || !map.getSource("areas") || cur.statesFor === shareParty) return;
  const k = A.parties.indexOf(shareParty);
  A.areas.forEach((r, i) => { if (r[8]) map.setFeatureState({ ...FS, id: i }, { v: k < 0 ? 0 : r[8][k] }); });
  cur.statesFor = shareParty;
}

function repaintMap() {
  if (!map || !map.getLayer("fill")) return;
  applyShares();
  applyStates();
  paintDots();
  map.setPaintProperty("fill", "fill-color", areaColor());
  map.setPaintProperty("dots-fill", "fill-color", colorExpr("bloc", "leader", "bloc2"));
  map.setPaintProperty("dots", "circle-color", colorExpr("bloc", "leader", "bloc2"));
  applyHatch();
}
// both maps
function repaint() {
  for (const E of [P, C]) if (E && E.map) inCtx(E, repaintMap);
}

// ---------- change view controls ----------
// the earlier election: from the address, else the one before this (or after, for the first)
function defaultFrom() {
  const k = YEARS.indexOf(year);
  return YEARS[k - 1] || YEARS[k + 1] || null;
}
function ensureFrom() {
  if (!FROM || FROM === year || !YEARS.includes(FROM)) FROM = defaultFrom();
  if ($("from") && FROM) $("from").value = FROM;
  if (!FROM || (F && F.year === FROM)) return;
  const want = FROM;
  loadCtx(want).then(E => {
    if (FROM !== want) return;
    F = E; recode(F);
    measureOptions();
    codingPanel();
    legend(); repaint(); refreshInfo(); syncURL();
  }).catch(e => console.error(e));
}
function fromOptions() {
  $("from").innerHTML = [...YEARS].reverse().filter(y => y !== year)
    .map(y => `<option value="${y}">${yearLabel(y)}</option>`).join("");
  if (FROM) $("from").value = FROM;
}
// blocs first, then the parties that ran in both elections
function measureOptions() {
  const sides = ["right", "left", "arab"].map(s => `<option value="side:${s}">${blocName(P.sideBloc[s])}</option>`).join("");
  const both = F ? meta.parties.filter(p => findParty(partySlug(p.letters), F.meta)) : [];
  if (MEASURE.party && F && !findParty(MEASURE.party, F.meta)) MEASURE = { side: "right" };
  $("measure").innerHTML = `<optgroup label="${tr("Blocs", "גושים")}">${sides}</optgroup>` + (both.length
    ? `<optgroup label="${tr("Parties", "מפלגות")}">${both.map(p =>
      `<option value="party:${partySlug(p.letters)}">${esc(label(p.letters))}</option>`).join("")}</optgroup>` : "");
  $("measure").value = measureKey();
}
function setFrom(y) { FROM = y; ensureFrom(); syncURL(); }
function setMeasure(v) {
  const [k, x] = v.split(":");
  MEASURE = k === "side" ? { side: x } : { party: x };
  legend(); repaint(); refreshInfo(); syncURL();
}

// ---------- bloc coding panel ----------
// every list in the elections on screen, once each; a select moves it to another side
function codingRows() {
  const rows = new Map();
  for (const E of [P, ...(mode === "change" && F ? [F] : []), ...(C ? [C] : [])]) for (const p of E.meta.parties) {
    const k = codingKey(p);
    if (!rows.has(k)) rows.set(k, { k, E, p, def: sideOfBloc(E, p.bloc0), years: [] });
    rows.get(k).years.push(E.year);
  }
  return [...rows.values()];
}
function codingPanel() {
  const box = $("coding-box");
  if (!box || !P) return;
  const changed = Object.keys(CODING).length > 0;
  const sideName = s => s === "none" ? tr("Neither bloc", "אף גוש") : blocName(P.sideBloc[s]);
  $("coding-sum").innerHTML = tr("Bloc coding", "שיוך הרשימות לגושים")
    + (changed ? ` <span class="muted">${tr("(changed)", "(שונה)")}</span>` : "");
  $("coding").innerHTML = codingRows().map(({ k, E, p, def, years }) => {
    const v = CODING[k] || def;
    const yrs = years.includes(P.year) ? "" : ` <span class="muted">${years.map(yearLabel).join(", ")}</span>`;
    return `<tr><td>${esc(HE ? p.hebrew : p.english)}${yrs}</td><td class="n"><select data-k="${esc(k)}" data-def="${def}"
      aria-label="${esc(HE ? p.hebrew : p.english)}">${SIDES.map(s =>
      `<option value="${s}"${s === v ? " selected" : ""}>${sideName(s)}${s === def ? " *" : ""}</option>`).join("")}</select></td></tr>`;
  }).join("");
  $("coding-reset").hidden = !changed;
}
function setCoding(k, side, def) {
  if (k == null) for (const x of Object.keys(CODING)) delete CODING[x];
  else if (side === def) delete CODING[k]; else CODING[k] = side;
  for (const E of new Set([P, F, C, ...Object.values(DONE)])) if (E) recode(E);
  bind(P);
  codingPanel();
  if (mode === "change") measureOptions();
  legend(); envelopes(); repaint(); refreshInfo(); syncURL();
}
const DONE = {};  // elections loaded so far, to recode when the coding changes

function setPlace(p) { place = p; syncURL(); }

// the info panel's starting hint (index.html), kept before the page switches language
const INFO_HINT_EN = $("info-body").innerHTML;
// unpin: no place in the address, no highlight, the panel back to its hint
function clearSelection() {
  setPlace(null);
  if (map) setHover(null);
  if (map) townHL(-1);
  $("info-body").innerHTML = tr(INFO_HINT_EN, $("info-body").dataset.he);
  $("info-body").classList.add("sub");
  $("info").classList.add("empty");
  if (document.body.classList.contains("info-open")) foldSide(false);
  document.body.classList.remove("info-open");
  infoFn = null;
  $("town").value = "";
}

function foldSide(on) {
  document.body.classList.toggle("side-folded", on);
  $("side-toggle").setAttribute("aria-expanded", String(!on));
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
  YEARS = years;
  year = years.includes(asked) ? asked : years[years.length - 1];
  const base = `data/${year}/`;

  // this election's blocs, its two camps (the Arab parties and uncommitted parties belong to neither)
  // and the reader's coding: all in P (newCtx), the shared names point at it
  P = newCtx(year, await getJSON(base + "meta.json"));
  bind(P);
  // a link's own view wins over this browser's last one
  let saved = null;
  try { saved = localStorage.getItem("colour-mode"); } catch (e) { /* private window */ }
  mode = MODES.includes(Q.get("view")) ? Q.get("view") : !SHARED && MODES.includes(saved) ? saved : "party";
  const askedParty = findParty(Q.get("party"));
  shareParty = P.shareParty = askedParty ? askedParty.letters : meta.parties[0].letters;
  // change view: since which election, and of what (a side, or with party= one list)
  FROM = Q.get("from");
  MEASURE = ["right", "left", "arab"].includes(Q.get("side")) ? { side: Q.get("side") }
    : mode === "change" && askedParty ? { party: partySlug(askedParty.letters) } : { side: "right" };
  fromOptions();
  $("from").addEventListener("change", e => setFrom(e.target.value));
  $("measure").addEventListener("change", e => setMeasure(e.target.value));
  measureOptions();
  // second map
  $("compare").innerHTML = `<option value="">${tr("None", "ללא")}</option>` + [...years].reverse().filter(y => y !== year)
    .map(y => `<option value="${y}">${yearLabel(y)}</option>`).join("");
  $("compare").addEventListener("change", e => setCompare(e.target.value || null));
  // bloc coding
  codingPanel();
  $("coding").addEventListener("change", e => {
    const s = e.target.closest("select[data-k]");
    if (s) setCoding(s.dataset.k, s.value, s.dataset.def);
  });
  $("coding-reset").addEventListener("click", () => setCoding(null));
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
    .then(([d]) => { setAreas(P, d); bind(P); buildSearch(); repaint(); topPlaces(); refreshInfo(); });
  const dotsReady = getJSON(base + "dots.geojson").then(d => { P.DOTS = d; bind(P); });

  applyLanguage();
  heading();
  document.title = tr(`Extremely Detailed Israeli Elections: ${yearLabel(meta.year)}`,
    `בחירות ישראל ברזולוציה מלאה: ${yearLabel(meta.year)}`);
  yearButtons(years, year);
  setMode(mode);
  envelopes();
  try { await dotsReady; } catch (e) { console.error(e); }
  initMap(P, "map");
  const askedCompare = Q.get("compare");
  if (askedCompare && askedCompare !== year && years.includes(askedCompare)) setCompare(askedCompare);
  try { await areasReady; } catch (e) { console.error(e); }
  restorePlace();
}

// ---------- two maps side by side: the second election's tiles in #map2, moving with the first ----------
let syncing = false;
function follow(from, to) {
  from.on("move", () => {
    if (syncing || (to !== P.map && (!C || C.map !== to))) return;  // a closed second map stays out
    syncing = true;
    to.jumpTo({ center: from.getCenter(), zoom: from.getZoom() });
    syncing = false;
  });
}
async function setCompare(y) {
  if (C && C.map) { C.map.remove(); C.map = null; }
  C = null;
  document.body.classList.toggle("compare", !!y);
  $("compare").value = y || "";
  $("map-tag1").textContent = y ? yearLabel(year) : "";
  $("map-tag2").textContent = y ? yearLabel(y) : "";
  P.map.resize();
  if (y && isPhone()) foldSide(true);  // phones: the maps are stacked, the first under the menu
  syncURL();
  if (!y) { codingPanel(); legend(); refreshInfo(); return; }
  let E;
  try { E = await loadCtx(y); } catch (e) { console.error(e); return; }
  if ($("compare").value !== y) return;  // changed again while loading
  C = E; recode(C);
  C.shareParty = (findParty(partySlug(P.shareParty), C.meta) || {}).letters || null;
  C.cFor = C.hatchFor = C.dotsFor = C.statesFor = null;
  initMap(C, "map2");
  codingPanel(); legend(); refreshInfo(); syncURL();
}

// the panel heading names the election ("Knesset election, 27 October 2026"); the Knesset and any
// note on the count go below it (meta.subtitle: "26th Knesset, 27 October 2026 · provisional results ...")
function heading() {
  const sub = HE ? (meta.subtitle_he || meta.subtitle) : meta.subtitle;
  const [first, ...rest] = sub.split(" · ");
  const cut = first.indexOf(", ");
  if (cut < 0) { $("subtitle").textContent = sub; return; }
  $("title").textContent = tr(`Knesset election, ${first.slice(cut + 2)}`, `הבחירות לכנסת, ${first.slice(cut + 2)}`);
  $("subtitle").textContent = [first.slice(0, cut), ...rest].join(" · ");
}

// ?place=<locality code> (a town) or <locality code>-<statistical area> (one area)
function restorePlace() {
  if (!place || !A) return;
  if (!map.getLayer("fill")) { map.once("load", restorePlace); return; }
  const [code, stat] = place.split("-").map(Number);
  const ti = A.towns.findIndex(t => t[0] === code);
  if (ti < 0) { setPlace(null); return; }
  const i = Number.isNaN(stat) || stat == null ? -1 : A.areas.findIndex(r => r[0] === ti && r[1] === stat);
  if (i < 0) { choose(ti, !linkHadHash); return; }
  showInfo(() => recordHtml(areaRecord(i)));
  setHover(i);
  if (!linkHadHash) {
    const [w, s, e, n] = A.towns[ti][3];
    map.fitBounds([[w, s], [e, n]], { padding: padding(), maxZoom: 14, duration: 0 });
  }
}

// a party by its slug; after a change of year, the same list under its name in that election
// ("joint-list" 2021 is "The Joint List" in 2026, "labor" is "Labor-Gesher" in Sept 2019)
function findParty(asked, m = meta) {
  if (!asked) return null;
  const bare = s => s.replace(/^the-/, "");
  const a = bare(asked);
  return m.parties.find(p => slug(p.english) === asked)
    || m.parties.find(p => bare(slug(p.english)) === a)
    || m.parties.find(p => { const b = bare(slug(p.english)); return b.startsWith(a + "-") || a.startsWith(b + "-"); })
    || null;
}

// ---------- names ----------

function label(l) {
  const p = parties[l];
  if (!p) return tr("Other lists", "רשימות אחרות");
  // English name only (Ben, 31 Oct: no transliterations); Hebrew in Hebrew mode
  return HE ? p.hebrew : p.english;
}
// lists that won no seats but are shown by name (tables/parties.csv, below_threshold): said in text, not on the map
const belowNote = l => parties[l] && +parties[l].below_threshold === 1
  ? ` <span class="muted">${tr("below threshold", "מתחת לאחוז החסימה")}</span>` : "";
function swatch(c) { return `<span class="sw" style="background:${c}"></span>`; }

// ---------- side panel ----------

function yearButtons(years, year) {
  $("years").innerHTML = [...years].sort().map(y =>
    `<button type="button" data-year="${y}" aria-pressed="${y === year}" title="${yearLabel(y)}">${yearShort(y)}</button>`).join("");
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
    // ranges in their own left-to-right span, so Hebrew mode shows "5–10%", not "10%–5"
    const range = t => `<bdi dir="ltr">${t}</bdi>`;
    html += `<div class="ptitle">${esc(label(shareParty))}</div><div class="sub">${tr("Share of valid votes", "שיעור מהקולות הכשרים")}</div>`
      + c.map((col, i) => `<div class="row">${swatch(col)}${i === c.length - 1
        ? tr(`${edges[i]}% or more`, `${range(edges[i] + "%")} ומעלה`)
        : i === 0 ? tr(`Under ${edges[1]}%`, `פחות מ-${range(edges[1] + "%")}`) : range(`${edges[i]}–${edges[i + 1]}%`)}</div>`).join("");
  } else if (mode === "bloc") {
    const light = meta.blocs_light || {};
    const pname = l => esc(label(l));
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
  } else if (mode === "change") {
    const range = t => `<bdi dir="ltr">${t}</bdi>`;
    const steps = [...CHG_BREAKS].reverse();  // 20, 10, 6, 3, 1
    const rows = [
      ...steps.map((b, k) => [changeColor(b), k === 0 ? tr(`+${b} or more`, `${range("+" + b)} ומעלה`)
        : tr(`+${b} to +${steps[k - 1]}`, `${range("+" + b)} עד ${range("+" + steps[k - 1])}`)]),
      [CHG_MID, tr("Less than 1 point either way", "פחות מנקודה לכל כיוון")],
      ...CHG_BREAKS.map((b, k) => [changeColor(-b), k === CHG_BREAKS.length - 1 ? tr(`−${b} or more`, `${range("−" + b)} ומעלה`)
        : tr(`−${b} to −${CHG_BREAKS[k + 1]}`, `${range("−" + b)} עד ${range("−" + CHG_BREAKS[k + 1])}`)]),
      [NO_CMP, tr("No result in one of the two elections", "אין תוצאה באחת משתי הבחירות")]];
    html += `<div class="ptitle">${tr(`Change in ${measureName()}`, `שינוי ב${measureName()}`)}</div>
      <div class="sub">${FROM ? tr(`Since ${yearLabel(FROM)}, in points of valid votes`, `מאז ${yearLabel(FROM)}, בנקודות אחוז מהקולות הכשרים`) : ""}</div>`
      + rows.map(([c, t]) => `<div class="row">${swatch(c)}${t}</div>`).join("");
  } else {
    for (const b of BLOCS) {
      const ps = meta.parties.filter(p => p.bloc === b);
      html += `<h2>${blocName(b)}</h2>` + ps.map(p => `<div class="row">${swatch(colors[p.letters])}<span>${esc(label(p.letters))}${belowNote(p.letters)}</span></div>`).join("");
    }
    // the second map's lists that are not on this one (another name or colour)
    if (C) {
      const here = new Set(meta.parties.map(p => codingKey(p) + colors[p.letters]));
      const more = C.meta.parties.filter(p => !here.has(codingKey(p) + C.colors[p.letters]));
      if (more.length) html += `<h2>${tr(`Also in ${yearLabel(C.year)}`, `גם ב-${yearLabel(C.year)}`)}</h2>` + more.map(p =>
        `<div class="row">${swatch(C.colors[p.letters])}<span>${esc(HE ? p.hebrew : p.english)}</span></div>`).join("");
    }
  }
  html += `<h2>${tr("Other", "אחר")}</h2>
    ${mode === "share" || mode === "change" ? "" : `<div class="row">${swatch(meta.states.none)}${mode === "bloc" ? tr("No bloc with a majority", "אין גוש עם רוב")
      : tr("No bloc above 2/3", "אין גוש מעל שני שלישים")}</div>`}
    <div class="row">${swatch(meta.states.no_station)}${tr("Nobody lives here (no polling station)", "אין כאן תושבים (אין קלפי)")}</div>
    <div class="row">${swatch(meta.states.built_empty || "#bdb9b0")}${tr("Industry, port or campus, no residents",
      "תעשייה, נמל או קמפוס, ללא תושבים")}</div>
    <div class="row">${swatch(meta.states.park || "#cfe1b0")}${tr("Park", "פארק")}</div>
    <div class="row">${swatch(meta.states.beach || "#f0e8d4")}${tr("Beach", "חוף")}</div>`;
  lg.innerHTML = html;
  topPlaces();
}

// ---------- one-party view: the places where the party did best ----------

const TOP_N = 25, TOP_MIN_VALID = 1000;
// every locality's valid votes and the chosen party's share: the official town total where there is one,
// else the sum of its areas with stations of their own; localities without a CBS boundary from their dot
function placeShares(k) {
  const sums = new Map();
  for (const r of A.areas) {
    if (!r[8] || r[10] != null) continue;
    const s = sums.get(r[0]) || [0, 0];
    s[0] += r[2]; s[1] += r[2] * (k < 0 ? 0 : r[8][k]) / 100;
    sums.set(r[0], s);
  }
  const dots = new Map(DOTS.features.map(f => [+f.properties.SEMEL_YISHUV, f.properties]));
  const out = [];
  A.towns.forEach((t, ti) => {
    let valid = 0, share = 0;
    if (t[5] === "area") {
      if (t[6]) { valid = t[6][0]; share = k < 0 ? 0 : t[6][2][k]; }
      else if (sums.has(ti)) { const [v, n] = sums.get(ti); valid = v; share = v ? 100 * n / v : 0; }
    } else if (t[5] === "dot" && dots.has(t[0])) {
      const p = dots.get(t[0]);
      valid = +p.valid || 0; share = +(p["pct_" + shareParty] || 0);
    }
    if (valid >= TOP_MIN_VALID) out.push([ti, share, valid]);
  });
  return out.sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, TOP_N);
}

function topPlaces() {
  const box = $("top");
  if (!box) return;
  if (mode !== "share" || !A) { box.innerHTML = ""; box.hidden = true; return; }
  const rows = placeShares(A.parties.indexOf(shareParty));
  box.hidden = false;
  box.innerHTML = `<h2>${tr("Top places", "המקומות המובילים")}</h2>
    <div class="sub">${tr(`Highest share for ${esc(label(shareParty))}; places with at least ${fmt(TOP_MIN_VALID)} valid votes`,
      `השיעור הגבוה ביותר ל${esc(label(shareParty))}; מקומות עם ${fmt(TOP_MIN_VALID)} קולות כשרים לפחות`)}</div>
    <table>${rows.map(([ti, share], n) => {
      const t = A.towns[ti];
      return `<tr><td class="rank">${n + 1}</td><td><button type="button" class="linkbtn" data-ti="${ti}">${
        esc(HE ? t[1] : (t[2] || t[1]))}</button></td><td class="n">${pctFmt(share)}</td></tr>`;
    }).join("")}</table>`;
}

function envelopes() {
  const n = meta.notes, env = n.double_envelope;
  const blocTotals = Object.fromEntries(BLOCS.map(b => [b, meta.parties.filter(p => p.bloc === b)
    .reduce((s, p) => s + (env.by_party[p.letters] || 0), 0)]));
  const byParty = [...meta.parties].sort((a, b) => (env.by_party[b.letters] || 0) - (env.by_party[a.letters] || 0));
  const offMap = `<div class="sub" style="margin-top:6px">${tr(`Also off the map: ${fmt(n.unplaced.valid)} votes from stations
      that could not be placed in a statistical area. Town totals include them.`, `גם מחוץ למפה: ${fmt(n.unplaced.valid)} קולות מקלפיות שלא ניתן היה
      לשייך לאזור סטטיסטי. הסיכומים ליישוב כוללים אותם.`)}</div>`;
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
      <b>${fmt(env.valid)}</b>, ${pctFmt(100 * env.valid / n.total_valid)} of ${fmt(n.total_valid)} valid votes.
      They are in no area's or town's result.`,
      `לקולות המעטפות הכפולות (חיילים, בתי חולים, בתי סוהר, נציגויות) אין מיקום:
      <b>${fmt(env.valid)}</b>, ${pctFmt(100 * env.valid / n.total_valid)} מתוך ${fmt(n.total_valid)} קולות כשרים.
      הם אינם בתוצאה של אף אזור או יישוב.`)}</div>
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
  return { ti: r[0], code: t[0], name: t[2] || t[1], he: t[1], stat: r[1], nb: nb ? nb[HE ? 1 : 0] : "", valid: r[2], stations: r[3], approx: r[4],
    bloc: r[5], leader: r[6], shares: sharesFromArray(r[8]), other: r[9] || 0, kind: t[5],
    estFrom: r[10], estVotes: r[11], population: r[12], placeholder: r[13], grey: r[14] === 1, bloc2: r[15],
    popGroup: r[16], nbrStations: r[17] || 0, streetStations: r[18] || 0, i,
    // under the reader's coding the classes are worked out again from the shares
    ...(cur.custom && r[8] ? classify(cur, rowGet(cur, r)) : {}) };
}

function dotRecord(p) {
  const shares = Object.keys(p).filter(k => k.startsWith("pct_") && k !== "pct_other").map(k => [k.slice(4), +p[k]]);
  return { code: +p.SEMEL_YISHUV, name: p.SHEM_YISHUV_ENGLISH || p.SHEM_YISHUV, he: p.SHEM_YISHUV, valid: +p.valid, stations: +p.stations,
    approx: +p.approx_stations, bloc: p.bloc, leader: p.leader, shares, other: +(p.pct_other || 0), kind: "dot", shape: p.shape_source, bloc2: p.bloc2,
    props: p };
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

function resultsHtml(rec, verdict, compact = false) {
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
  } else if (verdict !== TOWN_TOTAL && rec.leader && parties[rec.leader] && rec.bloc !== "none") {
    // the leading-party view: name the party whose colour fills the area
    verdict += tr(`, ${esc(label(rec.leader))} leads`, `, ${esc(label(rec.leader))} מובילה`);
  }
  const counts = rec.estFrom != null
    ? tr(`no polling station of its own${rec.population ? ` · ${fmt(rec.population)} residents (2022 census${rec.popGroup ? `, a total shared by ${rec.popGroup} areas` : ""})` : ""}`,
         `אין בו קלפי${rec.population ? ` · ${fmt(rec.population)} תושבים (מפקד 2022${rec.popGroup ? `, סכום משותף ל-${rec.popGroup} אזורים` : ""})` : ""}`)
    : tr(`${fmt(rec.valid)} valid votes · ${rec.stations} station${rec.stations === 1 ? "" : "s"}`,
         `${fmt(rec.valid)} קולות כשרים · ${rec.stations === 1 ? "קלפי אחת" : `${rec.stations} קלפיות`}`);
  let html = `<div class="sub">${verdict} · ${counts}</div>
    ${blocBar(blocShare)}
    <table>${BLOCS.map(b => `<tr><td><div class="row">${swatch(blocColor[b])}${blocName(b)}</div></td><td class="n">${pctFmt(blocShare[b])}</td></tr>`).join("")}</table>`;
  if (compact) return html;  // the second map's year under the first: blocs only
  html += `<h2>${tr("Parties", "מפלגות")}</h2><table>`;
  // one line per party: its name, the other language's name in muted text, its share
  for (const [l, v] of shares.filter(([l, v]) => v >= 0.5 || (mode === "share" && l === shareParty))) {
    const p = parties[l];
    if (!p) continue;
    html += `<tr${mode === "share" && l === shareParty ? ' class="sel"' : ""}><td><div class="row">${swatch(colors[l])}
      <span>${esc(label(l))} ${otherName(p.english, p.hebrew)}${belowNote(l)}</span></div></td>
      <td class="n">${pctFmt(v)}</td></tr>`;
  }
  return html + `<tr><td>${tr("Other lists", "רשימות אחרות")}</td><td class="n">${pctFmt(rec.other)}</td></tr></table>`;
}

// link to the town's own page, when it has one
const pageLink = code => PAGES[code]
  ? ` · <a href="town/${PAGES[code]}/${HE ? "he/" : ""}">${tr("Town page", "דף היישוב")}</a>` : "";

// votes of a town that could not be placed in any of its areas: official town total minus placed votes
function townSplit(ti) {
  let placed = 0, stations = 0;
  for (const r of A.areas) if (r[0] === ti && r[8] && r[10] == null) { placed += r[2]; stations += r[3]; }
  const off = A.towns[ti][6];
  return { placed, stations, official: off, unplaced: off ? Math.max(0, off[0] - placed) : 0 };
}

// the details of one area or rough shape, then the same place in the second map's election
function recordHtml(rec) { return recordMain(rec) + (C && cur === P ? compareArea(rec) : ""); }
function recordMain(rec) {
  const isDot = rec.kind === "dot";
  let html = `<h3>${esc(HE ? rec.he : rec.name)}${rec.stat ? ` <span class="sub">${rec.nb ? esc(rec.nb) + ", " : ""}${tr("area", "אזור")} ${rec.stat}</span>` : ""}</h3>
    <div class="sub">${otherName(rec.name, rec.he)}${pageLink(rec.code)}</div>`;
  if (isDot && rec.shape !== "cbs_merged") html += `<div class="sub">${dotKind(rec.he || "")}</div>`;
  if (rec.bloc === "no_station") return html + `<div class="sub">${rec.grey
    ? tr("Built up, but nobody lives here (campus, industry or offices), so no polling station.",
         "שטח בנוי, אך אין כאן תושבים (קמפוס, תעשייה או משרדים), ולכן אין קלפי.")
    : tr("No polling station in this area.", "אין קלפי באזור זה.")}</div>`;
  if (mode === "change" && cur === P) html += changeBox(isDot ? changeOfDot(rec.props) : changeOfArea(P, rec.i));
  html += resultsHtml(rec, rec.bloc === "none" ? tr("No bloc above 2/3", "אין גוש מעל שני שלישים") : blocName(rec.bloc));
  const flag = (en, he) => { html += `<div class="flag">${tr(en, he)}</div>`; };
  if (rec.placeholder) rec.placeholder === "osm"
    ? flag("CBS publishes only a point for this locality. Outline is its built-up area as mapped in OpenStreetMap, approximate.",
           "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. קו המתאר הוא השטח הבנוי כפי שממופה ב-OpenStreetMap, משוער.")
    : rec.placeholder === "buildings"
    ? flag("CBS publishes only a point for this locality. Outline drawn round its buildings (Microsoft building footprints), approximate.",
           "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. קו המתאר משורטט סביב המבנים שלו (טביעות מבנים של Microsoft), משוער.")
    : flag("CBS publishes only a point for this locality. Shape drawn round that point, approximate.",
           "הלמ״ס מפרסמת ליישוב זה נקודה בלבד. הצורה משורטטת סביב הנקודה, משוערת.");
  if (rec.estFrom === 0) flag(`None of this town's polling stations could be placed in a statistical area, so every
    populated area shows the whole town's result (${fmt(rec.estVotes)} valid votes). It says nothing about differences
    between neighbourhoods.`,
    `לא ניתן היה לשייך אף קלפי ביישוב זה לאזור סטטיסטי, ולכן כל אזור מיושב מציג את תוצאות היישוב כולו
    (${fmt(rec.estVotes)} קולות כשרים). אין בכך מידע על הבדלים בין השכונות.`);
  else if (rec.estFrom != null) flag(`Estimate: people live here but there is no polling station inside the area, so it
    shows the result of area ${rec.estFrom}, the nearest area in the same town with a station (${fmt(rec.estVotes)} valid votes).
    Its residents may in fact vote at another station.`,
    `הערכה: יש כאן תושבים אך אין קלפי בתוך האזור, ולכן מוצגות תוצאות אזור ${rec.estFrom}, האזור הקרוב ביותר
    באותו יישוב שיש בו קלפי (${fmt(rec.estVotes)} קולות כשרים). ייתכן שתושביו מצביעים בקלפי אחרת.`);
  if (rec.shape === "cbs_merged") flag("Formed after the CBS 2022 boundaries were drawn; shown as the combined boundary of the localities it replaced.",
    "הוקם אחרי ששורטטו גבולות הלמ״ס של 2022; מוצג כגבול המשותף של היישובים שאותם החליף.");
  if (rec.shape === "osm") flag("No CBS boundary: outline is the nearest matching area mapped in OpenStreetMap, approximate.",
    "אין גבול למ״ס: קו המתאר הוא השטח המתאים הקרוב ביותר ב-OpenStreetMap, משוער.");
  if (rec.shape === "buildings") flag("No CBS boundary: outline drawn round its buildings (Microsoft building footprints), approximate.",
    "אין גבול למ״ס: קו המתאר משורטט סביב המבנים שלו (טביעות מבנים של Microsoft), משוער.");
  // "circle" is the older name for the same fallback
  if (rec.shape === "point" || rec.shape === "circle") flag("No CBS boundary and no buildings found: marker at its approximate location.",
    "אין גבול למ״ס ולא נמצאו מבנים: סימון במיקום המשוער.");
  if (!isDot && rec.approx > 0) {
    const nb = rec.nbrStations, st = rec.streetStations, of = `${rec.stations} station${rec.stations > 1 ? "s" : ""}`;
    if (nb + st > 0 && nb + st <= rec.approx) {
      if (st) flag(`${st} of ${of} placed from the street name only (no house number or venue found), so ${st > 1 ? "they" : "it"} may
        belong in a neighbouring area.`, `${st} מתוך ${rec.stations} קלפיות מוקמו לפי שם הרחוב בלבד (לא נמצאו מספר בית או מקום),
        ולכן ייתכן שהן שייכות לאזור סמוך.`);
      if (nb) flag(`${nb} of ${of} had no usable address and ${nb > 1 ? "were" : "was"} placed with the nearest-numbered station
        in the same town.`, `ל-${nb} מתוך ${rec.stations} קלפיות לא הייתה כתובת שמישה, והן מוקמו לפי הקלפי בעלת המספר הסמוך באותו יישוב.`);
    } else flag(`${rec.approx} of ${of} placed approximately (from the street only, or with a nearby-numbered station).`,
      `${rec.approx} מתוך ${rec.stations} קלפיות מוקמו בקירוב (לפי הרחוב בלבד, או לפי קלפי בעלת מספר סמוך).`);
  }
  if (rec.estFrom == null && rec.valid < 100) flag("Fewer than 100 valid votes: a handful of votes can change the colour.",
    "פחות מ-100 קולות כשרים: קולות בודדים יכולים לשנות את הצבע.");
  // the rest of the town: votes that are in the town total but in no area
  if (!isDot && rec.estFrom !== 0 && rec.ti != null && A.towns[rec.ti][6]) {
    const sp = townSplit(rec.ti);
    if (sp.unplaced >= Math.max(50, 0.01 * sp.official[0])) flag(`${fmt(sp.unplaced)} of this town's ${fmt(sp.official[0])} valid votes
      could not be placed in an area and are in no area's result; the town total includes them.`,
      `${fmt(sp.unplaced)} מתוך ${fmt(sp.official[0])} הקולות הכשרים ביישוב לא שויכו לאזור ואינם בתוצאה של אף אזור; סה״כ היישוב כולל אותם.`);
  }
  return html;
}

// a town's whole result in the current election (bind): the official total, else its areas; null without votes
function townRec(ti) {
  const sp = townSplit(ti);
  let rec;
  if (sp.official) {  // the official whole-town result, placed in areas or not
    const [valid, boxes, pct, other] = sp.official;
    rec = { valid, stations: boxes, other, shares: A.parties.map((l, k) => [l, pct[k]]) };
  } else {  // no official total in this build: the areas with stations of their own
    let valid = 0, other = 0;
    const votes = Object.fromEntries(A.parties.map(l => [l, 0]));
    for (const r of A.areas) {
      if (r[0] !== ti || !r[8] || r[10] != null) continue;
      valid += r[2];
      A.parties.forEach((l, k) => { votes[l] += r[8][k] * r[2] / 100; });
      other += (r[9] || 0) * r[2] / 100;
    }
    if (!valid) return null;
    rec = { valid, stations: sp.stations, other: 100 * other / valid, shares: A.parties.map(l => [l, 100 * votes[l] / valid]) };
  }
  return rec;
}
function townHtml(ti) {
  const t = A.towns[ti];
  const nAreas = A.areas.reduce((n, r) => n + (r[0] === ti), 0);
  const sp = townSplit(ti);
  let html = `<h3>${esc(HE ? t[1] : (t[2] || t[1]))}</h3><div class="sub">${otherName(t[2] || "", t[1])}${pageLink(t[0])}</div>
    <div class="sub">${tr(`Whole town: ${nAreas} statistical area${nAreas === 1 ? "" : "s"}. Hover an area for its own result.`,
      `כל היישוב: ${nAreas === 1 ? "אזור סטטיסטי אחד" : `${nAreas} אזורים סטטיסטיים`}. ריחוף מעל אזור מציג את התוצאה שלו.`)}</div>`;
  const rec = townRec(ti);
  if (!rec) return html;
  if (mode === "change") {
    const now = measureIn(P, l => (rec.shares.find(x => x[0] === l) || [0, 0])[1]);
    const fi = F && F.A ? F.A.towns.findIndex(x => x[0] === t[0]) : -1;
    const fr = fi >= 0 ? inCtx(F, () => townRec(fi)) : null;
    const then = fr ? measureIn(F, l => (fr.shares.find(x => x[0] === l) || [0, 0])[1]) : null;
    html += changeBox({ now, then, d: now != null && then != null ? now - then : null });
  }
  html += resultsHtml(rec, TOWN_TOTAL);
  if (sp.official && sp.unplaced > 0) html += `<div class="flag">${sp.placed === 0
    ? tr(`None of the town's ${fmt(sp.unplaced)} votes could be placed in an area, so every populated area on the map
      shows this whole-town result.`, `אף אחד מ-${fmt(sp.unplaced)} הקולות ביישוב לא שויך לאזור, ולכן כל אזור מיושב במפה
      מציג את תוצאת היישוב כולו.`)
    : tr(`${fmt(sp.unplaced)} votes could not be placed in an area: they are in this total but in no area's result.`,
      `${fmt(sp.unplaced)} קולות לא שויכו לאזור: הם כלולים בסה״כ זה אך לא בתוצאה של אף אזור.`)}</div>`;
  if (C && C.A) {  // the same town in the second map's election
    const ci = C.A.towns.findIndex(x => x[0] === t[0]);
    html += `<h2 class="cmp-h">${yearLabel(C.year)}</h2>` + (ci < 0 ? `<div class="sub">${tr("No result.", "אין תוצאה.")}</div>`
      : inCtx(C, () => { const r = townRec(ci); return r ? resultsHtml(r, TOWN_TOTAL, true) : `<div class="sub">${tr("No result.", "אין תוצאה.")}</div>`; }));
  }
  return html;
}

// change view: the measure in both elections and the difference
function changeBox(c) {
  if (!c) return "";
  const pts = d => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${(Math.round(Math.abs(d) * 10) / 10).toFixed(1)}`;
  return `<div class="chg"><div class="row">${swatch(changeColor(c.d))}<b>${tr(`Change in ${measureName()}`, `שינוי ב${measureName()}`)}</b></div>
    <table><tr><td>${yearLabel(FROM)}</td><td class="n">${c.then == null ? tr("no result", "אין תוצאה") : pctFmt(c.then)}</td></tr>
    <tr><td>${yearLabel(year)}</td><td class="n">${c.now == null ? tr("no result", "אין תוצאה") : pctFmt(c.now)}</td></tr>
    <tr><td>${tr("Change, in points", "שינוי, בנקודות אחוז")}</td><td class="n"><b>${c.d == null ? "–" : `<bdi dir="ltr">${pts(c.d)}</bdi>`}</b></td></tr></table></div>`;
}
// the second map's election for the place under the pointer: blocs only
function compareArea(rec) {
  if (!C.A) return "";
  let body;
  if (rec.kind === "dot") {
    const f = C.DOTS.features.find(x => +x.properties.SEMEL_YISHUV === rec.code);
    body = f ? inCtx(C, () => { const r = dotRecord(f.properties); return resultsHtml(r, r.bloc === "none"
      ? tr("No bloc above 2/3", "אין גוש מעל שני שלישים") : blocName(r.bloc), true); }) : null;
  } else {
    const j = C.keyIdx.get(keyOf(A, A.areas[rec.i]));
    body = j == null ? null : inCtx(C, () => {
      const r = areaRecord(j);
      return r.bloc === "no_station" ? null : resultsHtml(r, r.bloc === "none"
        ? tr("No bloc above 2/3", "אין גוש מעל שני שלישים") : blocName(r.bloc), true);
    });
  }
  return `<h2 class="cmp-h">${yearLabel(C.year)}</h2>` + (body || `<div class="sub">${tr("No polling station in this area.", "אין קלפי באזור זה.")}</div>`);
}

// the panel remembers how it was made, so a change of view or party redraws it (technical review M1)
let infoFn = null;
function showInfo(make) {
  infoFn = typeof make === "function" ? make : null;
  $("info-body").innerHTML = infoFn ? infoFn() : make;
  $("info-body").classList.remove("sub");
  $("info").classList.remove("empty");
  if (isPhone() && !document.body.classList.contains("info-open")) foldSide(true);  // room for the map
  document.body.classList.add("info-open");
}
function refreshInfo() {
  if (infoFn && A && !$("info").classList.contains("empty")) $("info-body").innerHTML = infoFn();
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
  const two = document.body.classList.contains("compare");
  if (isPhone()) {
    // side by side on a phone: the maps are stacked, the first one is half the height
    const h = (P && P.map ? P.map.getCanvas().clientHeight : innerHeight) || innerHeight;
    return { top: Math.min($("side").offsetHeight + 16, two ? h * 0.4 : h), bottom: 16, left: 16, right: 16 };
  }
  // side by side: the side panel covers the first map only (on the right in Hebrew), the details the second
  if (two) return HE ? { top: 24, bottom: 24, left: 24, right: $("side").offsetWidth + 40 }
    : { top: 24, bottom: 24, left: $("side").offsetWidth + 40, right: 24 };
  return { top: 24, bottom: 24, left: $("side").offsetWidth + 40, right: $("info").offsetWidth + 40 };
}

const FIRST_VIEW = [[34.35, 31.15], [35.75, 33.1]];

// one map per election on screen: the main one in #map (it keeps the address's #zoom/lat/lng), the second
// in #map2, which follows it
let protocolAdded = false;
function initMap(E, container) { inCtx(E, () => makeMap(E, container)); }
function makeMap(E, container) {
  const base = E.base, main = E === P;
  // PREVIEW (scripts/build_preview.py, for hosts that can't serve tiles): plain GeoJSON instead
  if (!PREVIEW && !protocolAdded) { maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile); protocolAdded = true; }
  // Hebrew labels need right-to-left shaping; the plugin ships with the site
  if (maplibregl.getRTLTextPluginStatus() === "unavailable")
    maplibregl.setRTLTextPlugin(new URL("vendor/mapbox-gl-rtl-text-0.2.3.js", location.href).href, true);
  const tiles = new URL(base + "areas.pmtiles", location.href).href;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  // inside the frame: today's grey, or with a surround (previews) the sea fills it and the neighbours sit on top
  const SURROUND = meta.frame && meta.surround && meta.surround !== "plain" ? meta.surround : null;
  const bgColor = () => SURROUND ? (meta.states.water || "#c6dcea") : (css("--map-bg") || "#e6e6e3");
  const mapBg = bgColor();

  map = E.map = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, glyphs: new URL("fonts/", location.href).href + `{fontstack}/{range}.${PREVIEW ? "woff" : "pbf"}`,
      layers: [{ id: "bg", type: "background", paint: { "background-color": mapBg } }] },
    // first view: the populated band from Nahariya to Beersheba; Eilat is a scroll away (style review, item 6)
    ...(main ? { bounds: FIRST_VIEW, fitBoundsOptions: { padding: padding() } }
      : { center: P.map.getCenter(), zoom: P.map.getZoom() }),
    // with a frame, panning stops a little past it (more to the sides, where the panels sit)
    maxBounds: meta.frame ? [[meta.frame[0] - 2.5, meta.frame[1] - 0.6], [meta.frame[2] + 2.5, meta.frame[3] + 0.6]] : undefined,
    hash: main, attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 16, minZoom: 4,
  });
  // sea and large water follow the page theme, also when it changes after load
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => inCtx(E, () => {
    if (!map || !map.getLayer("bg")) return;  // the style may still be loading (or the map was closed)
    map.setPaintProperty("bg", "background-color", bgColor());
    if (map.getLayer("nb-land")) {
      map.setPaintProperty("nb-land", "fill-color", css(SURROUND === "quiet" ? "--map-bg" : "--nb-land"));
      map.setPaintProperty("nb-border", "line-color", css("--nb-line"));
      for (const id of ["nb-country", "nb-city"]) if (map.getLayer(id)) {
        map.setPaintProperty(id, "text-color", css("--nb-text"));
        map.setPaintProperty(id, "text-halo-color", css("--nb-land"));
      }
      if (map.getLayer("nb-road")) map.setPaintProperty("nb-road", "line-color", css("--nb-road"));
    }
  }));
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // the two maps move together
  if (!main) { follow(P.map, map); follow(map, P.map); }
  map.on("error", e => console.error(e.error || e));
  if (!main) {
    map.on("load", () => inCtx(E, () => { addLayers(E); repaintMap(); }));
    return;
  }
  // controls in the corner the panels leave free: bottom-left in Hebrew, where the side panel is on the right
  const corner = HE ? "bottom-left" : "bottom-right";
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), corner);
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution:
    tr('<a href="sources.html">CEC, CBS and others</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      '<a href="sources-he.html">ועדת הבחירות, הלמ״ס ואחרים</a> · © <a href="https://www.openstreetmap.org/copyright">תורמי OpenStreetMap</a>') }), corner);
  // start the credits folded on phones; one tap opens them
  if (isPhone()) map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));

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

  map.once("idle", () => status(""));
  map.on("load", () => inCtx(E, () => { addLayers(E); repaintMap(); }));
}

function addLayers(E) {
    const base = E.base, main = E === P;
    const tiles = new URL(base + "areas.pmtiles", location.href).href;
    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const SURROUND = meta.frame && meta.surround && meta.surround !== "plain" ? meta.surround : null;
    // stripes for any two lists, since the reader's coding can put any two in one bloc
    const ls = meta.parties.map(p => p.letters);
    for (const a of ls) for (const c of ls) if (a !== c) map.addImage(`h-${a}-${c}`, hatch(colors[a], colors[c]));
    // the sea near Israel and the Sea of Galilee in water blue (scripts/land_features.py); the land base
    // sits on top and already stops at the coast
    map.addSource("water", { type: "geojson", data: "data/water.geojson" });
    map.addLayer({ id: "water", type: "fill", source: "water", paint: { "fill-color": meta.states.water || "#c6dcea" } });
    // with a surround (previews) the neighbours sit over that sea, so their own coast wins near Aqaba and Taba
    if (SURROUND) {
      // the neighbours (Natural Earth): muted land, their borders, and with "relief" a gentle hillshade
      map.addSource("surround", { type: "geojson", data: "data/surround.geojson" });
      map.addLayer({ id: "nb-land", type: "fill", source: "surround", filter: ["==", ["get", "k"], "land"],
        paint: { "fill-color": css(SURROUND === "quiet" ? "--map-bg" : "--nb-land") } });
      if (SURROUND === "relief") {
        const [w, s, e, n] = meta.frame;
        map.addSource("hillshade", { type: "image", url: "data/hillshade.png", coordinates: [[w, n], [e, n], [e, s], [w, s]] });
        map.addLayer({ id: "hillshade", type: "raster", source: "hillshade", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } });
      }
      map.addLayer({ id: "nb-road", type: "line", source: "surround", filter: ["==", ["get", "k"], "road"],
        paint: { "line-color": css("--nb-road"), "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 11, 1.4] } });
      map.addLayer({ id: "nb-border", type: "line", source: "surround", filter: ["==", ["get", "k"], "border"],
        paint: { "line-color": css("--nb-line"), "line-width": 1 } });
    }
    // one land base under everything: CBS areas plus the West Bank, gaps closed, so nothing is unclaimed
    map.addSource("land", { type: "geojson", data: "data/land.geojson" });
    map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": meta.states.no_station } });
    // parks, beaches and industry (OpenStreetMap, scripts/land_features.py): seen only where blank land leaves them clear
    map.addSource("landfeat", { type: "geojson", data: "data/land_features.geojson" });
    map.addLayer({ id: "landfeat", type: "fill", source: "landfeat", minzoom: 9, paint: { "fill-color": ["match", ["get", "t"],
      "park", meta.states.park || "#cfe1b0", "beach", meta.states.beach || "#f0e8d4", meta.states.built_empty || "#bdb9b0"] } });
    // dotted lines round the West Bank and Gaza and along the Golan's pre-1967 line (build_site.write_borders)
    map.addSource("west-bank", { type: "geojson", data: "data/borders.geojson" });

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
      paint: { "line-color": "#333", "line-width": 1 } });  // plain outline; the hover panel gives the caveat
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
      // four plain strips round the box: a world polygon with the box as a hole is cut wrongly into tiles at
      // higher zooms and covered parts of the map inside the frame
      const rect = (x0, y0, x1, y1) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon",
        coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
      map.addSource("frame", { type: "geojson", data: { type: "FeatureCollection", features: [
        rect(-179, n, 179, 85), rect(-179, -85, 179, s), rect(-179, s, w, n), rect(e, s, 179, n)] } });
      map.addSource("frame-line", { type: "geojson", data: { type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: ring } } });
      const pageBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f7f7f5";
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#5f6368";
      const fm = map;  // this election's map: the handler runs outside inCtx
      fm.once("idle", () => {  // above the labels, so nothing spills past the border
        fm.addLayer({ id: "frame", type: "fill", source: "frame", paint: { "fill-color": pageBg } });
        fm.addLayer({ id: "frame-line", type: "line", source: "frame-line", paint: { "line-color": ink, "line-width": 1.2 } });
      });
    }

    if (SURROUND) {
      const name = HE ? ["coalesce", ["get", "nh"], ["get", "n"]] : ["get", "n"];
      map.addLayer({ id: "nb-country", type: "symbol", source: "surround", filter: ["==", ["get", "k"], "country"], minzoom: 6,
        layout: { "text-field": name, "text-font": ["Noto Sans Medium"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 10, 14],
          "text-letter-spacing": 0.25, "text-padding": 2 },
        paint: { "text-color": css("--nb-text"), "text-halo-color": css("--nb-land"), "text-halo-width": 1 } });
      map.addLayer({ id: "nb-city", type: "symbol", source: "surround", filter: ["==", ["get", "k"], "city"], minzoom: 7,
        layout: { "text-field": name, "text-font": ["Noto Sans Medium"], "text-size": ["case", ["==", ["get", "cap"], 1], 12, 10.5],
          "text-anchor": "left", "text-offset": [0.5, 0], "icon-allow-overlap": false, "text-padding": 2 },
        paint: { "text-color": css("--nb-text"), "text-halo-color": css("--nb-land"), "text-halo-width": 1 } });
      map.addLayer({ id: "nb-city-dot", type: "circle", source: "surround", filter: ["==", ["get", "k"], "city"], minzoom: 7,
        paint: { "circle-radius": ["case", ["==", ["get", "cap"], 1], 3, 2], "circle-color": css("--nb-text"),
          "circle-stroke-width": ["case", ["==", ["get", "cap"], 1], 1, 0], "circle-stroke-color": css("--nb-land") } });
    }
    // names of big parks, industrial zones and airports (OpenStreetMap): small, grey, only at city zooms,
    // and below the town names, which win any collision
    map.addSource("featlabels", { type: "geojson", data: "data/feature_labels.geojson" });
    map.addLayer({ id: "feature-labels", type: "symbol", source: "featlabels", minzoom: 12,
      filter: ["any", [">=", ["zoom"], 13], [">=", ["get", "a"], 1]],  // the biggest from zoom 12, the rest from 13
      layout: { visibility: showNames ? "visible" : "none",
        "text-field": HE ? ["coalesce", ["get", "nh"], ["get", "n"]] : ["get", "n"], "text-font": ["Noto Sans Medium"],
        "text-size": 10.5, "text-max-width": 9, "text-padding": 4, "text-letter-spacing": 0.02,
        "symbol-sort-key": ["-", ["get", "a"]] },
      paint: { "text-color": "#6b6b6b", "text-halo-color": "rgba(255,255,255,0.8)", "text-halo-width": 1.2 } });
    // town names in capitals, as on the reference; bigger places win when labels collide
    map.addSource("labels", { type: "geojson", data: base + "labels.geojson" });
    map.addLayer({ id: "labels", type: "symbol", source: "labels", minzoom: 6,
      filter: ["<=", ["coalesce", ["get", "z"], 9], ["zoom"]],  // each name has its own zoom (build_site.label_minzoom)
      layout: { visibility: showNames ? "visible" : "none",
      "text-field": HE ? ["coalesce", ["get", "nh"], ["get", "n"]] : ["get", "n"], "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"],
        7, ["interpolate", ["linear"], ["get", "v"], 0, 9, 50000, 11],
        12, ["interpolate", ["linear"], ["get", "v"], 0, 11, 50000, 16]],
      "symbol-sort-key": ["-", ["get", "v"]], "text-padding": 3, "text-max-width": 12 },
      paint: { "text-color": "#2b2b2b", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.4 } });

    const m = map;  // handlers run outside inCtx: they name their own election
    m.on("mousemove", e => pick(e.point, false, E));
    m.on("click", e => pick(e.point, true, E));
    m.on("mouseout", () => { if (!pinned()) setHover(null); });
    // a place already chosen on the main map shows on the second as well
    if (!main && P.hovered != null) hoverSecond(P.hovered);
    if (!main) townHL(P.townCode ?? -1);
}

// the hovered or chosen area is outlined on both maps (always called for the main map's election)
function setHover(id) {
  if (P.hovered === id) return;
  if (P.hovered != null) P.map.setFeatureState({ ...FS, id: P.hovered }, { hover: false });
  P.hovered = hovered = id;
  if (id != null) P.map.setFeatureState({ ...FS, id }, { hover: true });
  hoverSecond(id);
}
function hoverSecond(id) {
  if (!C || !C.map || !C.A || !C.map.getSource("areas")) return;
  const j = id == null || !P.A ? null : C.keyIdx.get(keyOf(P.A, P.A.areas[id])) ?? null;
  if (C.hovered === j) return;
  if (C.hovered != null) C.map.setFeatureState({ ...FS, id: C.hovered }, { hover: false });
  C.hovered = j;
  if (j != null) C.map.setFeatureState({ ...FS, id: j }, { hover: true });
}
// the chosen town's outline, on both maps
function townHL(code) {
  P.townCode = code;
  for (const E of [P, C]) if (E && E.map && E.map.getLayer("town-hl")) E.map.setFilter("town-hl", ["==", ["get", "c"], code]);
}

// a place is pinned once it is in the address and its details can be shown
const pinned = () => place != null && A != null;

// what is under the pointer on either map; the panel always speaks for the main map's election, with the
// second map's below it
function pick(point, sticky, E = P) {
  const m = E.map;
  if (!m || !m.getLayer("fill")) return;
  const f = m.queryRenderedFeatures(point, { layers: ["dots", "dots-fill", "fill"] })
    .find(x => x.properties.b !== "no_station" || x.properties.g === 1);  // empty land: no highlight
  m.getCanvas().style.cursor = f ? "pointer" : "";
  // a pinned place (click, tap, search or link) keeps the panel and highlight; hover leaves it alone
  if (!sticky && pinned()) return;
  if (!f) { if (sticky) clearSelection(); else setHover(null); return; }
  if (sticky) townHL(-1);
  if (f.layer.id === "fill") {
    if (!A || (E !== P && !E.A)) { showInfo(`<div class="sub">${tr("Loading area details...", "טוען את פרטי האזור...")}</div>`); return; }
    const id = E === P ? f.id : P.keyIdx.get(keyOf(E.A, E.A.areas[f.id]));
    if (id == null) return;
    setHover(id);
    showInfo(() => recordHtml(areaRecord(id)));
    if (sticky) { const r = A.areas[id]; setPlace(`${A.towns[r[0]][0]}-${r[1]}`); }
  } else {
    setHover(null);
    let props = f.properties;
    if (E !== P) {  // the same locality on the main map, if it is a rough shape there too
      const own = DOTS.features.find(x => +x.properties.SEMEL_YISHUV === +props.SEMEL_YISHUV);
      if (!own) { showInfo(inCtx(E, () => `<div class="sub">${yearLabel(E.year)}</div>` + recordMain(dotRecord(props)))); return; }
      props = own.properties;
    }
    showInfo(() => recordHtml(dotRecord(props)));
    if (sticky) setPlace(String(props.SEMEL_YISHUV));
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
  // anything typed while the town list was still loading
  if (input.value.trim() && document.activeElement === input) { results = search(input.value); active = results.length ? 0 : -1; render(); }
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
      // short skeletons ("Raanana" -> "rn", "Taibe" -> "tb") match only a whole name's skeleton
      else if (k.length === 2 && n.length >= 4 && t.sk.includes(k)) s = 4;
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
      <span>${esc(HE ? he : en)}</span>${otherName(en, he)}</li>`;
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
  townHL(-1);
  if (g.areas.length === 1) {
    const i = g.areas[0];
    setPlace(`${t[0]}-${A.areas[i][1]}`);
    setHover(i);
    showInfo(() => recordHtml(areaRecord(i)));
    return;
  }
  setPlace(String(t[0]));
  setHover(null);
  showInfo(`<h3>${esc(HE ? g.he : g.en)}</h3><div class="sub">${otherName(g.en, g.he)}</div>
    <div class="sub">${esc(HE ? t[1] : t[2] || t[1])}, ${tr("areas", "אזורים")} ${g.areas.map(i => A.areas[i][1]).sort((a, b) => a - b).join(", ")}.
    ${tr("Hover an area for its own result.", "ריחוף מעל אזור מציג את התוצאה שלו.")}</div>`);
}

function choose(ti, fly = true) {
  const t = A.towns[ti], [w, s, e, n] = t[3];
  const input = $("town");
  input.value = HE ? t[1] : (t[2] || t[1]);
  $("town-list").hidden = true;
  input.setAttribute("aria-expanded", "false");
  setPlace(String(t[0]));
  if (fly) map.fitBounds([[w, s], [e, n]], { padding: padding(), maxZoom: t[5] === "dot" ? 13 : 14, duration: reduceMotion ? 0 : 900 });
  townHL(t[5] === "area" ? t[0] : -1);
  setHover(null);
  if (t[5] === "dot") {
    const f = DOTS.features.find(f => +f.properties.SEMEL_YISHUV === t[0]);
    showInfo(f ? () => recordHtml(dotRecord(f.properties)) : `<h3>${esc(HE ? t[1] : t[2])}</h3>`);
    return;
  }
  const own = A.areas.reduce((acc, r, i) => (r[0] === ti ? acc.concat(i) : acc), []);
  // a one-area town shows its area, unless some of its votes could not be placed there: then the town total
  showInfo(own.length === 1 && !townSplit(ti).unplaced ? () => recordHtml(areaRecord(own[0])) : () => townHtml(ti));
}

// ---------- page wiring ----------

document.addEventListener("keydown", e => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    $("town").focus();
  }
});
document.querySelector("#info .close").addEventListener("click", clearSelection);
// "Top places" (one-party view): a click flies to the place and shows its total
$("top").addEventListener("click", e => {
  const b = e.target.closest("button[data-ti]");
  if (b && A && map) choose(+b.dataset.ti);
});
// phones: the side panel folds to its title row, and folds itself while a place's details are open
$("side-toggle").addEventListener("click", () => foldSide(!document.body.classList.contains("side-folded")));
if (isPhone()) $("legend-box").open = false;
if (HE) $("status").textContent = $("status").dataset.he;  // before the rest of the page switches language

start().catch(e => { console.error(e); status(tr("Something went wrong loading the map.", "משהו השתבש בטעינת המפה.")); });
