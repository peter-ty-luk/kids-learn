// Tower Quiz Defense — headless checks. 2D canvas game driven through window.TD
// (state + tick/turbo/answer/buy helpers), same pattern as the maze tests.
// Needs the server on :3077 (serves /quiz/mcq from the sibling ../quiz project).
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 150)); });
await p.goto("http://localhost:3077/tower.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TD && TD.ready === true, { timeout: 20000 });

// ---- questions come from the ../quiz project ----
const feed = await p.evaluate(async () => { const r = await fetch("/quiz/mcq"); const j = await r.json(); return { count: j.count, byDiff: j.byDiff }; });
check("questions load from the ../quiz project (/quiz/mcq)", feed.count > 50, `count=${feed.count} byDiff=${JSON.stringify(feed.byDiff)}`);

// ---- answering earns coins by difficulty; wrong answers lock briefly ----
const qa = await p.evaluate(() => {
  TD.opts.role = "defend"; TD.opts.ai = "normal"; TD.opts.mins = 3;
  TD.start();
  const st = TD.state, out = {};
  TD.setQDiff(3);
  const before = st.coins;
  out.rightEarns = TD.answer(st.q.answer) === true && st.coins === before + TD.config.REWARDS[3];
  // move to next question (the UI does it on a timer; force it for the test)
  TD.showQuestion();
  const wrong = st.q.choices.find((c) => String(c) !== String(st.q.answer));
  const c2 = st.coins;
  out.wrongEarnsNothing = TD.answer(wrong) === false && st.coins === c2;
  out.locked = st.qLock > 0;
  out.lockBlocks = TD.answer(st.q.answer) === false; // still locked → rejected
  return out;
});
check("correct answer earns the tier's coins (hard = +22)", qa.rightEarns);
check("wrong answer earns nothing and locks the panel", qa.wrongEarnsNothing && qa.locked);
check("the lockout blocks answering until it expires", qa.lockBlocks);

// ---- defender: build towers on slots ----
const build = await p.evaluate(() => {
  const st = TD.state;
  st.coins = 200;
  const ok1 = TD.placeTower("archer", 5);
  const dup = TD.placeTower("cannon", 5);          // occupied slot
  st.coins = 5;
  const poor = TD.placeTower("archer", 6);          // can't afford
  return { ok1, dup, poor, towers: st.towers.length, spent: TD.state.coins };
});
check("defender can place a tower on a free slot", build.ok1 && build.towers === 1);
check("an occupied slot refuses a second tower", build.dup === false);
check("can't build without enough coins", build.poor === false);

// ---- troops walk the path and damage the base; towers shoot them ----
const combat = await p.evaluate(() => {
  const st = TD.state;
  // keep the AI broke so ITS waves don't muddy this isolated check
  st.aiCoins = 0; st.aiAcc = 0; st.dripAcc = -999;
  // clear field, no towers: a runner must reach the base and hurt it
  st.towers = []; st.troops = [];
  const hp0 = st.baseHP;
  TD.spawnTroop("runner", "attack");
  TD.turbo(40, 0.05);
  const reached = st.baseHP < hp0;
  // now a gauntlet of WELL-PLACED archers (top path-coverage slots — placement
  // matters by design): a runner must die before the base
  st.coins = 500; st.aiCoins = 0; st.aiAcc = 0; st.dripAcc = -999; st.troops = [];
  TD.placeTower("archer", 1); TD.placeTower("archer", 6); TD.placeTower("archer", 9); TD.placeTower("archer", 13);
  const hp1 = st.baseHP, k0 = st.kills;
  TD.spawnTroop("runner", "attack");
  TD.turbo(40, 0.05);
  const killed = st.kills > k0 && st.baseHP === hp1;
  return { reached, killed, kills: st.kills };
});
check("an unopposed troop reaches the base and damages it", combat.reached);
check("archer towers kill a runner before it arrives", combat.killed);

// ---- ice towers slow troops ----
const ice = await p.evaluate(() => {
  const st = TD.state;
  st.towers = []; st.troops = []; st.coins = 500;
  TD.placeTower("ice", 1);
  TD.spawnTroop("brute", "attack");
  let sawSlow = false;
  for (let i = 0; i < 300 && st.troops.length; i++) { TD.tick(0.05); if (st.troops[0] && st.troops[0].slow > 0) { sawSlow = true; break; } }
  return { sawSlow };
});
check("ice towers slow troops", ice.sawSlow);

// ---- STRATEGY AXES ----
// armor: archers do half damage to brutes, full to runners
const armor = await p.evaluate(() => {
  TD.opts.role = "defend"; TD.start();
  const st = TD.state; st.towers = []; st.troops = []; st.coins = 999;
  TD.placeTower("archer", 1);
  const shootFirst = (kind) => {
    st.troops = [];
    const tr = TD.spawnTroop(kind, "attack");
    for (let i = 0; i < 400 && tr.hp === tr.max && !tr.dead; i++) TD.tick(0.05);
    return tr.max - tr.hp;
  };
  const bruteHit = shootFirst("brute");     // expect 7 × 0.5 = 3.5
  const runnerHit = shootFirst("runner");   // expect 7
  return { bruteHit, runnerHit };
});
check("armored brutes take HALF damage from archers", armor.bruteHit === 3.5 && armor.runnerHit === 7, JSON.stringify(armor));

// air: ground-only towers (cannon/tesla) can't touch a balloon…
const air = await p.evaluate(() => {
  const st = TD.state; st.towers = []; st.troops = []; st.coins = 999; st.baseHP = st.baseMax = 260;
  TD.placeTower("cannon", 1); TD.placeTower("tesla", 6); TD.placeTower("cannon", 9); TD.placeTower("tesla", 13);
  const hp0 = st.baseHP, k0 = st.kills;
  TD.spawnTroop("balloon", "attack");
  TD.turbo(40, 0.05);
  const flewOver = st.baseHP < hp0 && st.kills === k0;
  // …but air-capable towers shoot it down
  st.towers = []; st.troops = [];
  TD.placeTower("archer", 1); TD.placeTower("sniper", 6); TD.placeTower("archer", 9);
  const hp1 = st.baseHP, k1 = st.kills;
  TD.spawnTroop("balloon", "attack");
  TD.turbo(40, 0.05);
  const shotDown = st.kills > k1 && st.baseHP === hp1;
  return { flewOver, shotDown };
});
check("balloons fly OVER cannon + tesla fire and hit the base", air.flewOver);
check("archers + snipers shoot balloons down", air.shotDown);

// swarm: one mice purchase fields a pack of 4
const mice = await p.evaluate(() => {
  TD.opts.role = "attack"; TD.start();
  const st = TD.state; st.coins = 100; st.troops = [];
  TD.buyUnit("mice");
  return { n: st.troops.length, spread: new Set(st.troops.map((t) => t.s)).size };
});
check("the mice unit is a PACK of 4 strung-out critters", mice.n === 4 && mice.spread === 4, JSON.stringify(mice));
check("sniper outranges every other tower", await p.evaluate(() => TD.config.TOWERS.sniper.range > Math.max(...Object.entries(TD.config.TOWERS).filter(([k]) => k !== "sniper").map(([, t]) => t.range))));

// ---- attacker role: buying units + upgrades ----
const atk = await p.evaluate(() => {
  TD.opts.role = "attack"; TD.start();
  const st = TD.state;
  st.coins = 200;
  const n0 = st.troops.filter((t) => t.side === "attack").length;
  const bought = TD.buyUnit("brute");
  const hpPlain = st.troops[st.troops.length - 1].max;
  TD.buyUpgrade("armor");
  TD.buyUnit("brute");
  const hpArmored = st.troops[st.troops.length - 1].max;
  const towerRefused = TD.placeTower("archer", 0); // attackers don't build towers
  return { bought, grew: st.troops.length === n0 + 2, armorWorks: hpArmored > hpPlain, towerRefused };
});
check("attacker buys troops (they spawn at the camp)", atk.bought && atk.grew);
check("armor upgrade makes NEW troops tougher", atk.armorWorks);
check("an attacker can't build towers", atk.towerRefused === false);

// ---- the AI plays the other side ----
const ai = await p.evaluate(() => {
  // player attacks → AI must build towers
  TD.opts.role = "attack"; TD.start();
  TD.state.aiCoins = 300; TD.turbo(10, 0.05);
  const aiBuilds = TD.state.towers.length > 0;
  // player defends → AI must send troops
  TD.opts.role = "defend"; TD.start();
  TD.state.aiCoins = 300; TD.turbo(20, 0.05);
  const aiSends = TD.state.sent > 0;
  return { aiBuilds, aiSends };
});
check("AI defender builds towers", ai.aiBuilds);
check("AI attacker sends troops", ai.aiSends);

// ---- win conditions ----
const wins = await p.evaluate(() => {
  TD.opts.role = "defend"; TD.start();
  TD.state.baseHP = 1; TD.spawnTroop("runner", "attack"); TD.turbo(40, 0.05);
  const attackWin = TD.state.status === "over" && TD.state.winner === "attack";
  TD.start();
  TD.state.timeLeft = 1; TD.turbo(3, 0.05);
  const defendWin = TD.state.status === "over" && TD.state.winner === "defend";
  return { attackWin, defendWin };
});
check("base destroyed → attacker wins", wins.attackWin);
check("timer survived → defender wins", wins.defendWin);

// ---- balance: AI vs AI at equal income should be a real contest ----
let defWins = 0;
const games = 6;
for (let i = 0; i < games; i++) {
  const r = await p.evaluate((i) => {
    TD.opts.role = i % 2 ? "attack" : "defend"; TD.opts.ai = "normal"; TD.opts.mins = 3;
    TD.start(); TD.autoPilot = true; TD.turbo(200, 0.05); TD.autoPilot = false;
    return TD.state.winner;
  }, i);
  if (r === "defend") defWins++;
}
check("balance: neither side dominates (AI vs AI)", defWins >= 1 && defWins <= games - 1, `defender wins ${defWins}/${games}`);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL TOWER CHECKS PASS");
process.exit(fails.length ? 2 : 0);
