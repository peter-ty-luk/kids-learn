// CUP (Grand Prix) test: the server races a list of tracks back to back and
// combines each track's position points into one overall ranking. Runs WITHOUT
// building WebGL scenes — race-start is stubbed and finishes are simulated by
// emitting race-finish — so it exercises the server orchestration + the client
// standings rendering fast. A short 2-track cup [0,1] keeps it quick.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=900,700"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const A = await puppeteer.launch(LAUNCH), B = await puppeteer.launch(LAUNCH);
const host = await A.newPage(), guest = await B.newPage();
for (const p of [host, guest]) {
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 160)));
  await p.goto("http://localhost:3077", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#create-room-btn", { timeout: 30000 });
}

// host creates, guest joins
await host.type("#name-input", "Host"); await host.click("#create-room-btn");
await host.waitForFunction(() => document.getElementById("room-code").textContent.trim().length >= 4, { timeout: 15000 });
const code = await host.evaluate(() => document.getElementById("room-code").textContent.trim());
await guest.type("#name-input", "Guest"); await guest.type("#join-input", code); await guest.click("#join-room-btn");
await sleep(700);

// both pick a ride (→ ready)
await host.click("#lobby-pick-btn"); await host.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await guest.click("#lobby-pick-btn"); await guest.evaluate(() => document.querySelectorAll(".car-card")[1].click());
await host.waitForFunction(() => document.getElementById("lobby-start-btn").style.display === "block", { timeout: 8000 });

const cupBtnShown = await host.evaluate(() => document.getElementById("lobby-cup-btn").style.display === "block");
check("host sees the Start Cup button once everyone's ready", cupBtnShown);
const guestNoCup = await guest.evaluate(() => document.getElementById("lobby-cup-btn").style.display !== "block");
check("guest does NOT see the Start Cup button (host-only)", guestNoCup);

const hostPid = await host.evaluate(() => myPlayerId);
const guestPid = await guest.evaluate(() => myPlayerId);

// Stub race-start so no scene builds; capture the cup tag + standings. (Keep the
// real cup-standings handler too, so the on-screen overlay is built and checked.)
for (const p of [host, guest]) {
  await p.evaluate(() => {
    window._starts = []; window._standingsLog = [];
    socket.off("race-start");
    socket.on("race-start", (d) => { window._lastStart = d; window._starts.push(d); window._cupMode = !!d.cup; });
    socket.on("cup-standings", (d) => { window._standingsLog.push(d); });
  });
}

// Start a 2-track cup directly (the real button sends all 8; 2 keeps the test short).
await host.evaluate(() => socket.emit("start-cup", { trackIds: [0, 1] }));

// --- TRACK 1 of 2 ---
for (const p of [host, guest]) await p.waitForFunction(() => window._lastStart && window._lastStart.cup && window._lastStart.cupTrackIndex === 0, { timeout: 20000 });
const t0tag = await host.evaluate(() => window._lastStart);
check("cup race 1 starts tagged cup 1/2", t0tag.cup === true && t0tag.cupTrackIndex === 0 && t0tag.cupTotal === 2, JSON.stringify({ cup: t0tag.cup, i: t0tag.cupTrackIndex, n: t0tag.cupTotal }));

// host finishes first (lower time), guest second
await host.evaluate(() => socket.emit("race-finish", { finishTime: 100 }));
await guest.evaluate(() => socket.emit("race-finish", { finishTime: 200 }));

for (const p of [host, guest]) await p.waitForFunction(() => window._standingsLog.length >= 1, { timeout: 15000 });
const s0 = await host.evaluate(() => window._standingsLog[0]);
const pts0 = Object.fromEntries(s0.standings.map(s => [s.pid, s.points]));
check("track 1 standings: not final", s0.final === false);
check("track 1 points: 1st=+10, 2nd=+7 (host won)", pts0[hostPid] === 10 && pts0[guestPid] === 7, `host=${pts0[hostPid]} guest=${pts0[guestPid]}`);

