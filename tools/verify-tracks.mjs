// Headless verification of the new track system: loads every track, auto-drives
// a lap, screenshots, and exercises the train / traps / boost pads / elevation.
// Run from the project dir (puppeteer-core resolves from here).
//   node _track-verify.mjs            # all tracks
//   node _track-verify.mjs 3,6        # specific track ids
import fs from "fs";
const puppeteer = (await import("puppeteer-core")).default;

const BASE = "http://localhost:3077";
const SHOTS = "/tmp/track-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const TRACK_IDS = process.argv[2] ? process.argv[2].split(",").map(Number) : [0, 1, 2, 3, 4, 5, 6, 7];
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--no-sandbox", "--window-size=1280,800"],
});

for (const tid of TRACK_IDS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console: " + m.text());
  });
  const report = { tid };

  try {
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("#offline-btn", { timeout: 10000 });
    await page.click("#offline-btn");
    await page.waitForSelector(".car-card", { timeout: 10000 });
    await page.click(".car-card");
    await page.waitForSelector(`.track-card[data-track-id="${tid}"]`, { timeout: 5000 });
    await page.click(`.track-card[data-track-id="${tid}"]`);
    await page.waitForFunction(() => !document.getElementById("start-race-btn").disabled, { timeout: 5000 });
    await page.click("#start-race-btn");

    await page.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 45000 });
    await sleep(1500);
    report.name = await page.evaluate(() => getActiveTrack().name);
    await page.screenshot({ path: `${SHOTS}/t${tid}-0-start.png` });

    // window._raceEnded flips to false at the GO! moment (raceStarted itself is scene-local).
    await page.waitForFunction(() => window._raceEnded === false, { timeout: 15000 });

    // Auto-pilot: throttle on, steer at the next track point from inside the page.
    // Headless swiftshader runs ~18fps, so give the test kart extra pace to keep
    // wall-clock times sane (frame-based game logic is unaffected).
    await page.evaluate(() => {
      gameKeys["KeyW"] = true;
      playerCar.maxSpeed = 2.6;
      playerCar.acceleration = 0.15;
      window.__steer = setInterval(() => {
        if (!window._trackPoints) return;
        const pts = window._trackPoints, n = pts.length;
        const i = (playerCar.checkpointIndex + 4) % n;
        const dx = pts[i].x - playerCar.pos.x, dz = pts[i].z - playerCar.pos.z;
        let diff = Math.atan2(dx, dz) - playerCar.rotY;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        playerCar.rotY += Math.max(-0.12, Math.min(0.12, diff));
      }, 16);
    });

    // Drive one full lap, sampling road height as we go.
    const ys = [];
    let lap = 0;
    const t0 = Date.now();
    let midShot = false;
    while (lap < 1 && Date.now() - t0 < 90000) {
      await sleep(300);
      const st = await page.evaluate(() => ({ lap: playerCar.lap, cp: playerCar.checkpointIndex, y: playerCar.pos.y }));
      ys.push(st.y);
      lap = st.lap;
      if (!midShot && st.cp > 75) { midShot = true; await page.screenshot({ path: `${SHOTS}/t${tid}-1-midlap.png` }); }
    }
    report.lapDone = lap >= 1;
    report.yMin = Math.min(...ys).toFixed(1);
    report.yMax = Math.max(...ys).toFixed(1);
    await page.screenshot({ path: `${SHOTS}/t${tid}-2-lap.png` });
    await page.evaluate(() => { clearInterval(window.__steer); gameKeys["KeyW"] = false; playerCar.speed = 0; });

    // --- Feature drills ---
    const feats = await page.evaluate(() => (getActiveTrack().features || []).map(f => ({ ...f })));

    // Tunnel: spawn shortly before the mouth, drive in, then screenshot — the
    // chase camera follows down the road so the shot is from INSIDE.
    const tun = feats.find(f => f.type === "tunnel");
    if (tun) {
      await page.evaluate((f) => {
        const pts = window._trackPoints, n = pts.length;
        const i = (Math.floor(f.from * n) - 6 + n) % n;
        playerCar.pos.x = pts[i].x; playerCar.pos.z = pts[i].z; playerCar.pos.y = pts[i].y + 0.1;
        playerCar.rotY = Math.atan2(pts[(i + 2) % n].x - pts[i].x, pts[(i + 2) % n].z - pts[i].z);
        playerCar.speed = 0;
        playerCar.maxSpeed = 1.2;
        gameKeys["KeyW"] = true;
        window.__steer2 = setInterval(() => {
          const j = (playerCar.checkpointIndex + 3) % n;
          const dx = pts[j].x - playerCar.pos.x, dz = pts[j].z - playerCar.pos.z;
          let diff = Math.atan2(dx, dz) - playerCar.rotY;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          playerCar.rotY += Math.max(-0.1, Math.min(0.1, diff));
        }, 16);
      }, tun);
      await sleep(4500); // drive into the tunnel, camera in tow
      await page.screenshot({ path: `${SHOTS}/t${tid}-3-tunnel.png` });
      await page.evaluate(() => { clearInterval(window.__steer2); gameKeys["KeyW"] = false; playerCar.speed = 0; });
      report.tunnel = "shot";
    }

    // Trap: park on the first hazard, confirm it bites (stun or cooldown set).
    if (feats.some(f => f.type === "trap")) {
      report.trap = await page.evaluate(() => new Promise((res) => {
        const hz = window._staticHazards[0];
        playerCar.invincibleTimer = 0; playerCar._hazCd = 0; playerCar.stunTimer = 0;
        playerCar.pos.x = hz.x; playerCar.pos.z = hz.z; playerCar.speed = 0.5;
        const t1 = Date.now();
        const iv = setInterval(() => {
          if (playerCar.stunTimer > 0 || playerCar._hazCd > 0) { clearInterval(iv); res(hz.kind + " ✓"); }
          else if (Date.now() - t1 > 4000) { clearInterval(iv); res(hz.kind + " ✗ NO EFFECT"); }
        }, 60);
      }));
      if (String(report.trap).includes("✗")) failures.push({ tid, errors: ["trap had no effect"] });
    }

    // Boost pad: park on it, expect boostTimer.
    if (feats.some(f => f.type === "boost")) {
      report.boost = await page.evaluate(() => new Promise((res) => {
        const bp = window._boostPads[0];
        playerCar.boostTimer = 0; playerCar._padCd = 0; playerCar.stunTimer = 0; playerCar.dizzyTimer = 0;
        playerCar.pos.x = bp.x; playerCar.pos.z = bp.z; playerCar.speed = 0.2;
        const t1 = Date.now();
        const iv = setInterval(() => {
          if (playerCar.boostTimer > 0) { clearInterval(iv); res("boost ✓"); }
          else if (Date.now() - t1 > 4000) { clearInterval(iv); res("boost ✗ NO EFFECT"); }
        }, 60);
      }));
      if (String(report.boost).includes("✗")) failures.push({ tid, errors: ["boost pad had no effect"] });
    }

    // Train: park on the crossing and wait out one cycle — expect to get hit.
    const trf = feats.find(f => f.type === "train");
    if (trf) {
      // First, wait for the train to be visibly crossing and screenshot it.
      // Shrink the cycle for the test (18fps headless makes 1500 frames ≈ 83s).
      const trainShown = await page.evaluate(() => new Promise((res) => {
        const tr = window._trains[0];
        tr.period = 460; tr.timer = 0; // warning at frame 150, crossing 150-450
        // park just OFF the rails for the photo, looking at the crossing
        playerCar.pos.x = tr.cx - tr.fx * 18; playerCar.pos.z = tr.cz - tr.fz * 18;
        playerCar.rotY = Math.atan2(tr.cx - playerCar.pos.x, tr.cz - playerCar.pos.z);
        playerCar.speed = 0; playerCar.dizzyTimer = 0;
        const t1 = Date.now();
        const iv = setInterval(() => {
          playerCar.speed = 0;
          if (tr.root.isEnabled()) { clearInterval(iv); res(true); }
          else if (Date.now() - t1 > 60000) { clearInterval(iv); res(false); }
        }, 80);
      }));
      if (trainShown) {
        await sleep(900);
        await page.screenshot({ path: `${SHOTS}/t${tid}-4-train.png` });
      }
      report.trainSeen = trainShown;

      const trainHit = await page.evaluate(() => new Promise((res) => {
        const tr = window._trains[0];
        tr.timer = 0; // restart the cycle: warning then a fresh crossing
        playerCar.invincibleTimer = 0; playerCar.dizzyTimer = 0; playerCar.rating = 100;
        const park = () => { playerCar.pos.x = tr.cx; playerCar.pos.z = tr.cz; playerCar.speed = 0; };
        park();
        const t1 = Date.now();
        const iv = setInterval(() => {
          if (playerCar.dizzyTimer > 0) { clearInterval(iv); res(true); }
          else if (Date.now() - t1 > 60000) { clearInterval(iv); res(false); }
          else if (playerCar.knockbackX === 0 && playerCar.knockbackZ === 0) park();
        }, 80);
      }));
      report.trainHit = trainHit;
      if (!trainHit) failures.push({ tid, errors: ["train never hit the parked kart"] });
      await page.screenshot({ path: `${SHOTS}/t${tid}-5-trainhit.png` });
    }

    if (!report.lapDone) failures.push({ tid, errors: ["lap not completed in 90s"] });
    if (errors.length) failures.push({ tid, errors: errors.slice(0, 4) });
    console.log(`track ${tid} (${report.name}): lap=${report.lapDone} y=${report.yMin}..${report.yMax}` +
      (report.tunnel ? " tunnel📸" : "") + (report.trap ? ` trap=${report.trap}` : "") +
      (report.boost ? ` ${report.boost}` : "") +
      (trf ? ` trainSeen=${report.trainSeen} trainHit=${report.trainHit}` : "") +
      ` errors=${errors.length}`);
  } catch (e) {
    failures.push({ tid, errors: ["EXCEPTION: " + e.message, ...errors.slice(0, 3)] });
    await page.screenshot({ path: `${SHOTS}/t${tid}-FAIL.png` }).catch(() => {});
    console.log(`track ${tid}: FAILED — ${e.message}`);
  }
  await page.close();
}

await browser.close();
console.log("\n=== RESULT ===");
if (failures.length) {
  for (const f of failures) console.log(`track ${f.tid}:`, f.errors.join(" | "));
  process.exit(2);
}
console.log("all tracks OK");
