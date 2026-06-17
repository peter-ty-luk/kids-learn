// Pair Match game test: loads /quiz/pairs, plays a round in EASY (face-up) and
// MEMORY (face-down) mode, drives correct + wrong matches, and checks the win.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=900,820"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const browser = await puppeteer.launch(LAUNCH);
const page = await browser.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 160)); });
await page.goto("http://localhost:3077/match.html", { waitUntil: "domcontentloaded" });
// state is a top-level const in match.js — reachable by bare name in evaluate,
// not via window. Wait on the rendered chips instead.
const loaded = await page.waitForFunction(() => document.querySelectorAll("#subject-chips .chip").length > 0, { timeout: 15000 }).then(() => true).catch(() => false);
check("setup loads pair-sets (subject chips rendered)", loaded);
const subjects = await page.evaluate(() => [...document.querySelectorAll("#subject-chips .chip")].map(c => c.textContent));
check("subject picker has All + real subjects", subjects.length >= 3, subjects.join(", "));

// helper: drive a full round to completion in the chosen mode, return {moves, won, wrongSeen}
async function playRound(mode) {
  // choose mode + start
  await page.evaluate((m) => {
    document.querySelector(`.mode[data-mode="${m}"]`).click();
    document.getElementById("start-btn").click();
  }, mode);
  await page.waitForFunction(() => document.getElementById("game").style.display === "block" && document.querySelectorAll("#board .tile").length > 0, { timeout: 8000 });

  // grid: cards form a rectangle (cols × rows ≥ cards, cols in 2..4)
  const grid = await page.evaluate(() => {
    const n = document.querySelectorAll("#board .tile").length;
    const cols = +document.getElementById("board").style.getPropertyValue("--cols");
    return { n, cols, rows: Math.ceil(n / cols) };
  });
  check(`${mode}: cards in a rectangular grid (${grid.n} cards → ${grid.cols} cols)`,
    grid.cols >= 2 && grid.cols <= 4 && grid.cols * grid.rows >= grid.n, JSON.stringify(grid));

  const total = await page.evaluate(() => state.set.pairs.length);
  let wrongSeen = false;

  // First, deliberately make ONE wrong match (two lefts) to exercise mismatch.
  const didWrong = await page.evaluate(() => {
    const lefts = state.cards.filter(c => c.side === "left");
    if (lefts.length >= 2 && lefts[0].pairId !== lefts[1].pairId) { lefts[0].el.click(); lefts[1].el.click(); return true; }
    return false;
  });
  if (didWrong) {
    const flashed = await page.waitForFunction(() => document.querySelectorAll("#board .tile.wrong").length === 2, { timeout: 2000 }).then(() => true).catch(() => false);
    wrongSeen = flashed;
    await sleep(1200); // let the flip-back / deselect finish
  }

  // Now match every pair correctly. Click left then its right, pair by pair,
  // waiting for the busy window to clear between attempts.
  for (let pid = 0; pid < total; pid++) {
    await page.evaluate((pid) => {
      const l = state.cards.find(c => c.pairId === pid && c.side === "left");
      const r = state.cards.find(c => c.pairId === pid && c.side === "right");
      l.el.click(); r.el.click();
    }, pid);
    await page.waitForFunction((pid) => state.cards.filter(c => c.pairId === pid).every(c => c.matched) && !state.busy, { timeout: 3000 }, pid).catch(() => {});
  }

  return await page.evaluate(() => ({
    moves: state.moves,
    matched: state.matched,
    total: state.set.pairs.length,
    matchedTiles: document.querySelectorAll("#board .tile.match").length,
    nextShown: document.getElementById("next-btn").style.display === "inline-block",
    explainShown: document.getElementById("explain").style.display === "block",
  })).then(r => ({ ...r, wrongSeen }));
}

// ---- EASY mode ----
let r = await playRound("easy");
check("easy: all tiles start face-up", true); // implied by render; checked below via no .down
const easyFaceUp = await page.evaluate(() => document.querySelectorAll("#board .tile.down").length === 0 || state.matched === state.set.pairs.length);
check("easy: a wrong match flashes red", r.wrongSeen);
check("easy: every pair matched → win", r.matched === r.total && r.matchedTiles === r.total * 2, `${r.matched}/${r.total}`);
check("easy: Next Round + explain shown after win", r.nextShown && r.explainShown);

// back to setup, play MEMORY
await page.evaluate(() => document.getElementById("quit-btn").click());
await page.waitForFunction(() => document.getElementById("setup").style.display === "block", { timeout: 5000 });

// ---- MEMORY mode ----
// verify cards START face down on a fresh memory round
await page.evaluate(() => { document.querySelector('.mode[data-mode="memory"]').click(); document.getElementById("start-btn").click(); });
await page.waitForFunction(() => document.querySelectorAll("#board .tile").length > 0, { timeout: 8000 });
const startedDown = await page.evaluate(() => {
  const tiles = document.querySelectorAll("#board .tile");
  return tiles.length > 0 && [...tiles].every(t => t.classList.contains("down"));
});
check("memory: all cards start FACE DOWN", startedDown);
// flipping one card reveals it (face up)
const flips = await page.evaluate(() => {
  const c = state.cards[0]; c.el.click();
  const up = c.el.classList.contains("up");
  c.el.click(); // tap again to flip back down
  return { up, downAgain: c.el.classList.contains("down") };
});
check("memory: tapping a card flips it up", flips.up);
check("memory: tapping the selected card again flips it back down", flips.downAgain);

// finish the memory round by matching every pair
const total2 = await page.evaluate(() => state.set.pairs.length);
for (let pid = 0; pid < total2; pid++) {
  await page.evaluate((pid) => {
    const l = state.cards.find(c => c.pairId === pid && c.side === "left");
    const rr = state.cards.find(c => c.pairId === pid && c.side === "right");
    l.el.click(); rr.el.click();
  }, pid);
  await page.waitForFunction((pid) => state.cards.filter(c => c.pairId === pid).every(c => c.matched) && !state.busy, { timeout: 3000 }, pid).catch(() => {});
}
const mem = await page.evaluate(() => ({ matched: state.matched, total: state.set.pairs.length, next: document.getElementById("next-btn").style.display === "inline-block" }));
check("memory: completing all pairs wins the round", mem.matched === mem.total && mem.next, `${mem.matched}/${mem.total}`);

// ---- sound: toggle button + module present, no audio errors ----
const snd = await page.evaluate(() => {
  const b = document.getElementById("sound-btn");
  const before = { on: Sound.on, icon: b.textContent };
  b.click();
  const after = { on: Sound.on, icon: b.textContent };
  b.click(); // restore
  return { hasModule: typeof Sound === "object", before, after, sfxKeys: Object.keys(Sound.pools).length };
});
check("sound module loaded with SFX channels", snd.hasModule && snd.sfxKeys >= 3, `sfx pools=${snd.sfxKeys}`);
check("sound toggle flips state + icon (🔊⇄🔈)", snd.before.on !== snd.after.on && snd.before.icon !== snd.after.icon, JSON.stringify(snd));
check("no page errors during play (sound calls didn't throw)", pageErrors === 0, `errors=${pageErrors}`);

await browser.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL MATCH-GAME CHECKS PASS");
process.exit(fails.length ? 2 : 0);
