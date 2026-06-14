# PadhaiPal — Educator Network demos

Static, self-contained HTML demos. Every library (React, Tailwind, react-force-graph,
React Flow, Babel) loads from a CDN at runtime — there is **no build step**. The only
local assets are the face images in `faces/`.

## Files
- `index.html` — **main demo**: toggle between the force-directed radial graph and the
  React Flow accordion tree (signed in as the DGSE).
- `educator-network-forcegraph-radial.html`, `educator-network-forcegraph.html`,
  `educator-network-demo.html` — earlier standalone versions, kept for reference.
- `faces/adult/*.jpg`, `faces/child/*.jpg` — FairFace subset used by the force-graph views
  (demo only).

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
