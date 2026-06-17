// Pair Maze test. Canvas game, so drive it through window.MZ (state +
// move/teleport/drop) rather than pixels. Covers: maze solvable, wall blocking,
// carry-one + match, win on exit, guard catch, moving door blocks, dark fog,
// and 2-player separate item sets.
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=900,900"] });
const page = await browser.newPage();
let pageErrors = 0; page.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 160)); });
await page.goto("http://localhost:3077/maze.html", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.MZ && MZ.sets && MZ.sets.length > 0, { timeout: 15000 }).catch(() => {});
check("setup loads pair-sets", await page.evaluate(() => !!(window.MZ && MZ.sets && MZ.sets.length)), "");

// configure a single-player, lit, no-trap medium maze and start
async function startWith(opts) {
  await page.evaluate((o) => { Object.assign(MZ.opts, o); MZ.start(); }, opts);
  await page.waitForFunction(() => MZ.state && MZ.state.status === "playing", { timeout: 8000 });
}
await startWith({ players: 1, size: "medium", dark: false, traps: false, subject: null });

const lvl = await page.evaluate(() => ({
  items: MZ.state.items.length, pairs: MZ.state.nPairs, players: MZ.state.players.length,
  startFloor: MZ.state.maze.g[MZ.state.players[0].y][MZ.state.players[0].x],
}));
check("level built: items = pairs×2, player on a floor tile", lvl.items === lvl.pairs * 2 && lvl.startFloor === 0, JSON.stringify(lvl));

// maze is fully connected (every floor reachable from the player) → solvable
const connected = await page.evaluate(() => {
  const m = MZ.state.maze, p = MZ.state.players[0];
  const seen = new Set([p.x + "," + p.y]); const q = [[p.x, p.y]]; let floors = 0;
  for (let y = 0; y < m.GH; y++) for (let x = 0; x < m.GW; x++) if (m.g[y][x] === 0) floors++;
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) { const nx = x+dx, ny = y+dy; if (nx<0||ny<0||nx>=m.GW||ny>=m.GH) continue; if (m.g[ny][nx] !== 0) continue; const k = nx+","+ny; if (!seen.has(k)) { seen.add(k); q.push([nx, ny]); } } }
  return { reached: seen.size, floors };
});
check("maze is fully connected (solvable)", connected.reached === connected.floors, JSON.stringify(connected));

// wall blocks movement: try to move into a wall, expect no position change
const wallBlock = await page.evaluate(() => {
  const p = MZ.state.players[0];
  // find a direction that faces a wall
  const dirs = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
  for (const [d, [dx, dy]] of Object.entries(dirs)) {
    if (MZ.state.maze.g[p.y+dy] && MZ.state.maze.g[p.y+dy][p.x+dx] === 1) {
      const before = [p.x, p.y]; const moved = MZ.move(0, d); return { moved, stayed: p.x === before[0] && p.y === before[1] };
    }
  }
  return { moved: false, stayed: true };
});
check("walls block movement", wallBlock.moved === false && wallBlock.stayed, JSON.stringify(wallBlock));

// carry-one + match: teleport onto a left item (pick up), onto its right (match)
const matchFlow = await page.evaluate(() => {
  const p = MZ.state.players[0];
  const L = MZ.state.items.find(it => it.side === "left" && !it.matched);
  const R = MZ.state.items.find(it => it.side === "right" && it.pairId === L.pairId);
  MZ.teleport(0, L.x, L.y); const carried = p.carrying && p.carrying === L;
  // walking onto a non-partner item while carrying must NOT pick it up
  const other = MZ.state.items.find(it => !it.matched && !it.carried && it.pairId !== L.pairId);
  let keptCarry = true;
  if (other) { MZ.teleport(0, other.x, other.y); keptCarry = p.carrying === L && !other.carried; MZ.teleport(0, L.x, L.y); }
  MZ.teleport(0, R.x, R.y); const matched = L.matched && R.matched && !p.carrying && p.matched === 1;
  return { carried, keptCarry, matched };
});
check("picks up one piece when empty-handed", matchFlow.carried);
check("carrying ≠ partner does NOT pick up a second piece (carry only one)", matchFlow.keptCarry);
check("stepping the carried piece onto its partner matches the pair", matchFlow.matched);

// finish: match all pairs, exit locked until then, then reach exit → win
const winFlow = await page.evaluate(() => {
  const p = MZ.state.players[0];
  // exit should be locked now (not all matched)
  MZ.teleport(0, p.exit.x, p.exit.y); const lockedBefore = MZ.state.status === "playing" && !p.done;
  // match every remaining pair
  for (let pid = 0; pid < p.total; pid++) {
    if (MZ.state.items.some(it => it.pairId === pid && it.matched)) continue;
    const L = MZ.state.items.find(it => it.pairId === pid && it.side === "left");
    const R = MZ.state.items.find(it => it.pairId === pid && it.side === "right");
    MZ.teleport(0, L.x, L.y); MZ.teleport(0, R.x, R.y);
  }
  const allMatched = p.matched === p.total;
  MZ.teleport(0, p.exit.x, p.exit.y);
  return { lockedBefore, allMatched, done: p.done, status: MZ.state.status, winner: MZ.state.winner };
});
check("exit is locked until all pairs are matched", winFlow.lockedBefore);
check("matching all pairs then reaching the exit wins", winFlow.allMatched && winFlow.done && winFlow.status === "over" && winFlow.winner === 0, JSON.stringify(winFlow));
check("win overlay shown", await page.evaluate(() => document.getElementById("win-overlay").style.display === "flex"));

