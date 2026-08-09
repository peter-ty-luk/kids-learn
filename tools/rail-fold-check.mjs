#!/usr/bin/env node
// Guardrail-fold detector.
//
// The red guardrail is the centreline pushed sideways by trackRibbonWidth+1.5
// (~19.5). Where a corner turns tighter than that, the INNER rail folds back
// across the road and looks like "a fence in the middle of the track" — and
// since guardrails are decorative (isPickable=false) cars drive straight
// through it. This samples every track the way game.js does and reports how
// close each rail gets to the centreline.
//
//   node tools/rail-fold-check.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "..", "game.js"), "utf8");
const grab = (name) => {
  const m = src.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!m) { console.error(`cannot find ${name} in game.js`); process.exit(1); }
  return eval(m[1]);
};
const TRACKS = grab("TRACKS");
const RIBBON = Number((src.match(/const trackRibbonWidth = ([0-9.]+)/) || [])[1] || 18);
const OFFSET = RIBBON + 1.5;
const NUM = 160;                      // game.js numPoints

// --- centreline, mirroring game.js exactly ---
function centreline(track) {
  const pts = [];
  if (track.points) {
    const cps = track.points, n = cps.length;
    const cat = (a, b, c, d, u) =>
      0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    for (let i = 0; i < NUM; i++) {
      const t = (i / NUM) * n, seg = Math.floor(t), u = t - seg;
      const p0 = cps[(seg - 1 + n) % n], p1 = cps[seg % n], p2 = cps[(seg + 1) % n], p3 = cps[(seg + 2) % n];
      pts.push({ x: cat(p0[0], p1[0], p2[0], p3[0], u), z: cat(p0[1], p1[1], p2[1], p3[1], u) });
    }
  } else {
    for (let i = 0; i < NUM; i++) {
      const a = (i / NUM) * Math.PI * 2 + 0.3;
      let rx = track.rx, rz = track.rz;
      for (const w of (track.warp || [])) { rx += w.ax * Math.sin(w.k * a + w.phase); rz += w.az * Math.sin(w.k * a + w.phase); }
      pts.push({ x: Math.cos(a) * rx, z: Math.sin(a) * rz });
    }
  }
  return pts;
}

// point-to-polyline distance (same shape as the game's closestOnTrack)
function distToTrack(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1e-9;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t, cz = a.z + dz * t;
    best = Math.min(best, Math.hypot(p.x - cx, p.z - cz));
  }
  return best;
}

let bad = 0;
console.log(`road half-width ${RIBBON}, rail offset ${OFFSET}\n`);
console.log("race  id  track            inner-rail closest approach to the centreline");
for (const [idx, track] of TRACKS.entries()) {
  const line = centreline(track);
  let worst = Infinity, worstAt = null;
  for (let side = 0; side <= 1; side++) {
    for (let i = 0; i < NUM; i++) {
      const pt = line[i], nx = line[(i + 1) % NUM];
      const ang = Math.atan2(nx.z - pt.z, nx.x - pt.x);
      const off = side === 0 ? -OFFSET : OFFSET;
      const rp = { x: pt.x + -Math.sin(ang) * off, z: pt.z + Math.cos(ang) * off };
      const d = distToTrack(rp, line);
      if (d < worst) { worst = d; worstAt = { side, i, x: Math.round(rp.x), z: Math.round(rp.z) }; }
    }
  }
  // a healthy rail sits ~19.5 out; anything that wanders back inside the road
  // surface (< half-width) is a fold sitting in the driving line
  const verdict = worst < RIBBON * 0.45 ? "FOLD — fence lies across the road"
    : worst < RIBBON * 0.75 ? "tight — rail dips into the road"
    : "ok";
  if (worst < RIBBON * 0.75) bad++;
  console.log(`  ${String(idx + 1).padStart(2)}  ${String(track.id).padStart(2)}  ${track.name.padEnd(15)} ${worst.toFixed(1).padStart(6)}   ${verdict}${worst < RIBBON * 0.75 ? `  @x=${worstAt.x},z=${worstAt.z}` : ""}`);
}
console.log(bad ? `\n${bad} track(s) need attention` : "\nAll rails hug the track edge");
process.exit(bad ? 2 : 0);
