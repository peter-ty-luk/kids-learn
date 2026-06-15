#!/usr/bin/env node
// Vehicle-balance simulator: runs every vehicle around every track using the
// REAL data (CAR_MODELS + TRACKS are extracted from game.js, so this never
// drifts from the source) and a faithful mirror of the player physics:
//   - throttle/brake/friction, steering speedFactor, off-road slowdown+pushback
//   - wall damage ∝ v² with toughness, dizzy freeze when health hits 0
// The driving policy is the same for every vehicle and *handling-aware*: it
// brakes for a bend exactly when the vehicle's turning circle can't make it,
// so nimble karts carry corner speed that trucks must brake for (like a
// competent kid driving each vehicle).
//
//   node tools/balance-sim.mjs            # 3-lap race, all vehicles × tracks
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "..", "game.js"), "utf8");

const grab = (name) => {
  const m = src.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!m) { console.error(`cannot find ${name} in game.js`); process.exit(1); }
  return eval(m[1]); // pure data literals
};
const CAR_MODELS = grab("CAR_MODELS");
const TRACKS = grab("TRACKS");

// Match the game's multipliers. Pace (GAME_SPEED) scales speed/accel; steering
// (STEER_SPEED) is decoupled so the turn rate scales separately.
const GAME_SPEED = Number((src.match(/const GAME_SPEED = ([0-9.]+)/) || [])[1] || 1);
const STEER_SPEED = Number((src.match(/const STEER_SPEED = ([0-9.]+)/) || [])[1] || GAME_SPEED);
for (const m of CAR_MODELS) {
  m.maxSpeed *= GAME_SPEED;
  m.acceleration *= GAME_SPEED;
  m.turnSpeed *= STEER_SPEED;
}

// --- track centreline, exactly as createScene builds it ---
const N = 160, RIBBON = 18;
function buildPoints(track) {
  const pts = [];
  if (track.points) {
    const cps = track.points, n = cps.length;
    const cat = (a, b, c, d, u) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * n, seg = Math.floor(t), u = t - seg;
      const p0 = cps[(seg - 1 + n) % n], p1 = cps[seg % n], p2 = cps[(seg + 1) % n], p3 = cps[(seg + 2) % n];
      pts.push({ x: cat(p0[0], p1[0], p2[0], p3[0], u), z: cat(p0[1], p1[1], p2[1], p3[1], u) });
    }
  } else {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.3;
      let rx = track.rx, rz = track.rz;
      for (const w of (track.warp || [])) { rx += w.ax * Math.sin(w.k * a + w.phase); rz += w.az * Math.sin(w.k * a + w.phase); }
      pts.push({ x: Math.cos(a) * rx, z: Math.sin(a) * rz });
    }
  }
  return pts;
}

