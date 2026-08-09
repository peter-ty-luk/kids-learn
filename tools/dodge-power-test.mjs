// Dodge Ball — special power blocks + the shrinking survival arena.
// Needs the server on :3077.
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 200)); });
await p.goto("http://localhost:3077/dodge.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.DB, { timeout: 20000 });

// helper installed in the page: put a power in hand, fuse a ball, throw it
await p.evaluate(() => {
  window._arm = (kind, aimX, aimY) => {
    const st = DB.state, me = st.players[0];
    me.power = { kind, left: DB.SHRINK.throws };
    me.ball = { emoji: "🏀", dmg: 1, kind: "normal" };
    if (me.power && me.power.left > 0) me.ball.power = kind;
    st.balls.length = 0; st.hazards.length = 0;
    DB.throwBall(me, aimX, aimY, st);
    return st.balls;
  };
  window._calm = () => {                       // freeze everyone else so they don't interfere
    const st = DB.state;
    st.players.forEach((q, i) => { if (i) { q.frozen = 999; q.ball = null; q.slots = [null, null]; q.power = null; } });
  };
});

// ---- the court is bounded: you cannot run off it ----
const bounded = await p.evaluate(() => {
  DB.opts.court = "free"; DB.opts.size = 1; DB.start();
  const st = DB.state; const me = st.players[0];
  const tries = [[-9999, 270], [9999, 270], [480, -9999], [480, 9999]];
  const escaped = [];
  for (const [x, y] of tries) {
    me.x = x; me.y = y; DB.tick(0.016);
    if (me.x < st.bounds.x0 || me.x > st.bounds.x1 || me.y < st.bounds.y0 || me.y > st.bounds.y1) escaped.push([Math.round(me.x), Math.round(me.y)]);
  }
  return { escaped, bounds: st.bounds };
});
check("the court is bounded — a player can never leave it", bounded.escaped.length === 0, JSON.stringify(bounded.escaped));

// ---- power blocks appear and are picked up ----
const grab = await p.evaluate(() => {
  DB.opts.court = "free"; DB.opts.size = 2; DB.start();
  const st = DB.state; window._calm();
  st.powers.length = 0; st.nextPowerIn = 0;
  DB.topUpPowers(st, 0.1);
  const spawned = st.powers.length;
  const w = st.powers[0];
  const me = st.players[0];
  me.x = w.x; me.y = w.y;                       // walk onto it
  DB.tick(0.016);
  return { spawned, kind: w && w.kind, held: me.power && me.power.kind, left: me.power && me.power.left,
           gone: st.powers.length === 0, known: Object.keys(DB.POWERS).length };
});
check("special power blocks spawn on the floor", grab.spawned > 0 && !!grab.kind, `kind=${grab.kind}`);
check("there are 7 different powers", grab.known === 7, `${grab.known} powers`);
check("walking over a block grabs the power for 3 throws", grab.held === grab.kind && grab.left === 3);
check("the block is consumed when taken", grab.gone);

// ---- the power must be in hand BEFORE the pair fuses ----
const order = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.power = null; me.ball = null; me.slots = [null, null];
  // fuse with NO power in hand → plain ball
  const bank = st.bank[0];
  me.slots = [{ pairId: bank.pairId, side: "left", text: bank.left }, { pairId: bank.pairId, side: "right", text: bank.right }];
  const combine = () => { const a = me.slots[0], b2 = me.slots[1]; me.ball = DB.ballFor(st, a.pairId); if (me.power && me.power.left > 0) me.ball.power = me.power.kind; me.slots = [null, null]; };
  combine();
  const plain = me.ball.power || null;
  // now grab a power FIRST, then fuse → powered ball
  me.ball = null;
  me.power = { kind: "turbo", left: 3 };
  me.slots = [{ pairId: bank.pairId, side: "left", text: bank.left }, { pairId: bank.pairId, side: "right", text: bank.right }];
  combine();
  return { plain, powered: me.ball.power };
});
check("a ball fused with no power in hand is a plain ball", order.plain === null);
check("a ball fused while holding a power carries it", order.powered === "turbo");

// ---- each power behaves ----
const bounce = await p.evaluate(async () => {
  const st = DB.state, me = st.players[0];
  me.x = 480; me.y = 270;
  const balls = window._arm("bounce", 480, 4000);   // straight at a wall
  const b0 = balls[0];
  let bounced = 0;
  for (let i = 0; i < 400 && !b0.dead; i++) { DB.tick(0.016); bounced = Math.max(bounced, b0.bounces || 0); }
  return { bounced, diedEventually: b0.dead };
});
check("BOUNCY: the ball ricochets off the wall then gives up", bounce.bounced > 0 && bounce.diedEventually, `${bounce.bounced} bounces`);

const fire = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.x = 200; me.y = 270;
  window._arm("fire", 900, 270);
  for (let i = 0; i < 25; i++) DB.tick(0.016);
  return { trail: st.hazards.filter((h) => h.type === "fire").length };
});
check("FIRE TRAIL: burning patches are left along the path", fire.trail > 2, `${fire.trail} patches`);

