// The real-world "non-host looks slow" case: the HOST's device renders slowly.
// With frame-based prediction the host under-advances the guest's car (slow);
// with time-based prediction the host should still see the guest at full speed.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] };
const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) { await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#create-room-btn", { timeout: 30000 }); }
await host.type("#name-input", "Host"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
await guest.type("#name-input", "Guest"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(700);
await host.click("#lobby-pick-btn"); await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.click("#lobby-pick-btn"); await guest.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 });
await host.click("#lobby-start-btn");
for (const p of [host, guest]) { await p.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 90000 }); await p.waitForFunction(() => window._raceEnded === false, { timeout: 30000 }); }
await sleep(500);

// hard-throttle the HOST's CPU so it renders few frames
const client = await host.target().createCDPSession();
await client.send("Emulation.setCPUThrottlingRate", { rate: 8 });

// guest drives at normal speed; measure its real motion AND the host's view of it
const guestP = guest.evaluate(() => new Promise((r) => {
  gameKeys["ArrowUp"] = true; const s = { x: playerCar.pos.x, z: playerCar.pos.z };
  setTimeout(() => { gameKeys["ArrowUp"] = false; r(+Math.hypot(playerCar.pos.x - s.x, playerCar.pos.z - s.z).toFixed(1)); }, 5000);
}));
const hostP = host.evaluate(() => new Promise((r) => {
  const rc = window._allCars.find(c => c.name.startsWith("net")); const s = { x: rc.pos.x, z: rc.pos.z };
  let frames = 0; const t = () => frames++; engine.onEndFrameObservable.add(t);
  const t0 = performance.now();
  setTimeout(() => { engine.onEndFrameObservable.removeCallback(t);
    r({ moved: +Math.hypot(rc.pos.x - s.x, rc.pos.z - s.z).toFixed(1), fps: +(frames / ((performance.now()-t0)/1000)).toFixed(1) }); }, 5000);
}));
const [guestMoved, hostView] = await Promise.all([guestP, hostP]);

console.log(`guest actually moved ${guestMoved}u in 5s (normal speed)`);
console.log(`throttled host (fps ${hostView.fps}) saw the guest move ${hostView.moved}u`);
const ratio = hostView.moved / (guestMoved || 1);
console.log(`ratio = ${ratio.toFixed(2)} (want ~1.0; <0.7 = "non-host looks slow")`);
console.log(ratio > 0.8 ? "\n✓ remote speed holds despite the host's low fps" : "\n✗ remote still looks slow");
await A.close(); await B.close();
process.exit(ratio > 0.8 ? 0 : 2);