const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function simulate(model, pts, laps = 3, maxFrames = 60 * 600) {
  const health = model.stats.health || 3;
  const toughness = 0.6 + health * 0.3;
  const car = {
    x: pts[2].x + 4, z: pts[2].z,
    rotY: Math.atan2(pts[3].x - pts[2].x, pts[3].z - pts[2].z),
    speed: 0, rating: 100, dizzy: 0, wallCd: 0, lap: 0, cp: 2,
    wallHits: 0, dizzies: 0,
  };
  // Nearest point on the centreline POLYLINE (mirrors closestOnTrack in game.js).
  const closestOn = () => {
    let bi = 0, bx = 0, bz = 0, bd2 = Infinity;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
      let t = ((car.x - a.x) * dx + (car.z - a.z) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + dx * t, cz = a.z + dz * t, ex = car.x - cx, ez = car.z - cz, d2 = ex * ex + ez * ez;
      if (d2 < bd2) { bd2 = d2; bi = i; bx = cx; bz = cz; }
    }
    return { i: bi, cx: bx, cz: bz, d: Math.sqrt(bd2) };
  };
  const closest = () => closestOn().i;

  for (let f = 0; f < maxFrames; f++) {
    const ci = closest();
    // lap counting (game rule: wrap from the top indices to the bottom ones)
    if (ci !== car.cp) {
      if (ci < 12 && car.cp > N - 12) { car.lap++; if (car.lap >= laps) return { frames: f, ...car }; }
      car.cp = ci;
    }

    if (car.wallCd > 0) car.wallCd--;
    if (car.dizzy > 0) {
      // dizzy until health crawls back to the wake threshold (mirrors game.js)
      car.dizzy--; car.speed *= 0.9;
      if (car.rating < 50) {
        car.rating = Math.min(50, car.rating + 0.34);
        if (car.dizzy <= 0 && car.rating < 50) car.dizzy = 1;
      }
    }
    else {
      if (car.rating < 100) car.rating = Math.min(100, car.rating + 0.05);

      // --- handling-aware policy (same for everyone) ---
      const j = (ci + 5) % N, k = (ci + 12) % N;
      const tgt = Math.atan2(pts[j].x - car.x, pts[j].z - car.z);
      const diff = norm(tgt - car.rotY);
      const hdg2 = Math.atan2(pts[k].x - pts[j].x, pts[k].z - pts[j].z);
      const bend = Math.abs(norm(hdg2 - tgt));
      const dist = Math.hypot(pts[k].x - pts[j].x, pts[k].z - pts[j].z) || 1;
      const curvature = bend / dist;                       // rad per unit ahead
      const factor = Math.max(0.5, Math.min(Math.abs(car.speed) / (model.maxSpeed * 0.4), 1));
      const yawPerDist = (model.turnSpeed * factor) / Math.max(car.speed, 0.05);
      const brake = curvature > 0.85 * yawPerDist && car.speed > model.maxSpeed * 0.35;

      if (brake) { car.speed -= 0.03 * 2; if (car.speed < 0) car.speed = 0; }
      else car.speed = Math.min(car.speed + model.acceleration, model.maxSpeed);
      if (car.speed < 0.005 && !brake) car.speed = Math.min(car.speed + model.acceleration, model.maxSpeed);

      if (Math.abs(diff) > 0.06) car.rotY += Math.sign(diff) * model.turnSpeed * factor;
    }

    car.x += Math.sin(car.rotY) * car.speed;
    car.z += Math.cos(car.rotY) * car.speed;

    // Containment mirrors game.js clampToWall/containCar: the car BODY (centre +
    // half-width≈scale) must stop at the rail inner face (RIBBON + 1.2).
    const c = closestOn();
    const limit = (RIBBON + 1.2) - (model.scale || 1.25);
    if (c.d > limit) {
      let ux = car.x - c.cx, uz = car.z - c.cz;
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      car.x -= ux * (c.d - limit);
      car.z -= uz * (c.d - limit);
      const into = Math.sin(car.rotY) * car.speed * ux + Math.cos(car.rotY) * car.speed * uz;
      if (into > 0.01) {
        if (car.wallCd <= 0 && car.dizzy <= 0) {
          const fr = Math.min(1.2, into / model.maxSpeed);
          if (fr >= 0.45) {
            car.wallCd = 45;
            car.wallHits++;
            car.rating -= (fr * fr * 45) / toughness;
            if (car.rating <= 0) { car.rating = 0; car.dizzy = 30; car.dizzies++; }
          }
        }
        car.speed *= Math.max(0.4, 1 - (into / model.maxSpeed) * 0.9);
      }
    }
  }
  return { frames: maxFrames, dnf: true, ...car };
}

// --- run the matrix ---
const args = process.argv.slice(2);
const laps = 3;
console.log(`3-lap race times (seconds @60fps) — same driver policy for every vehicle\n`);
const header = ["vehicle".padEnd(10), ...TRACKS.map(t => t.name.split(" ")[0].slice(0, 7).padStart(8)), "   mean"].join("");
console.log(header);

const rows = [];
for (const m of CAR_MODELS) {
  const times = [], extras = [];
  for (const t of TRACKS) {
    const pts = buildPoints(t);
    const r = simulate(m, pts, laps);
    times.push(r.frames / 60);
    extras.push(r);
  }
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  rows.push({ id: m.id, name: m.name, times, mean, extras });
  console.log(m.name.padEnd(10) + times.map(s => s.toFixed(1).padStart(8)).join("") + mean.toFixed(1).padStart(7));
}

console.log("\nper-track spread (slowest vs fastest):");
TRACKS.forEach((t, i) => {
  const ts = rows.map(r => r.times[i]);
  const lo = Math.min(...ts), hi = Math.max(...ts);
  const worst = rows.find(r => r.times[i] === hi).name, best = rows.find(r => r.times[i] === lo).name;
  console.log(`  ${t.name.padEnd(14)} ${(100 * (hi - lo) / lo).toFixed(1).padStart(5)}%   (${best} ${lo.toFixed(1)}s … ${worst} ${hi.toFixed(1)}s)`);
});
const means = rows.map(r => r.mean);
const lo = Math.min(...means), hi = Math.max(...means);
console.log(`\noverall: best ${rows.find(r => r.mean === lo).name} ${lo.toFixed(1)}s, worst ${rows.find(r => r.mean === hi).name} ${hi.toFixed(1)}s → spread ${(100 * (hi - lo) / lo).toFixed(1)}%`);
const crashes = rows.map(r => `${r.name}: ${r.extras.reduce((s, e) => s + e.wallHits, 0)} wall hits, ${r.extras.reduce((s, e) => s + e.dizzies, 0)} dizzy`).join("\n  ");
console.log(`\ncrash economy across all tracks:\n  ${crashes}`);
