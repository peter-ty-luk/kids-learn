// Realistic handling test: drive a lap using ONLY key inputs (W/A/S/D),
// exactly like a player — no direct rotY writes. Reports lap time and how
// often the kart ran off the road.
//   node _keys-test.mjs <trackId> <carIndex>   (carIndex 0-7; 7 = Tank)
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tid = Number(process.argv[2] ?? 3);
const carIdx = Number(process.argv[3] ?? 7);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--no-sandbox", "--window-size=1280,800"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

await page.goto("http://localhost:3077", { waitUntil: "networkidle2" });
await page.click("#offline-btn");
await page.waitForSelector(".car-card");
await page.evaluate((i) => document.querySelectorAll(".car-card")[i].click(), carIdx);
await page.click(`.track-card[data-track-id="${tid}"]`);
await page.click("#start-race-btn");
await page.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 45000 });
await page.waitForFunction(() => window._raceEnded === false, { timeout: 20000 });

const carName = await page.evaluate(() => `${selectedCarModel.name} (turn ${selectedCarModel.turnSpeed}, max ${selectedCarModel.maxSpeed})`);
const trackName = await page.evaluate(() => getActiveTrack().name);

// Key-only autopilot: steer with A/D, throttle with W, brake with S before bends.
await page.evaluate(() => {
  window.__offTrack = 0; window.__frames = 0; window.__wasOff = false;
  window.__drive = setInterval(() => {
    const pts = window._trackPoints, n = pts.length;
    const cp = playerCar.checkpointIndex;
    const j = (cp + 5) % n;
    const dx = pts[j].x - playerCar.pos.x, dz = pts[j].z - playerCar.pos.z;
    let diff = Math.atan2(dx, dz) - playerCar.rotY;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    gameKeys["ArrowLeft"] = diff < -0.06;
    gameKeys["ArrowRight"] = diff > 0.06;
    // look further ahead: if the road bends hard, brake to corner speed
    const k = (cp + 12) % n;
    const a2 = Math.atan2(pts[k].x - pts[j].x, pts[k].z - pts[j].z);
    let bend = a2 - Math.atan2(dx, dz);
    while (bend > Math.PI) bend -= 2 * Math.PI;
    while (bend < -Math.PI) bend += 2 * Math.PI;
    const tooFast = Math.abs(bend) > 0.55 && playerCar.speed > playerCar.maxSpeed * 0.5;
    gameKeys["ArrowUp"] = !tooFast;
    gameKeys["ArrowDown"] = tooFast;

    // off-road accounting (same test as isOnTrack: > ribbon + 2 from centreline)
    window.__frames++;
    let cd = Infinity, ci = 0;
    for (let i = 0; i < n; i++) {
      const ex = playerCar.pos.x - pts[i].x, ez = playerCar.pos.z - pts[i].z;
      const d = ex * ex + ez * ez;
      if (d < cd) { cd = d; ci = i; }
    }
    const a = pts[ci], b = pts[(ci + 1) % n];
    const sx = b.x - a.x, sz = b.z - a.z, sl = Math.hypot(sx, sz) || 1;
    const lat = Math.abs((playerCar.pos.x - a.x) * (-sz / sl) + (playerCar.pos.z - a.z) * (sx / sl));
    const off = lat > 20;
    if (off && !window.__wasOff) window.__offTrack++;
    window.__wasOff = off;
  }, 30);
});

const t0 = Date.now();
let lap = 0;
while (lap < 1 && Date.now() - t0 < 360000) {
  await sleep(500);
  lap = await page.evaluate(() => playerCar.lap);
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
const stats = await page.evaluate(() => ({ off: window.__offTrack, frames: window.__frames, cp: playerCar.checkpointIndex }));
await page.screenshot({ path: `/tmp/track-shots/keys-t${tid}-c${carIdx}.png` });

console.log(`${trackName} | ${carName}`);
if (lap >= 1) console.log(`LAP DONE in ${secs}s (game runs ~18fps headless ≈ ${(secs / 3.3).toFixed(0)}s at 60fps) — ran off road ${stats.off}×`);
else console.log(`LAP FAILED after ${secs}s — stuck at checkpoint ${stats.cp}/160, ran off road ${stats.off}×`);
await browser.close();
process.exit(lap >= 1 ? 0 : 2);
