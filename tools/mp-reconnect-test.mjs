// Reconnect test: drop the guest's socket mid-race (network blip) and confirm
// the guest keeps its car/slot and position updates resume after it auto-rejoins.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = {
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
};
const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 120)));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
  await p.evaluate(() => engine.setHardwareScalingLevel(6));
}
await host.type("#name-input", "Host"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
await guest.type("#name-input", "Guest"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(700);
await host.evaluate(() => document.querySelector('.track-card[data-track-id="0"]').click());
await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 });
await host.click("#lobby-start-btn");
for (const p of [host, guest]) {
  await p.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 90000 });
  await p.waitForFunction(() => window._raceEnded === false, { timeout: 30000 });
}
await sleep(500);

const hostCars0 = await host.evaluate(() => window._allCars.filter(c => c.name.startsWith("net")).length);
console.log(`host network cars before drop: ${hostCars0}`);

// --- simulate a network blip on the GUEST: drop the socket, auto-reconnect ---
await guest.evaluate(() => { window._oldSid = socket.id; socket.disconnect(); setTimeout(() => socket.connect(), 1200); });
console.log("guest socket dropped…");
await sleep(3500); // outage + reconnect + re-join

const guestState = await guest.evaluate(() => ({
  raceRunning: window._raceEnded === false,
  hasPlayerCar: !!playerCar,
  reconnected: socket.connected && socket.id !== window._oldSid,
}));
console.log(`guest after reconnect: raceRunning=${guestState.raceRunning} hasCar=${guestState.hasPlayerCar} gotNewSocketId=${guestState.reconnected}`);

// host must still have the guest's car (not removed during the grace window)
const hostCars1 = await host.evaluate(() => window._allCars.filter(c => c.name.startsWith("net")).length);

// now drive the guest and confirm the host SEES it move again (updates flowing)
const moved = await Promise.all([
  guest.evaluate(() => new Promise((r) => { gameKeys["ArrowUp"] = true; const s = { x: playerCar.pos.x, z: playerCar.pos.z }; setTimeout(() => { gameKeys["ArrowUp"] = false; r(+Math.hypot(playerCar.pos.x - s.x, playerCar.pos.z - s.z).toFixed(1)); }, 3000); })),
  host.evaluate(() => new Promise((r) => { const rc = window._allCars.find(c => c.name.startsWith("net")); const s = { x: rc.pos.x, z: rc.pos.z }; setTimeout(() => r(+Math.hypot(rc.pos.x - s.x, rc.pos.z - s.z).toFixed(1)), 3000); })),
]);
const guestMoved = moved[0], hostSawMove = moved[1];

console.log(`host still has guest car: ${hostCars1 === 1 ? "✓" : "✗ (" + hostCars1 + ")"}`);
console.log(`after reconnect — guest drove ${guestMoved}u; host saw it move ${hostSawMove}u`);
console.log("\nchecks:");
console.log("  guest game kept running through the blip:", guestState.raceRunning && guestState.hasPlayerCar ? "✓" : "✗");
console.log("  guest got a fresh socket id (real reconnect):", guestState.reconnected ? "✓" : "✗");
console.log("  guest NOT kicked from room (car preserved):", hostCars1 === 1 ? "✓" : "✗");
console.log("  position updates flow again post-reconnect:", hostSawMove > guestMoved * 0.6 ? "✓" : "✗");
await A.close(); await B.close();
