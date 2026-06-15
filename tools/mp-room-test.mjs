// Multiplayer ROOM-FLOW test (fixes 6 & 7) — no 3D scenes are built, so it
// runs fast: tests the server join guard, ready/start gating, and the
// play-again room reset loop end-to-end over real sockets.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = {
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=800,600"],
  protocolTimeout: 240000,
};
// two SEPARATE browser processes — two heavy tabs in one browser kept
// crashing the renderer under software GL
const browserA = await puppeteer.launch(LAUNCH);
const browserB = await puppeteer.launch(LAUNCH);
const results = [];
const check = (label, ok) => { results.push({ label, ok }); console.log(`  ${label}: ${ok ? "✓" : "✗"}`); };

console.log("browsers launched");
const host = await browserA.newPage();
const guest = await browserB.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 120)));
  p.on("error", (e) => console.log("PAGE CRASHED:", e.message));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  console.log("page loaded");
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
  console.log("lobby visible");
}

// --- host creates a room ---
console.log("typing name…");
await host.type("#name-input", "Host");
console.log("name typed");
await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
console.log("room:", code);

// --- guest joins, firing join TWICE (the old double-join bug) ---
await guest.type("#name-input", "Guest");
await guest.type("#join-input", code);
await guest.click("#join-room-btn");
await guest.evaluate(() => {
  // bypass the client-side lock to hammer the server directly — a real double
  // click sends the SAME stable clientId, which the server must dedup (re-bind),
  // not add as a ghost player.
  socket.emit("join-room", { roomId: document.getElementById("join-input").value.trim().toUpperCase(), name: "Guest", clientId: window.clientId }, () => {});
});
await sleep(900);
const playersSeen = await host.evaluate(() => document.querySelectorAll("#players-list .player-item").length);
check("double-join leaves exactly 2 players (server guard)", playersSeen === 2);

// --- create/join lands in the LOBBY first (no forced car/track selection) ---
for (const [name, p] of [["host", host], ["guest", guest]]) {
  const st = await p.evaluate(() => ({
    room: document.getElementById("room-info").style.display !== "none",
    carHidden: document.getElementById("car-select-overlay").style.display === "none",
    menuHidden: document.getElementById("lobby-menu").style.display === "none",
    pickBtn: document.getElementById("lobby-pick-btn").offsetParent !== null,
  }));
  check(`${name}: lands in lobby (no car-select forced)`, st.room && st.carHidden && st.menuHidden && st.pickBtn);
}

// --- track is chosen IN THE ROOM (host-only dropdown); vehicle via the picker ---
const hostTrackPicker = await host.evaluate(() => document.getElementById("room-track").style.display !== "none");
check("host sees the in-room track picker", hostTrackPicker);
const guestNoTrack = await guest.evaluate(() => document.getElementById("room-track").style.display === "none");
check("guest does NOT see the track picker (host-only)", guestNoTrack);
await host.select("#room-track", "0");
await host.evaluate(() => document.getElementById("room-track").dispatchEvent(new Event("change", { bubbles: true })));

await host.click("#lobby-pick-btn");
await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.click("#lobby-pick-btn");
await guest.evaluate(() => document.querySelectorAll(".car-card")[2].click());

const backInLobby = await host.evaluate(() => document.getElementById("car-select-overlay").style.display === "none" && document.getElementById("room-info").style.display !== "none");
check("picking a car returns to the lobby", backInLobby);
const startShown = await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 }).then(() => true).catch(() => false);
check("host can start once everyone is ready", startShown);

// --- simulate the end of a race: both clients show the race-over overlay,
//     then the host hits Play Again (reset-room) ---
for (const p of [host, guest]) {
  await p.evaluate(() => {
    const ov = document.createElement("div");
    ov.id = "play-again-overlay";
    document.body.appendChild(ov);
  });
}
await host.evaluate(() => socket.emit("reset-room"));
await sleep(900);

for (const [name, p] of [["host", host], ["guest", guest]]) {
  const st = await p.evaluate(() => ({
    overlayGone: !document.getElementById("play-again-overlay"),
    lobby: document.getElementById("room-info").style.display !== "none" && document.getElementById("car-select-overlay").style.display === "none",
    roomCode: document.getElementById("room-code").textContent.trim(),
  }));
  check(`${name}: waiting overlay removed after reset`, st.overlayGone);
  check(`${name}: back in the SAME room's lobby`, st.lobby && st.roomCode === code);
}

// --- re-pick for race #2: host changes track (in-room), both re-choose vehicles ---
const hostTrack = await host.evaluate(() => document.getElementById("room-track").style.display !== "none");
check("host: in-room track picker available again", hostTrack);
await host.select("#room-track", "4");
await host.evaluate(() => document.getElementById("room-track").dispatchEvent(new Event("change", { bubbles: true })));
await host.click("#lobby-pick-btn");
await host.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await guest.click("#lobby-pick-btn");
await guest.evaluate(() => document.querySelectorAll(".car-card")[3].click());
await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 });
// replace the race-start handler so no WebGL scene build begins
for (const p of [host, guest]) {
  await p.evaluate(() => {
    window._sceneCalls = 0;
    socket.off("race-start");
    socket.on("race-start", (data) => { window._sceneCalls++; window._gotTrackId = data.trackId; });
  });
}
await host.click("#lobby-start-btn");
let cd2 = true;
for (const p of [host, guest]) {
  await p.waitForFunction(() => document.getElementById("countdown-overlay").style.display === "flex", { timeout: 15000 }).catch(() => { cd2 = false; });
}
check("race 2 countdown reached both clients", cd2);
const started2 = await Promise.all([host, guest].map(p =>
  p.waitForFunction(() => window._sceneCalls > 0, { timeout: 15000 }).then(() => true).catch(() => false)));
const track2 = await guest.evaluate(() => window._gotTrackId);
check("race 2 start event reached both clients", started2.every(Boolean));
check("race 2 uses the newly picked track (Formula GP)", track2 === 4);

await browserA.close();
await browserB.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL MULTIPLAYER CHECKS PASS");
process.exit(fails.length ? 2 : 0);
