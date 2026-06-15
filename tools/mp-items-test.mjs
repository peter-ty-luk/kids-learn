// Multiplayer ITEM-SYNC + GHOST-DIZZY test (two real scenes, two browsers).
//   Issue 1 "remote players falsely appear dizzy": a ghost's dizzy/stun is now
//     driven SOLELY by the owner's fx bitmask — no local effect may re-set it.
//     Test: force the owner genuinely calm, inject a fake dizzy on its ghost,
//     and confirm the next packets clear it back to 0 (AI-proof: the owner is
//     pinned non-dizzy every frame, so anything the ghost shows is a local bug).
//   Issue 2 "special items not in sync": a remote player's item is replayed on
//     our client. Test banana (traps OWNED by the "net" ghost can only appear
//     via replication) and lightning (must zap our local player).
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 140)));
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
await host.click("#lobby-start-btn");
for (const p of [host, guest]) {
  await p.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 90000 });
  await p.waitForFunction(() => window._raceEnded === false, { timeout: 30000 });
}
await sleep(800);
console.log("both clients racing\n");

// Sanity: each side built a ghost for the other player.
const ghostsOK = await Promise.all([host, guest].map(p => p.evaluate(() =>
  window._allCars.filter(c => c.name.startsWith("net")).length)));
check("each client has the other player as a ghost", ghostsOK.every(n => n === 1), `host=${ghostsOK[0]} guest=${ghostsOK[1]}`);

// ---- Issue 1: ghost dizzy is owner-authoritative (no local false dizzy) ----
// Pin the GUEST genuinely calm every frame (so any AI zap can't make it report
// dizzy), then plant a fake dizzy on the HOST's ghost-of-guest and ram it.
await guest.evaluate(() => {
  window.__calm = () => { playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; };
  engine.onBeginFrameObservable.add(window.__calm);
});
await host.evaluate(() => {
  const g = window._allCars.find(c => c.name.startsWith("net"));
  g.dizzyTimer = 150; g.stunTimer = 150; // simulate the OLD local false-dizzy
  // also try to RAM it — if local collision still dizzied ghosts this would
  // keep re-inflating the timer.
  gameKeys["ArrowUp"] = true;
});
await sleep(1500);
const ghostDizzy = await host.evaluate(() => {
  gameKeys["ArrowUp"] = false;
  const g = window._allCars.find(c => c.name.startsWith("net"));
  return { dizzy: g.dizzyTimer, stun: g.stunTimer };
});
check("calm owner ⇒ its ghost is not dizzy (false dizzy cleared, never re-set)",
  ghostDizzy.dizzy === 0 && ghostDizzy.stun === 0, `dizzy=${ghostDizzy.dizzy} stun=${ghostDizzy.stun}`);
await guest.evaluate(() => { engine.onBeginFrameObservable.removeCallback(window.__calm); });

// ---- Issue 2a: a remote BANANA spawns traps on our client ----
// Traps OWNED by a "net" car can only exist via replication of the host's item
// (our own player/AI traps are owned by player/ai* cars), so this is AI-proof.
const netTraps = (p) => p.evaluate(() => (window._traps || [])
  .filter(t => t.owner && t.owner.name && t.owner.name.startsWith("net")).length);
const before = await netTraps(guest);
await host.evaluate(() => {
  playerCar.currentItem = "banana";
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
  // fallback if a quiz overlay swallowed the key — still emits the use-item
  if (playerCar.currentItem === "banana") { playerCar.currentItem = null; socket.emit("use-item", { item: "banana" }); }
});
await sleep(700);
const after = await netTraps(guest);
check("remote banana replicates as traps on our client", after - before >= 5, `net-owned traps ${before} → ${after}`);

// ---- Issue 2b: a remote LIGHTNING zaps our local player ----
await guest.evaluate(() => { playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.invincibleTimer = 0; playerCar.speed = 3; });
await host.evaluate(() => {
  playerCar.currentItem = "lightning";
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
  if (playerCar.currentItem === "lightning") { playerCar.currentItem = null; socket.emit("use-item", { item: "lightning" }); }
});
await sleep(200);
const zapped = await guest.evaluate(() => ({ dizzy: playerCar.dizzyTimer, stun: playerCar.stunTimer, speed: +playerCar.speed.toFixed(2) }));
// (timers tick down between strike and sample, so assert the unmistakable
// signature: speed crushed from 3 to a near-stop AND both timers engaged.)
check("remote lightning strikes our local player (dizzy + slowed)",
  zapped.dizzy > 0 && zapped.stun > 0 && zapped.speed < 1.5, `dizzy=${zapped.dizzy} stun=${zapped.stun} speed=${zapped.speed}`);

await A.close(); await B.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL ITEM-SYNC CHECKS PASS");
process.exit(fails.length ? 2 : 0);