// ---- TRAPS: guard catch + moving door ----
await page.evaluate(() => document.getElementById("win-overlay").style.display = "none");
await startWith({ players: 1, size: "medium", dark: false, traps: true });
const trap = await page.evaluate(() => ({ guards: MZ.state.guards.length, doors: MZ.state.doors.length }));
check("traps mode spawns guards and doors", trap.guards >= 1 && trap.doors >= 1, JSON.stringify(trap));

const caught = await page.evaluate(() => {
  const p = MZ.state.players[0];
  // give the player a carried item, then place a guard on them and resolve catch
  const L = MZ.state.items.find(it => it.side === "left" && !it.matched); MZ.teleport(0, L.x, L.y);
  const hadCarry = !!p.carrying;
  MZ.state.guards[0].x = p.x; MZ.state.guards[0].y = p.y;
  MZ.checkCatch();
  return { hadCarry, atStart: p.x === p.sx && p.y === p.sy, dropped: !p.carrying, stunned: p.stun > 0, itemReturned: L.x === L.ox && L.y === L.oy };
});
check("guard catch: drops the carried piece (back to its spot), sends player to start, stuns",
  caught.hadCarry && caught.atStart && caught.dropped && caught.stunned && caught.itemReturned, JSON.stringify(caught));

const door = await page.evaluate(() => {
  const d = MZ.state.doors[0];
  d.open = false; const closedBlocks = !MZ.passable(d.x, d.y);
  d.open = true; const openPasses = MZ.passable(d.x, d.y);
  const onFloor = MZ.state.maze.g[d.y][d.x] === 0;
  return { closedBlocks, openPasses, onFloor };
});
check("moving door: closed blocks the path, open lets you through", door.closedBlocks && door.openPasses && door.onFloor, JSON.stringify(door));

// ---- DARK maze fog ----
await startWith({ players: 1, size: "medium", dark: true, traps: false });
const fog = await page.evaluate(() => {
  const m = MZ.state.maze; let hidden = 0, vis = 0;
  for (let y = 0; y < m.GH; y++) for (let x = 0; x < m.GW; x++) { if (m.g[y][x] === 0) { (MZ.state.visible.has(x+","+y) ? vis++ : hidden++); } }
  const p = MZ.state.players[0]; const near = MZ.state.visible.has(p.x+","+p.y);
  return { hidden, vis, near, switches: MZ.state.switches.length };
});
check("dark maze: most tiles hidden, player's own tile visible", fog.hidden > fog.vis && fog.near, JSON.stringify(fog));
check("dark maze: has light switches", fog.switches >= 1);
const litUp = await page.evaluate(() => {
  const s = MZ.state.switches[0]; const before = MZ.state.lit.size;
  MZ.teleport(0, s.x, s.y); // step on switch
  return { used: s.used, litGrew: MZ.state.lit.size > before };
});
check("stepping a switch lights a room", litUp.used && litUp.litGrew, JSON.stringify(litUp));

// ---- HIDDEN PAIRS: pieces face-down until you step on them ----
await startWith({ players: 1, size: "medium", dark: false, traps: false, hidden: true });
const hid = await page.evaluate(() => {
  const p = MZ.state.players[0];
  // an item not under the player and never visited → face-down (not revealed)
  const far = MZ.state.items.find(it => !(it.x === p.x && it.y === p.y));
  const hiddenAtStart = MZ.revealed(far) === false;
  // pick up one piece, then step onto a NON-matching own piece → it peeks (reveals) but isn't picked up
  const L = MZ.state.items.find(it => it.side === "left"); MZ.teleport(0, L.x, L.y);
  const carrying = p.carrying === L;
  const other = MZ.state.items.find(it => !it.matched && !it.carried && it.pairId !== L.pairId && it.owner === 0);
  MZ.teleport(0, other.x, other.y);
  const peeked = MZ.revealed(other) === true && p.carrying === L && !other.carried;
  // step away — within the linger window it stays revealed, and it's still on the board (not matched)
  const stillThere = !other.matched && !!other.revealUntil;
  return { hiddenAtStart, carrying, peeked, stillThere };
});
check("hidden mode: pieces are face-down (not disclosed) at first", hid.hiddenAtStart);
check("hidden mode: stepping a non-matching piece reveals it but doesn't pick it up", hid.carrying && hid.peeked && hid.stillThere, JSON.stringify(hid));

// ---- 2-PLAYER: separate colour-coded item sets ----
await startWith({ players: 2, size: "medium", dark: false, traps: false, hidden: false });
const two = await page.evaluate(() => {
  const o0 = MZ.state.items.filter(it => it.owner === 0).length, o1 = MZ.state.items.filter(it => it.owner === 1).length;
  return { players: MZ.state.players.length, o0, o1, exitsDiffer: JSON.stringify(MZ.state.players[0].exit) !== JSON.stringify(MZ.state.players[1].exit) };
});
check("2-player: two players with their own item sets", two.players === 2 && two.o0 > 0 && two.o1 > 0 && two.o0 === two.o1, JSON.stringify(two));
check("2-player: separate exits", two.exitsDiffer);
const p2win = await page.evaluate(() => {
  const p = MZ.state.players[1];
  for (let pid = 0; pid < p.total; pid++) { const L = MZ.state.items.find(it => it.owner===1 && it.pairId===pid && it.side==="left"); const R = MZ.state.items.find(it => it.owner===1 && it.pairId===pid && it.side==="right"); MZ.teleport(1, L.x, L.y); MZ.teleport(1, R.x, R.y); }
  MZ.teleport(1, p.exit.x, p.exit.y);
  return { winner: MZ.state.winner, status: MZ.state.status };
});
check("2-player: player 2 can win by matching all + exiting", p2win.winner === 1 && p2win.status === "over", JSON.stringify(p2win));

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await browser.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL MAZE CHECKS PASS");
process.exit(fails.length ? 2 : 0);
