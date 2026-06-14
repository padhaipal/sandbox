#!/usr/bin/env node
/*
 * ETL: real primary public-school locations for the map (all of India).
 *
 * Source: DataMeet's 2021 UDISE+ scrape (https://github.com/datameet/udise_schools),
 *   extract `data/udise_schools.zip` -> `udise_schools.csv` (~395 MB, not committed).
 *
 * Extract  : stream the national CSV once.
 * Transform: keep PRIMARY (school_cat starts "Primary") + PUBLIC (government managements);
 *            clean coordinates (drop empty / 0,0 / out-of-India); assign each school to a
 *            district by point-in-polygon against india-districts.geojson (robust to the
 *            dtcode11 crosswalk errors in the source).
 * Load     : one compact JSON per district -> schools/<st>-<dt>.json = {n:[names], c:[[lon,lat]]},
 *            plus schools/manifest.json. Compact (not GeoJSON) to keep the national set small.
 *
 * Usage: node scripts/build-schools.js [csvPath] [stcode11|all]
 *   defaults: /tmp/udise/udise_schools.csv  all
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CSV = process.argv[2] || "/tmp/udise/udise_schools.csv";
const ONLY = process.argv[3] && process.argv[3] !== "all" ? process.argv[3] : null;
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "schools");

// government managements counted as "public" (excludes Private Unaided, Madarsa, Government Aided)
const PUBLIC = new Set([
  "Department of Education", "Local body", "Tribal Welfare Department",
  "Social welfare Department", "Kendriya Vidyalaya", "Jawahar Navodaya Vidyalaya",
  "Other Govt. managed schools", "Others Central Government School",
  "Railway School", "Sainik School", "Ministry of Labor",
]);

function parseLine(line) {                 // minimal quote-aware CSV line parser
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const ray = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

function loadDistricts() {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, "india-districts.geojson"), "utf8"));
  return g.features.filter((f) => !ONLY || f.properties.st === ONLY).map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((p) => p[0]);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const pt of r) { if (pt[0] < a) a = pt[0]; if (pt[0] > c) c = pt[0]; if (pt[1] < b) b = pt[1]; if (pt[1] > d) d = pt[1]; }
    return { key: f.properties.st + "-" + f.properties.dt, st: f.properties.st, dt: f.properties.dt, rings, bbox: [a, b, c, d] };
  });
}

(async () => {
  const districts = loadDistricts();
  console.log(`districts: ${districts.length}${ONLY ? " (state " + ONLY + ")" : " (all India)"}`);
  const byKey = new Map();   // "st-dt" -> { n:[], c:[] }
  const stat = { total: 0, primaryPublic: 0, badCoord: 0, unassigned: 0, kept: 0 };

  let header = null, iSchname, iCat, iMgmt, iLon, iLat, iSt;
  const rl = readline.createInterface({ input: fs.createReadStream(CSV) });
  for await (const line of rl) {
    if (header === null) {
      header = parseLine(line);
      iSchname = header.indexOf("schname"); iCat = header.indexOf("school_cat");
      iMgmt = header.indexOf("management"); iLon = header.indexOf("lon");
      iLat = header.indexOf("lat"); iSt = header.indexOf("stcode11");
      continue;
    }
    const f = parseLine(line);
    if (f.length < header.length) continue;
    stat.total++;
    if (ONLY && f[iSt] !== ONLY) continue;
    if (!/^Primary/.test(f[iCat]) || !PUBLIC.has(f[iMgmt])) continue;
    stat.primaryPublic++;
    const lon = parseFloat(f[iLon]), lat = parseFloat(f[iLat]);
    if (!isFinite(lon) || !isFinite(lat) || (Math.abs(lon) < 0.01 && Math.abs(lat) < 0.01) ||
        lon < 68 || lon > 98 || lat < 6 || lat > 38) { stat.badCoord++; continue; }
    const p = [lon, lat];
    let hit = null;
    for (const dst of districts) {
      const [a, b, c, d] = dst.bbox;
      if (lon < a || lon > c || lat < b || lat > d) continue;
      if (dst.rings.some((r) => ray(p, r))) { hit = dst; break; }
    }
    if (!hit) { stat.unassigned++; continue; }
    stat.kept++;
    let e = byKey.get(hit.key);
    if (!e) { e = { n: [], c: [] }; byKey.set(hit.key, e); }
    e.n.push((f[iSchname] || "").trim());
    e.c.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
  }

  // fresh output dir
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const out = [];
  for (const [key, e] of byKey) {
    fs.writeFileSync(path.join(OUT, key + ".json"), JSON.stringify(e));
    const [st, dt] = key.split("-");
    out.push({ st, dt, n: e.n.length });
  }
  out.sort((a, b) => a.st.localeCompare(b.st) || (+a.dt) - (+b.dt));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ source: "UDISE 2021 (DataMeet)", filter: "primary + government", total: stat.kept, districts: out }));

  let bytes = 0; for (const e of out) bytes += fs.statSync(path.join(OUT, e.st + "-" + e.dt + ".json")).size;
  console.log(JSON.stringify(stat, null, 1));
  console.log(`wrote ${out.length} district files + manifest across ${new Set(out.map((d) => d.st)).size} states, ${Math.round(bytes / 1024 / 1024 * 10) / 10} MB total`);
})();
