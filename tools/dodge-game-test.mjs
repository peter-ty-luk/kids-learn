// Match Dodge Ball — headless checks, driven through window.DB.
// Needs the server on :3077 (quiz-pairs content comes from ../quiz).
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 150)); });
await p.goto("http://localhost:3077/dodge.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.DB, { timeout: 20000 });

// ---- setup: field populated with PAIRS on each half ----
const setup = await p.evaluate(() => {
  DB.opts.size = 2; DB.opts.court = "official"; DB.opts.content = "emoji"; DB.opts.ai = "normal";
  DB.start();
  const st = DB.state;
  const halves = [st.parts.filter((x) => x.half === 0).length, st.parts.filter((x) => x.half === 1).length];
  // every part's partner exists on the SAME half (matches are findable without crossing)
  const pairable = st.parts.every((x) => st.parts.some((y) => y !== x && y.pairId === x.pairId && y.side !== x.side && y.half === x.half));
  return { players: st.players.length, halves, pairable, obstacles: st.obstacles.length };
});
check("2v2 game starts with 4 players + obstacles", setup.players === 4 && setup.obstacles >= 4);
check("parts spawn on both halves", setup.halves[0] >= 4 && setup.halves[1] >= 4, JSON.stringify(setup.halves));
check("every part's matching partner is on the same half", setup.pairable);

// ---- pickup + correct match → a throwable ball ----
const match = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  const a = st.parts.find((x) => x.half === 0);
  const partner = st.parts.find((y) => y.pairId === a.pairId && y.side !== a.side && y.half === 0);
  DB.pickup(me, a); const oneSlot = !!me.slots[0] && !me.ball;
  DB.pickup(me, partner);
  return { oneSlot, gotBall: !!me.ball, slotsCleared: !me.slots[0] && !me.slots[1], emoji: me.ball && me.ball.emoji };
});
check("walking over a part picks it up (slot 1)", match.oneSlot);
check("two MATCHING parts fuse into a ball", match.gotBall && match.slotsCleared, `ball=${match.emoji}`);
check("emoji content: the thrown object IS the matched emoji", /\p{Extended_Pictographic}/u.test(match.emoji || ""));

// ---- wrong match fizzles ----
const wrong = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.ball = null; me.slots = [null, null];
  const a = st.parts.find((x) => x.half === 0);
  const notPartner = st.parts.find((y) => y.half === 0 && y.pairId !== a.pairId);
  const floor0 = st.parts.length;
  DB.pickup(me, a); DB.pickup(me, notPartner);
  return { noBall: !me.ball, stunned: me.stun > 0, backOnFloor: st.parts.length === floor0, cleared: !me.slots[0] && !me.slots[1] };
});
check("two NON-matching parts fizzle (no ball, brief dizzy, parts return)", wrong.noBall && wrong.stunned && wrong.backOnFloor && wrong.cleared);

// ---- throwing hits an enemy: damage + invuln; 0 hp → out ----
const hit = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  const enemy = st.players.find((x) => x.team === 1);
  me.stun = 0; me.x = DB.MID - 60; me.y = 250; enemy.x = DB.MID + 60; enemy.y = 250; enemy.hp = 2; enemy.invuln = 0;
  enemy.frozen = 9; // stand still for a deterministic shot (frozen players can still be hit)
  st.balls = []; st.obstacles = [];                       // clear the lane for a deterministic shot
  me.ball = { emoji: "🏀", dmg: 1, kind: "normal", label: "t" };
  DB.throwBall(me, enemy.x, enemy.y);
  const flew = st.balls.length === 1;
  DB.turbo(1.2, 0.02);
  const hurt = enemy.hp === 1 && enemy.invuln > 0;
  // second hit takes it out
  enemy.invuln = 0; enemy.frozen = 9; me.ball = { emoji: "🏀", dmg: 1, kind: "normal", label: "t" };
  me.x = DB.MID - 60; me.y = enemy.y = 250; enemy.x = DB.MID + 60;
  DB.throwBall(me, enemy.x, enemy.y);
  DB.turbo(1.2, 0.02);
  return { flew, hurt, out: enemy.out === true };
});
check("a thrown ball hits an enemy (-1 ❤️ + brief shield)", hit.flew && hit.hurt);
check("a player at 0 hearts is OUT (dodgeball style)", hit.out);

