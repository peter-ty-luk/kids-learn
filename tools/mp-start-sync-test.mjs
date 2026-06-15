// Race-START fairness: (1) players spawn on DISTINCT grid slots agreed by every
// client (no pile-up on the same spot), and (2) the GO is held until EVERY
// client's scene is built — a fast-loading host can't launch early.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const carPos = (p) => p.evaluate(() => {
  const g = window._allCars.find(c => c.name.startsWith("net"));
  return { me: { x: playerCar.pos.x, z: playerCar.pos.z }, ghost: g ? { x: g.pos.x, z: g.pos.z } : null };
});

const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 160)));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
}
await host.type("#name-input", "Host"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
await guest.type("#name-input", "Guest"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(700);
await host.click("#lobby-pick-btn"); await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.click("#lobby-pick-btn"); await guest.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 });

// Make the GUEST report 'race-ready' 4s late — simulates a slow loader. The host
// loads fast; the barrier must still hold it back.
await guest.evaluate(() => {
  const orig = socket.emit.bind(socket);
  socket.emit = (ev, ...a) => {
    if (ev === "race-ready") { setTimeout(() => orig("race-ready", ...a), 4000); return socket; }
    return orig(ev, ...a);
  };
});

await host.click("#lobby-start-btn");

// Both scenes build (race-start isn't delayed — only the guest's ready signal is).
for (const p of [host, guest]) await p.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 90000 });

// --- barrier: host is loaded but the guest hasn't reported ready, so the host
//     must still be holding (not launched). _raceEnded flips false only at GO. ---
const heldNow = await host.evaluate(() => window._raceEnded !== false);
check("host holds at the grid right after loading (guest not ready yet)", heldNow);
await sleep(2500);
const stillHeld = await host.evaluate(() => window._raceEnded !== false);
check("host is STILL held ~2.5s later (no head start while guest loads)", stillHeld);

// --- once the guest reports (≈4s) the server releases GO; both launch ---
const launched = await Promise.all([host, guest].map(p =>
  p.waitForFunction(() => window._raceEnded === false, { timeout: 15000 }).then(() => true).catch(() => false)));
check("both clients launch together after everyone is ready", launched.every(Boolean));

// let positions settle with NO input (cars sit on their slots / just-launched)
await sleep(1200);
const hp = await carPos(host), gp = await carPos(guest);

// --- grid: each player on a DISTINCT slot (not stacked) ---
check("host and the other kart are NOT on the same spot", hp.ghost && dist(hp.me, hp.ghost) > 2, hp.ghost ? `gap=${dist(hp.me, hp.ghost).toFixed(1)}` : "no ghost");
check("guest and the other kart are NOT on the same spot", gp.ghost && dist(gp.me, gp.ghost) > 2, gp.ghost ? `gap=${dist(gp.me, gp.ghost).toFixed(1)}` : "no ghost");

// --- consistency: both clients AGREE where each player stands (the real fix) ---
check("host's car == guest's view of the host", gp.ghost && dist(hp.me, gp.ghost) < 2.5, gp.ghost ? `Δ=${dist(hp.me, gp.ghost).toFixed(2)}` : "");
check("guest's car == host's view of the guest", hp.ghost && dist(gp.me, hp.ghost) < 2.5, hp.ghost ? `Δ=${dist(gp.me, hp.ghost).toFixed(2)}` : "");

await A.close(); await B.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL START-SYNC CHECKS PASS");
process.exit(fails.length ? 2 : 0);
