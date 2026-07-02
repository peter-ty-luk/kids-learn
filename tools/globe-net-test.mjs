// Globe Quiz ONLINE multiplayer test. Two browsers (WebGL → swiftshader, two heavy
// tabs in one browser crash). Host creates a room, guest joins, host starts; each
// round both answer (host accurate+fast, guest far); server scores accuracy×speed
// and the host should win.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"], protocolTimeout: 240000 };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };
const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 150)));
  await p.goto("http://localhost:3077/globe.html", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.GLOBE && GLOBE.ready === true, { timeout: 60000 });
}

// host creates a room
await host.evaluate(() => { document.getElementById("online-name").value = "Host"; GLOBE.opts.rounds = 3; GLOBE.opts.diff = "easy"; GLOBE.opts.clue = "name"; GLOBE.netCreate(); });
await host.waitForFunction(() => GLOBE.net && GLOBE.net.roomId, { timeout: 10000 });
const code = await host.evaluate(() => GLOBE.net.roomId);
check("host creates an online room", !!code, `code=${code}`);

// guest joins
await guest.evaluate((c) => { document.getElementById("online-name").value = "Guest"; document.getElementById("online-code").value = c; GLOBE.netJoin(); }, code);
await host.waitForFunction(() => GLOBE.net.players.length === 2, { timeout: 10000 });
await guest.waitForFunction(() => GLOBE.net.players.length === 2, { timeout: 10000 });
check("guest joins; both see 2 players in the lobby", true);
check("lobby shows the room code + player rows", await host.evaluate(() => document.getElementById("lobby-code").textContent === GLOBE.net.roomId && document.querySelectorAll("#lobby-players .lead-row").length === 2));

// host starts
await host.evaluate(() => GLOBE.netStart());
for (const p of [host, guest]) await p.waitForFunction(() => GLOBE.online === true, { timeout: 10000 });
check("host starts → both clients enter the quiz", true);

// answer each round: host exact+instant, guest 40° off (far)
async function answer(p, offset) {
  await p.waitForFunction(() => GLOBE.net.phase === "guess" && GLOBE.net.q, { timeout: 12000 });
  await p.evaluate((off) => {
    const place = GLOBE.PLACES.find((x) => x.name === GLOBE.net.q.name) || GLOBE.COUNTRIES.find((x) => x.name === GLOBE.net.q.name);
    GLOBE.pick({ lon: place.lon + off, lat: place.lat + (off ? 20 : 0) });
    GLOBE.lock();
  }, offset);
}
let perRound2 = false, sawAnswered = false;
for (let r = 0; r < 3; r++) {
  await answer(host, 0);          // exact + immediate
  await sleep(150);
  await answer(guest, 40);        // far
  // wait for the reveal to arrive at the host
  await host.waitForFunction(() => GLOBE.net.phase === "reveal", { timeout: 12000 });
  const rd = await host.evaluate(() => ({ rows: document.querySelectorAll("#reveal-rows .rev-row").length, status: document.getElementById("net-status").textContent }));
  if (rd.rows === 2) perRound2 = true;
  // (server auto-advances ~6.5s; wait for next question unless last round)
  if (r < 2) await host.waitForFunction(() => GLOBE.net.phase === "guess", { timeout: 15000 });
}
check("each round reveals both players' guesses", perRound2);

// final standings
for (const p of [host, guest]) await p.waitForFunction(() => GLOBE.net.phase === "done", { timeout: 20000 });
const fin = await host.evaluate(() => {
  const rows = [...document.querySelectorAll("#results-rows .lead-row")].map((r) => r.textContent);
  const s = GLOBE.net; // standings not stored, read from server-rendered rows
  return { rows, title: document.getElementById("results-title").textContent };
});
check("final results screen shows a leaderboard", fin.rows.length === 2, JSON.stringify(fin.rows));
check("the accurate + fast host wins", /You win/i.test(fin.title) , JSON.stringify(fin.title));

await A.close(); await B.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL GLOBE-NET CHECKS PASS");
process.exit(fails.length ? 2 : 0);
