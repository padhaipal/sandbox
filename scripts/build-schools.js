#!/usr/bin/env node
/*
 * ETL: real primary public-school locations for the map.
 *
 * Source: DataMeet's 2021 UDISE+ scrape (https://github.com/datameet/udise_schools),
 *   extract `data/udise_schools.zip` -> `udise_schools.csv` (~395 MB, not committed).
 *
 * Extract  : stream the national CSV.
 * Transform: keep PRIMARY (school_cat starts "Primary") + PUBLIC (government managements);
 *            clean coordinates (drop empty / 0,0 / out-of-India); assign each school to a
 *            district by point-in-polygon against india-districts.geojson (robust to the
 *            dtcode11 crosswalk errors in the source); slim to {name, lon, lat}.
 * Load     : one GeoJSON per district -> schools/<st>-<dt>.geojson, plus a manifest.
 *
 * Usage: node scripts/build-schools.js [csvPath] [stcode11]
 *   defaults: /tmp/udise/udise_schools.csv  09 (Uttar Pradesh)
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CSV = process.argv[2] || "/tmp/udise/udise_schools.csv";
const ST = process.argv[3] || "09";
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "schools");

// government managements counted as "public" (excludes Private Unaided, Madarsa, Government Aided)
const PUBLIC = new Set([
  "Department of Education", "Local body", "Tribal Welfare Department",
  "Social welfare Department", "Kendriya Vidyalaya", "Jawahar Navodaya Vidyalaya",
  "Other Govt. managed schools", "Others Central Government School",
  "Railway School", "Sainik School", "Ministry of Labor",
]);

// minimal quote-aware CSV line parser
function parseLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
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
  return g.features.filter((f) => f.properties.st === ST).map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((p) => p[0]);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const pt of r) { if (pt[0] < a) a = pt[0]; if (pt[0] > c) c = pt[0]; if (pt[1] < b) b = pt[1]; if (pt[1] > d) d = pt[1]; }
    return { dt: f.properties.dt, name: f.properties.district, rings, bbox: [a, b, c, d] };
  });
}

(async () => {
  const districts = loadDistricts();
  console.log(`districts in state ${ST}: ${districts.length}`);
  const byDt = new Map();   // dt -> [feature]
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
    if (f[iSt] !== ST) continue;
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
    if (!byDt.has(hit.dt)) byDt.set(hit.dt, []);
    byDt.get(hit.dt).push({ type: "Feature", properties: { n: (f[iSchname] || "").trim() },
      geometry: { type: "Point", coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] } });
  }

  fs.mkdirSync(OUT, { recursive: true });
  const districtsOut = [];
  for (const [dt, feats] of byDt) {
    fs.writeFileSync(path.join(OUT, `${ST}-${dt}.geojson`), JSON.stringify({ type: "FeatureCollection", features: feats }));
    districtsOut.push({ dt, n: feats.length });
  }
  districtsOut.sort((a, b) => (+a.dt) - (+b.dt));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ st: ST, source: "UDISE 2021 (DataMeet)", filter: "primary + government", districts: districtsOut, total: stat.kept }));

  let bytes = 0; for (const e of districtsOut) bytes += fs.statSync(path.join(OUT, `${ST}-${e.dt}.geojson`)).size;
  console.log(JSON.stringify(stat, null, 1));
  console.log(`wrote ${districtsOut.length} district files + manifest, ${Math.round(bytes / 1024)} KB total`);
})();