const ghost = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  const o = st.obstacles[0];
  me.x = o.x - 60; me.y = o.y + o.h / 2;
  const plainDead = (() => { const bl = window._arm("bounce", o.x + 900, o.y + o.h / 2); bl[0].power = null;
    for (let i = 0; i < 60 && !bl[0].dead; i++) DB.tick(0.016); return bl[0].dead; })();
  const gh = window._arm("ghost", o.x + 900, o.y + o.h / 2);
  let passed = false;
  for (let i = 0; i < 60 && !gh[0].dead; i++) { DB.tick(0.016); if (gh[0].x > o.x + o.w + 10) { passed = true; break; } }
  return { plainDead, passed };
});
check("GHOST: a normal ball is stopped by a crate but a ghost ball flies through", ghost.plainDead && ghost.passed);

const poison = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  const o = st.obstacles[0];
  me.x = o.x - 60; me.y = o.y + o.h / 2;
  const bl = window._arm("poison", o.x + 900, o.y + o.h / 2);
  for (let i = 0; i < 80 && !bl[0].dead; i++) DB.tick(0.016);
  const cloud = st.hazards.find((h) => h.type === "poison");
  if (!cloud) return { made: false };
  // an enemy standing in the gas loses hearts
  const foe = st.players.find((q) => q.team === 1);
  foe.out = false; foe.hp = 3; foe.invuln = 0; foe.frozen = 999; foe.x = cloud.x; foe.y = cloud.y;
  for (let i = 0; i < 120; i++) DB.tick(0.016);
  return { made: true, hp: foe.hp };
});
check("POISON: hitting a crate releases gas", poison.made);
if (poison.made) check("POISON: standing in the gas costs the opponent hearts", poison.hp < 3, `hp=${poison.hp}`);

const triple = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.x = 200; me.y = 270;
  const balls = window._arm("triple", 900, 270);
  const angs = balls.map((b2) => Math.round((Math.atan2(b2.dy, b2.dx) * 180) / Math.PI));
  return { n: balls.length, angs };
});
check("TRIPLE SHOT: three balls leave at -30 / 0 / +30 degrees", triple.n === 3 && triple.angs.includes(-30) && triple.angs.includes(0) && triple.angs.includes(30), JSON.stringify(triple.angs));

const turbo = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.x = 200; me.y = 270;
  const fast = window._arm("turbo", 900, 270)[0].speed;
  const slow = window._arm("fire", 900, 270)[0].speed;
  return { fast, slow };
});
check("TURBO: the ball flies much faster than normal", turbo.fast > turbo.slow * 1.8, `${turbo.fast} vs ${turbo.slow}`);

const homing = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.x = 120; me.y = 270;
  const foe = st.players.find((q) => q.team === 1);
  foe.out = false; foe.hp = 9; foe.invuln = 0; foe.frozen = 999; foe.x = 700; foe.y = 60;
  const bl = window._arm("homing", 900, 470)[0];      // aimed well AWAY from the foe
  const a0 = Math.atan2(bl.dy, bl.dx);
  for (let i = 0; i < 40; i++) DB.tick(0.016);
  const toFoe = Math.atan2(foe.y - bl.y, foe.x - bl.x);
  const a1 = Math.atan2(bl.dy, bl.dx);
  return { turned: Math.abs(a1 - a0) > 0.15, aligned: Math.abs(a1 - toFoe) < 0.5 };
});
check("HOMING: the ball curves round to chase its target", homing.turned && homing.aligned);

// ---- power is spent after 3 throws ----
const spend = await p.evaluate(() => {
  const st = DB.state, me = st.players[0];
  me.out = false; me.stun = 0; me.frozen = 0; me.hp = 3; me.slots = [null, null];
  me.power = { kind: "turbo", left: 3 };
  const left = [], thrown = [];
  for (let k = 0; k < 3; k++) {
    me.ball = { emoji: "🏀", dmg: 1, kind: "normal", power: "turbo" };
    thrown.push(DB.throwBall(me, 900, 270, st));
    left.push(me.power ? me.power.left : 0);
  }
  return { left, thrown, cleared: me.power === null };
});
check("a power lasts exactly 3 throws then runs out", JSON.stringify(spend.left) === "[2,1,0]" && spend.cleared && spend.thrown.every(Boolean), JSON.stringify(spend.left));

// ================= SURVIVAL MODE =================
const surv = await p.evaluate(() => {
  DB.opts.court = "survival"; DB.opts.size = 2; DB.start();
  const st = DB.state; window._calm();
  return { mode: st.mode, area: (st.bounds.x1 - st.bounds.x0) * (st.bounds.y1 - st.bounds.y0),
           full: DB.W * DB.H, shrinkIn: st.shrinkIn, every: DB.SHRINK.every };
});
check("survival starts with the full court", surv.mode === "survival" && Math.abs(surv.area - surv.full) < 1);

