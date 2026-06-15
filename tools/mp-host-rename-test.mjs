// Host re-election + room rename. No 3D scenes — pure room/socket flow.
//   Re-election: when the host leaves, the first remaining player inherits the
//     room (host controls switch on) and an empty room closes.
//   Rename: the host can rename the room; everyone + the LAN list see the name;
//     non-hosts can't rename.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=820,640"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 160)));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
}

// --- host creates → default room name + rename control ---
await host.type("#name-input", "Host"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());

const nm0 = await host.evaluate(() => document.getElementById("room-name").textContent);
check("new room gets a default name", nm0 === "Host's Room", JSON.stringify(nm0));
const renameVisible = await host.evaluate(() => document.getElementById("room-rename-btn").style.display !== "none");
check("host sees the rename (✏️) control", renameVisible);

let api = await host.evaluate(() => fetch("/rooms").then(r => r.json()));
check("/rooms advertises the room name", (api.find(r => r.id === code) || {}).name === "Host's Room");

// --- host renames via the UI ---
await host.click("#room-rename-btn");
await host.evaluate(() => { document.getElementById("room-name-input").value = "Kids Grand Prix"; });
await host.click("#room-rename-save");
await host.waitForFunction(() => document.getElementById("room-name").textContent === "Kids Grand Prix", { timeout: 5000 }).catch(() => {});
const nm1 = await host.evaluate(() => document.getElementById("room-name").textContent);
check("host rename updates the room title", nm1 === "Kids Grand Prix", JSON.stringify(nm1));
api = await host.evaluate(() => fetch("/rooms").then(r => r.json()));
check("renamed room shows in the LAN list", (api.find(r => r.id === code) || {}).name === "Kids Grand Prix");

// --- guest joins → sees the renamed room, has no rename control ---
await guest.type("#name-input", "Guest"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(800);
const guestSeesName = await guest.evaluate(() => document.getElementById("room-name").textContent);
check("joiner sees the current room name", guestSeesName === "Kids Grand Prix", JSON.stringify(guestSeesName));
const guestNoRename = await guest.evaluate(() => document.getElementById("room-rename-btn").style.display === "none");
check("guest does NOT get the rename control", guestNoRename);
const guestIsHost0 = await guest.evaluate(() => isHost);
check("guest is not the host", guestIsHost0 === false);

// non-host rename is rejected by the server
await guest.evaluate(() => socket.emit("rename-room", { name: "Hacked" }));
await sleep(500);
const stillNamed = await host.evaluate(() => document.getElementById("room-name").textContent);
check("a non-host cannot rename the room", stillNamed === "Kids Grand Prix", JSON.stringify(stillNamed));

// --- both ready, then the HOST leaves → guest inherits the room ---
await host.click("#lobby-pick-btn"); await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.click("#lobby-pick-btn"); await guest.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await guest.waitForFunction(() => document.querySelectorAll("#players-list .player-item").length === 2, { timeout: 8000 });

const guestPid = await guest.evaluate(() => myPlayerId);
// host quits (manual socket close → no auto-reconnect)
await host.evaluate(() => socket.disconnect());

const promoted = await guest.waitForFunction(() => isHost === true, { timeout: 10000 }).then(() => true).catch(() => false);
check("guest is promoted to host when the host leaves", promoted);
const guestHostId = await guest.evaluate(() => currentHostId);
check("server names the guest as the new host", guestHostId === guestPid);
const nowControls = await guest.evaluate(() => ({
  rename: document.getElementById("room-rename-btn").style.display !== "none",
  start: document.getElementById("lobby-start-btn").style.display === "block",
  cup: document.getElementById("lobby-cup-btn").style.display === "block",
}));
check("promoted guest gets the rename control", nowControls.rename);
check("promoted guest gets Start + Cup (still the only ready player)", nowControls.start && nowControls.cup);
const hostTag = await guest.evaluate(() => {
  const items = [...document.querySelectorAll("#players-list .player-item .player-name")].map(n => n.textContent);
  return items.find(t => /\(Host\)/.test(t)) || "";
});
check("players list marks the new host", /Guest \(Host\)/.test(hostTag), JSON.stringify(hostTag));

// the promoted host can actually rename now
await guest.evaluate(() => socket.emit("rename-room", { name: "Guest's Room" }));
await guest.waitForFunction(() => document.getElementById("room-name").textContent === "Guest's Room", { timeout: 5000 }).then(() => check("the new host can rename", true)).catch(() => check("the new host can rename", false));

await A.close(); await B.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL HOST/RENAME CHECKS PASS");
process.exit(fails.length ? 2 : 0);
