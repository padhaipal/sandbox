# PadhaiPal — Educator Network demo

Static, self-contained HTML demo. Every library (React, Tailwind, d3, jsPDF, Babel) loads
from a CDN at runtime — there is **no build step**. The only local assets are the boundary
GeoJSON, the bundled UDISE schools, and the face images in `faces/`.

## Files
- `index.html` — the demo: a World → Country → DGSE → BSA → BEO → school drill-down map
  (signed in as the Global Education Secretary). Drilling into a school shows its
  Head Teacher → Teachers → Students force graph — the only node graph in the app.
- `faces/adult/*.jpg`, `faces/child/*.jpg` — FairFace subset used by the school force graph
  (demo only).
- `schools/*.json`, `india-*.geojson` — bundled India school points + boundaries.

## Run locally
Open `index.html` directly, or serve the folder:
```
npx serve .       # then open the printed http://localhost:3000
```
(Serving over http avoids any browser file:// restrictions.)

## Deploy free on Vercel (no Git required)
```
npm i -g vercel        # one-time
cd network-demo
vercel login           # pick email or GitHub
vercel                 # accept defaults -> preview URL
vercel --prod          # promote to the production URL
```
Vercel auto-detects a static site (no framework, no build command, output = this folder).
`index.html` is served at `/`.