const warn = await p.evaluate(() => {
  const st = DB.state;
  st.shrinkIn = DB.SHRINK.warn + 0.2;
  DB.tick(0.5);
  const el = document.getElementById("shrink-alarm");
  // count the sirens over the whole countdown, and check the last few seconds
  // beep faster than the early ones
  let beeps = 0, urgentBeeps = 0;
  const realAlarm = window._soundForTest.alarm.bind(window._soundForTest);
  window._soundForTest.alarm = (urgent) => { beeps++; if (urgent) urgentBeeps++; };
  let bannerSeen = 0, counts = [];
  for (let i = 0; i < 200 && st.shrinkIn > 0.05; i++) {
    DB.tick(0.05);
    if (el.classList.contains("show")) { bannerSeen++; const n = (el.textContent.match(/(\d+)/) || [])[1]; if (n && !counts.includes(n)) counts.push(n); }
  }
  window._soundForTest.alarm = realAlarm;
  return { warned: st.shrinkWarned, msg: st.msg, banner: bannerSeen > 0, counts: counts.length, beeps, urgentBeeps };
});
check("you are warned BEFORE the walls close in", warn.warned && /clos(e|ing) in/i.test(warn.msg), warn.msg);
check("a countdown banner shows over the court", warn.banner && warn.counts >= 5, `${warn.counts} distinct seconds shown`);
check("the siren repeats through the countdown", warn.beeps >= 8, `${warn.beeps} beeps`);
check("the siren speeds up for the last seconds", warn.urgentBeeps >= 5, `${warn.urgentBeeps} urgent beeps`);

const shrank = await p.evaluate(() => {
  const st = DB.state;
  const w0 = st.bounds.x1 - st.bounds.x0, h0 = st.bounds.y1 - st.bounds.y0;
  st.shrinkIn = 0.01; DB.tick(0.05);
  const w1 = st.bounds.x1 - st.bounds.x0, h1 = st.bounds.y1 - st.bounds.y0;
  return { ratioW: w1 / w0, ratioH: h1 / h0, shrinks: st.shrinks, reset: st.shrinkIn };
});
check("each shrink takes 20% off the arena", Math.abs(shrank.ratioW - 0.8) < 0.01 && Math.abs(shrank.ratioH - 0.8) < 0.01, `w×${shrank.ratioW.toFixed(2)} h×${shrank.ratioH.toFixed(2)}`);
check("the next shrink is scheduled a minute later", Math.abs(shrank.reset - 60) < 1, `${shrank.reset.toFixed(0)}s`);

const pushed = await p.evaluate(() => {
  const st = DB.state;
  const me = st.players[0];
  me.out = false; me.hp = 3;
  me.x = st.bounds.x0 + 4; me.y = st.bounds.y0 + 4;    // hugging the wall
  st.shrinkIn = 0.01; DB.tick(0.05);
  const b2 = st.bounds;
  return { inside: me.x >= b2.x0 && me.x <= b2.x1 && me.y >= b2.y0 && me.y <= b2.y1, out: me.out };
});
check("a player caught by the wall is PUSHED inside, not killed", pushed.inside && !pushed.out);

const crushed = await p.evaluate(() => {
  const st = DB.state;
  const me = st.players[0];
  me.out = false; me.hp = 3;
  // an arena with no room left at all
  st.bounds = { x0: 470, y0: 265, x1: 490, y1: 285 };
  me.x = 480; me.y = 275;
  st.shrinkIn = 0.01; DB.tick(0.05);
  return { out: me.out, hp: me.hp };
});
check("with nowhere left to stand, the wall crushes you", crushed.out && crushed.hp === 0);

const noClock = await p.evaluate(() => {
  DB.opts.court = "survival"; DB.start();
  const st = DB.state; window._calm();
  st.timeLeft = -30;                       // the clock has run way out
  DB.tick(0.05);
  const stillPlaying = st.status === "playing";
  // ...but wiping out a team does end it
  st.players.filter((q) => q.team === 1).forEach((q) => { q.out = true; });
  DB.tick(0.05);
  return { stillPlaying, ended: st.status === "over", winner: st.winner };
});
check("survival ignores the clock — no timeout finish", noClock.stillPlaying);
check("survival ends only when a team has no survivors", noClock.ended && noClock.winner === 0);

// The alarm banner must not follow you out of survival into the next game.
// Runs last because it restarts the game and would reset the state above.
const leak = await p.evaluate(() => {
  DB.opts.court = "survival"; DB.start();
  DB.state.shrinkIn = 3; DB.tick(0.05);
  const during = document.getElementById("shrink-alarm").classList.contains("show");
  DB.opts.court = "free"; DB.start(); DB.tick(0.05);
  return { during, after: document.getElementById("shrink-alarm").classList.contains("show") };
});
check("the alarm banner clears when the next game starts", leak.during && !leak.after, `survival=${leak.during} next=${leak.after}`);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL DODGE POWER + SURVIVAL CHECKS PASS");
process.exit(fails.length ? 2 : 0);