// --- TRACK 2 of 2 (server auto-advances after the standings hold) ---
for (const p of [host, guest]) await p.waitForFunction(() => window._lastStart && window._lastStart.cupTrackIndex === 1, { timeout: 25000 });
check("cup auto-advances to race 2/2 (no host click)", true);

// host wins again → clear champion
await host.evaluate(() => socket.emit("race-finish", { finishTime: 100 }));
await guest.evaluate(() => socket.emit("race-finish", { finishTime: 200 }));

for (const p of [host, guest]) await p.waitForFunction(() => window._standingsLog.some(s => s.final), { timeout: 15000 });
const sf = await host.evaluate(() => window._standingsLog.find(s => s.final));
const ptsf = Object.fromEntries(sf.standings.map(s => [s.pid, s.points]));
check("final standings flagged final", sf.final === true);
check("points COMBINE across both tracks: host 20, guest 14", ptsf[hostPid] === 20 && ptsf[guestPid] === 14, `host=${ptsf[hostPid]} guest=${ptsf[guestPid]}`);
check("overall winner is the host (most combined points)", sf.standings[0].pid === hostPid);
check("exactly two standings screens (one per track)", (await host.evaluate(() => window._standingsLog.length)) === 2);

// --- detailed per-track breakdown in the payload ---
check("final payload carries results for BOTH tracks", Array.isArray(sf.results) && sf.results.length === 2, `len=${sf.results && sf.results.length}`);
const t1 = sf.results[0], t2 = sf.results[1];
const hostT1 = t1.ranking.find(r => r.pid === hostPid), guestT1 = t1.ranking.find(r => r.pid === guestPid);
check("track 1 detail: host rank 1 +10, guest rank 2 +7",
  hostT1.rank === 1 && hostT1.points === 10 && guestT1.rank === 2 && guestT1.points === 7,
  `host=${hostT1.rank}/${hostT1.points} guest=${guestT1.rank}/${guestT1.points}`);
check("each track result records its trackId", t1.trackId === 0 && t2.trackId === 1, `${t1.trackId},${t2.trackId}`);

// --- detailed table actually rendered on screen ---
const tbl = await host.evaluate(() => {
  const t = document.querySelector("#cup-standings-overlay .cup-detail");
  if (!t) return null;
  return {
    cols: t.querySelectorAll("thead th").length,
    rows: t.querySelectorAll("tbody tr").length,
    firstRow: t.querySelector("tbody tr").textContent.replace(/\s+/g, " ").trim(),
    wins: t.querySelectorAll("td.cd-cell.win").length,
    latest: t.querySelectorAll(".cd-latest").length,
  };
});
check("breakdown table rendered (Racer + 2 tracks + Σ = 4 cols)", tbl && tbl.cols === 4, tbl ? `cols=${tbl.cols}` : "no table");
check("breakdown has a row per player", tbl && tbl.rows === 2, tbl ? `rows=${tbl.rows}` : "");
check("leader row shows per-track points + total (e.g. +10 … 20)", tbl && /\+10/.test(tbl.firstRow) && /20/.test(tbl.firstRow), tbl ? JSON.stringify(tbl.firstRow) : "");
check("each track's winner cell is highlighted (2 wins: host won both)", tbl && tbl.wins === 2, tbl ? `wins=${tbl.wins}` : "");
check("the just-finished track column is marked latest", tbl && tbl.latest >= 1, tbl ? `latest=${tbl.latest}` : "");

// client rendering: the champion overlay is on screen for both
await sleep(400);
const champText = await host.evaluate(() => { const el = document.getElementById("cup-standings-overlay"); return el ? el.textContent : ""; });
check("champion overlay rendered on the host", /CHAMPION/i.test(champText) && /win/i.test(champText), JSON.stringify(champText.slice(0, 80)));
const hostHasBtn = await host.evaluate(() => !!(document.querySelector("#cup-standings-overlay button")));
const guestHasBtn = await guest.evaluate(() => !!(document.querySelector("#cup-standings-overlay button")));
check("host gets a Back-to-Lobby button on the final screen", hostHasBtn);
check("guest does NOT get the host button", !guestHasBtn);

await A.close(); await B.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL CUP CHECKS PASS");
process.exit(fails.length ? 2 : 0);