// ---- obstacles block balls ----
const wall = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  const enemy = st.players.find((x) => x.team === 1 && !x.out) || st.players[2];
  st.obstacles = [{ x: DB.MID - 20, y: 200, w: 40, h: 120 }];
  st.balls = [];
  // freeze EVERYONE else (and disarm them) so no stray AI ball muddies the check
  st.players.forEach((q) => { if (q !== me) { q.frozen = 9; q.ball = null; q.slots = [null, null]; } });
  enemy.out = false; enemy.hp = 3; enemy.invuln = 0; enemy.x = DB.MID + 80; enemy.y = 260;
  me.x = DB.MID - 80; me.y = 260; me.stun = 0;
  me.ball = { emoji: "🏀", dmg: 1, kind: "normal", label: "t" };
  DB.throwBall(me, enemy.x, enemy.y);
  DB.turbo(1.2, 0.02);
  return { blocked: enemy.hp === 3 };
});
check("obstacles block balls (cover works)", wall.blocked);

// ---- official court confines players to their half ----
const court = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.x = DB.MID - 20; me.stun = 0; me.frozen = 0;
  // push right for a second — the mid line must stop the player
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
  DB.turbo(1.0, 0.02);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
  const clamped = me.x < DB.MID;
  return { clamped, x: Math.round(me.x) };
});
check("official mode: you can't cross the middle line", court.clamped, `x=${court.x} (mid=${480})`);

// ---- free-for-all mode allows crossing ----
const free = await p.evaluate(() => {
  DB.opts.court = "free"; DB.start();
  const me = DB.state.players[0];
  me.x = DB.MID - 20; me.y = 60;                          // top lane, clear of obstacles
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
  DB.turbo(1.2, 0.02);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
  return { crossed: me.x > DB.MID };
});
check("free-for-all mode: crossing is allowed", free.crossed);

// ---- quiz content: pairs come from the ../quiz project ----
const quiz = await p.evaluate(() => {
  DB.opts.content = "quiz"; DB.opts.court = "official"; DB.start();
  const st = DB.state;
  const fromQuiz = st.bank.length >= 6 && st.bank.every((x) => x.pairId.startsWith("q") || x.pairId.startsWith("e"));
  const quizUsed = st.bank[0].pairId.startsWith("q");
  // a quiz ball is one of the fun types (not the raw emoji content)
  const ball = DB.ballFor(st, st.bank[0].pairId);
  return { fromQuiz, quizUsed, ballKind: ball.kind, bank: st.bank.length };
});
check("quiz mode: pairs fetched from ../quiz via /quiz/pairs", quiz.fromQuiz && quiz.quizUsed, `bank=${quiz.bank}`);
check("quiz balls get fun types (normal/power/ice)", ["normal", "power", "ice"].includes(quiz.ballKind), quiz.ballKind);

// ---- the AI actually plays: moves, matches, throws ----
const ai = await p.evaluate(() => {
  DB.opts.content = "emoji"; DB.opts.court = "official"; DB.opts.ai = "tough"; DB.start();
  const st = DB.state;
  const pos0 = st.players.filter((x) => !x.isHuman).map((x) => [x.x, x.y]);
  let sawBallOrHit = false;
  const hearts = () => st.players.reduce((s, x) => s + x.hp, 0);
  const h0 = hearts();
  for (let i = 0; i < 40 && !sawBallOrHit; i++) {
    DB.turbo(1, 0.05);
    if (st.balls.length > 0 || st.players.some((x) => x.ball && !x.isHuman) || hearts() < h0) sawBallOrHit = true;
  }
  const moved = st.players.filter((x) => !x.isHuman).some((x, i) => Math.hypot(x.x - pos0[i][0], x.y - pos0[i][1]) > 30);
  return { moved, sawBallOrHit };
});
check("AI players run around the field", ai.moved);
check("AI matches pairs and throws balls", ai.sawBallOrHit);

// ---- win: knock the whole red team out ----
const win = await p.evaluate(() => {
  DB.start();
  const st = DB.state;
  st.players.filter((x) => x.team === 1).forEach((x) => { x.hp = 0; x.out = true; });
  DB.tick(0.05);
  return { over: st.status === "over", winner: st.winner, title: document.getElementById("end-title").textContent };
});
check("all enemies out → blue team wins (knockout)", win.over && win.winner === 0 && /Blue/i.test(win.title));

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL DODGE CHECKS PASS");
process.exit(fails.length ? 2 : 0);
