// LAN room-DISCOVERY test: a guest joins by TAPPING the room in the network
// list (no code typed). Verifies the /rooms endpoint + the tap-to-join wiring.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 140)));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
}

// Before any room exists, the guest's list shows the empty state.
await sleep(500);
const emptyState = await guest.evaluate(() => {
  const el = document.querySelector("#room-list .room-list-empty");
  return el ? el.textContent : null;
});
check("guest sees an empty-state message before any room exists", !!emptyState, emptyState || "");

// Host creates a room.
await host.type("#name-input", "Daddy");
await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
console.log("host room:", code);

// The /rooms endpoint should now advertise it as joinable.
const apiRooms = await guest.evaluate(() => fetch("/rooms").then(r => r.json()));
const adv = apiRooms.find(r => r.id === code);
check("/rooms advertises the new room (host name, joinable)", adv && adv.host === "Daddy" && adv.joinable === true && adv.count === 1,
  JSON.stringify(adv));

// The guest's list (polled ~2.5s) should render a tappable row WITHOUT typing.
await guest.type("#name-input", "Kiddo");
const rowAppeared = await guest.waitForFunction(
  () => document.querySelectorAll("#room-list .room-item").length === 1,
  { timeout: 6000 }).then(() => true).catch(() => false);
check("guest's network list shows the room as a tappable row", rowAppeared);
const rowText = await guest.evaluate(() => { const r = document.querySelector("#room-list .room-item .ri-name"); return r ? r.textContent : ""; });
check("row is labelled with the host's name", /Daddy/.test(rowText), JSON.stringify(rowText));

// TAP it (no code typed) → guest should land in the host's room.
await guest.evaluate(() => document.querySelector("#room-list .room-item").click());
const landed = await guest.waitForFunction(
  (c) => document.getElementById("room-info").style.display !== "none" &&
         document.getElementById("room-code").textContent.trim() === c,
  { timeout: 10000 }, code).then(() => true).catch(() => false);
check("tapping the room joins it (no code typed)", landed);

// Host now sees 2 players, and the room drops off the joinable list logic only
// at capacity — with 2/4 it's still joinable.
await sleep(700);
const hostCount = await host.evaluate(() => document.querySelectorAll("#players-list .player-item").length);
check("host sees both players after tap-join", hostCount === 2, `players=${hostCount}`);

await A.close(); await B.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL ROOM-LIST CHECKS PASS");
process.exit(fails.length ? 2 : 0);
