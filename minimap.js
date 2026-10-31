// Small locator maps on the place pages (scripts/build_places.py): a still window onto the big map
// (web/site/map.js), drawn the same way (leading party by area, land base, water, town outlines), fitted on
// the place and with the place outlined in black as on the main map when a place is pinned.
// Loaded lazily: MapLibre and the tiles are fetched only when the box comes near the screen.
// One box per page: <figure class="minimap" data-root data-year data-bbox ...> (see build_places.minimap).
"use strict";
(function () {
  const box = document.querySelector("figure.minimap");
  if (!box || location.protocol === "file:") return;
  const D = box.dataset, ROOT = new URL(D.root || "./", location.href);
  const url = p => new URL(p, ROOT).href;
  const HE = document.documentElement.lang === "he";
  const LIBS = ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js"];
  const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  const script = src => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // the same diagonal stripes as the main map: the leader's colour with the second party's
  function hatch(a, b) {
    const s = 12, c = document.createElement("canvas"); c.width = c.height = s;
    const x = c.getContext("2d");
    x.fillStyle = a; x.fillRect(0, 0, s, s);
    x.strokeStyle = b; x.lineWidth = 3;
    for (const o of [-s, 0, s]) { x.beginPath(); x.moveTo(o, s); x.lineTo(o + s, 0); x.stroke(); }
    return x.getImageData(0, 0, s, s);
  }

  async function draw() {
    const year = D.year, base = url(`data/${year}/`);
    const [meta, dots] = await Promise.all([getJSON(base + "meta.json"), getJSON(base + "dots.geojson"),
      ...(window.maplibregl ? [] : LIBS.map(script))]);
    const S = meta.states, colors = meta.colors;
    if (!maplibregl.__pmtiles) { maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile); maplibregl.__pmtiles = 1; }
    if (HE && maplibregl.getRTLTextPluginStatus() === "unavailable")
      maplibregl.setRTLTextPlugin(url("vendor/mapbox-gl-rtl-text-0.2.3.js"), true);

    // leading party by area, exactly as the main map's default view
    const grey = S.built_empty || "#bdb9b0";
    const party = (b, l) => ["case", ["==", ["coalesce", ["get", "g"], 0], 1], grey,
      ["==", ["get", b], "no_station"], S.no_station, ["==", ["get", b], "none"], S.none,
      ["match", ["coalesce", ["get", l], ""], ...Object.entries(colors).flat(), "#999999"]];

    const [w, s, e, n] = D.bbox.split(",").map(Number);
    const el = box.querySelector(".mm-map");
    const map = new maplibregl.Map({
      container: el, interactive: false, attributionControl: false, fadeDuration: 0,
      style: { version: 8, sources: {}, glyphs: url("fonts/") + "{fontstack}/{range}.pbf",
        layers: [{ id: "bg", type: "background", paint: { "background-color": css("--map-bg") || "#e6e6e3" } }] },
      bounds: [[w, s], [e, n]],
      fitBoundsOptions: { padding: Math.min(28, el.clientWidth / 10), maxZoom: +D.maxzoom || 12 },
    });
    map.on("error", ev => console.error(ev.error || ev));
    map.on("load", () => {
      const pairs = new Set();
      for (const b of new Set(meta.parties.map(p => p.bloc))) {
        const ls = meta.parties.filter(p => p.bloc === b).map(p => p.letters);
        for (const a of ls) for (const c of ls) if (a !== c) pairs.add(`${a}|${c}`);
      }
      for (const pr of pairs) { const [a, c] = pr.split("|"); map.addImage(`h-${a}-${c}`, hatch(colors[a], colors[c])); }

      map.addSource("water", { type: "geojson", data: url("data/water.geojson") });
      map.addLayer({ id: "water", type: "fill", source: "water", paint: { "fill-color": S.water || "#c6dcea" } });
      map.addSource("land", { type: "geojson", data: url("data/land.geojson") });
      map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": S.no_station } });
      if (map.getZoom() >= 9) {  // parks, beaches and industry show only from zoom 9 on the main map too
        map.addSource("landfeat", { type: "geojson", data: url("data/land_features.geojson") });
        map.addLayer({ id: "landfeat", type: "fill", source: "landfeat", paint: { "fill-color": ["match", ["get", "t"],
          "park", S.park || "#cfe1b0", "beach", S.beach || "#f0e8d4", grey] } });
      }
      map.addSource("areas", { type: "vector", url: "pmtiles://" + base + "areas.pmtiles" });
      const src = { source: "areas", "source-layer": "areas" }, loc = { source: "areas", "source-layer": "loc" };
      map.addLayer({ id: "fill", type: "fill", ...src, paint: { "fill-color": party("b", "l"),
        "fill-opacity": ["case", ["==", ["coalesce", ["get", "g"], 0], 1], 1, ["==", ["get", "b"], "no_station"], 0, 1] } });
      map.addLayer({ id: "hatch", type: "fill", ...src, filter: ["has", "s"],
        paint: { "fill-pattern": ["concat", "h-", ["get", "l"], "-", ["get", "s"]] } });
      map.addLayer({ id: "area-line", type: "line", ...src, filter: ["!=", ["get", "b"], "no_station"],
        paint: { "line-color": S.outline, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.1, 12, 0.6] } });
      map.addLayer({ id: "loc-line", type: "line", ...loc, filter: ["==", ["get", "p"], 1],
        paint: { "line-color": S.locality_outline, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1.4] } });

      map.addSource("dots", { type: "geojson", data: dots });
      const poly = ["==", ["geometry-type"], "Polygon"];
      map.addLayer({ id: "dots-fill", type: "fill", source: "dots", filter: poly, paint: { "fill-color": party("bloc", "leader") } });
      map.addLayer({ id: "dots-line", type: "line", source: "dots", filter: poly, paint: { "line-color": "#333", "line-width": 1 } });
      const radius = ["interpolate", ["linear"], ["zoom"], 7, ["interpolate", ["linear"], ["get", "valid"], 0, 2, 3000, 6],
        12, ["interpolate", ["linear"], ["get", "valid"], 0, 5, 3000, 14]];
      map.addLayer({ id: "dots", type: "circle", source: "dots", filter: ["==", ["geometry-type"], "Point"], paint: {
        "circle-color": party("bloc", "leader"), "circle-stroke-color": "#333", "circle-stroke-width": 0.8, "circle-radius": radius } });
      map.addSource("west-bank", { type: "geojson", data: url("data/west_bank.geojson") });
      map.addLayer({ id: "wb-line", type: "line", source: "west-bank",
        paint: { "line-color": S.west_bank_line || "#5c5c5c", "line-width": 1.2, "line-dasharray": [3, 2] } });
      if (meta.dead_sea) {
        map.addSource("dead-sea", { type: "geojson", data: url("data/dead_sea.geojson") });
        map.addLayer({ id: "dead-sea", type: "fill", source: "dead-sea", paint: { "fill-color": S.water || "#c6dcea" } });
      }

      // a group of places: everything else faded, so the members stand out in their own colours
      if (D.members) {
        const m = JSON.parse(D.members), towns = m.t || [], ids = m.a || [];
        const fade = { "fill-color": css("--bg") || "#f7f7f5", "fill-opacity": 0.72 };
        map.addLayer({ id: "fade", type: "fill", ...src, paint: fade, filter: ["all", ["!=", ["get", "b"], "no_station"],
          ["!", ["in", ["get", "c"], ["literal", towns]]], ["!", ["in", ["id"], ["literal", ids]]]] });
        map.addLayer({ id: "fade-dots", type: "fill", source: "dots", paint: fade,
          filter: ["all", poly, ["!", ["in", ["get", "SEMEL_YISHUV"], ["literal", towns]]]] });
        map.setPaintProperty("dots", "circle-opacity", ["case", ["in", ["get", "SEMEL_YISHUV"], ["literal", towns]], 1, 0.25]);
        if (m.p && m.p.length) {  // zoomed out too far to see the places: a small mark for each
          map.addSource("member-pts", { type: "geojson", data: { type: "FeatureCollection", features: m.p.map(c =>
            ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) } });
          map.addLayer({ id: "member-pts", type: "circle", source: "member-pts", maxzoom: 8,
            paint: { "circle-radius": 2, "circle-color": "#1d1d1f", "circle-stroke-color": "#fff", "circle-stroke-width": 0.6 } });
        }
      }
      // the place itself, outlined in black as on the main map
      if (D.town) map.addLayer({ id: "town-hl", type: "line", ...loc, filter: ["==", ["get", "c"], +D.town],
        paint: { "line-color": "#000", "line-width": 2.5 } });
      if (D.dot) {
        const me = ["==", ["get", "SEMEL_YISHUV"], +D.dot];
        map.addLayer({ id: "dot-hl", type: "line", source: "dots", filter: ["all", poly, me], paint: { "line-color": "#000", "line-width": 2.5 } });
        map.addLayer({ id: "dot-hl-pt", type: "circle", source: "dots", filter: ["all", ["==", ["geometry-type"], "Point"], me],
          paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#000", "circle-stroke-width": 2.5, "circle-radius": radius } });
      }
      const ol = box.querySelector("script.mm-outline");
      if (ol) {
        map.addSource("outline", { type: "geojson", data: JSON.parse(ol.textContent) });
        map.addLayer({ id: "outline", type: "line", source: "outline", paint: { "line-color": "#000", "line-width": 2.5 } });
      }

      // town names as on the main map, each from its own zoom
      map.addSource("labels", { type: "geojson", data: base + "labels.geojson" });
      map.addLayer({ id: "labels", type: "symbol", source: "labels", minzoom: 6,
        filter: ["<=", ["coalesce", ["get", "z"], 9], ["zoom"]],
        layout: { "text-field": HE ? ["coalesce", ["get", "nh"], ["get", "n"]] : ["get", "n"], "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 7, ["interpolate", ["linear"], ["get", "v"], 0, 9, 50000, 11],
            12, ["interpolate", ["linear"], ["get", "v"], 0, 10, 50000, 14]],
          "symbol-sort-key": ["-", ["get", "v"]], "text-padding": 3, "text-max-width": 10 },
        paint: { "text-color": "#2b2b2b", "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.4 } });
      if (meta.frame) {  // beyond the sea's rectangle, the page colour (as on the main map)
        const [fw, fs, fe, fn] = meta.frame, ring = [[fw, fs], [fe, fs], [fe, fn], [fw, fn], [fw, fs]];
        map.addSource("frame", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon",
          coordinates: [[[-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85]], ring.slice().reverse()] } } });
        map.addLayer({ id: "frame", type: "fill", source: "frame", paint: { "fill-color": css("--bg") || "#f7f7f5" } });
      }
    });
    map.once("idle", () => box.classList.add("ready"));
  }

  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    draw().catch(err => { console.error(err); box.classList.add("failed"); });
  };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: "300px" });
    io.observe(box);
  } else go();
})();
