// Answer gates + hit attribution + oil placement — headless checks on the real
// kart scene. Needs the server on :3077.
//
//   node tools/kart-gate-test.mjs [trackId]
const puppeteer = (await import("puppeteer-core")).default;
const TRACK = Number(process.argv[2] || 4);
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 200)); });
await p.goto("http://localhost:3077/", { waitUntil: "domcontentloaded" });

// offline → car → track → start
await p.waitForSelector("#offline-btn", { timeout: 20000 });
await p.click("#offline-btn");
await p.waitForSelector(".car-card", { timeout: 20000 });
await p.click(".car-card");
await p.waitForSelector(".track-card", { timeout: 20000 });
await p.evaluate((t) => {
  const cards = [...document.querySelectorAll(".track-card")];
  (cards.find((c) => c.textContent.includes(TRACKS[t].name)) || cards[t]).click();
}, TRACK);
await p.waitForFunction(() => !document.getElementById("start-race-btn").disabled, { timeout: 20000 });
await p.click("#start-race-btn");
await p.waitForFunction(() => window._raceEnded === false, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));

// ---- a question row is served as a wall of doors ----
// force one so the check never depends on the coin-flip
const built = await p.evaluate(() => {
  const rows = window._getItemRows();
  const r = rows[0];
  window._forceGateRow(r);
  return { built: r.kind === "gate" && !!r.gate, doors: r.gate.doors.length, correct: r.correctIdx,
           q: r.questionText, choices: r.choiceTexts, meshes: r.gateMeshes.length,
           kinds: rows.map(x => x.kind), boxesHidden: r.boxes.every(b => !window._getItemBoxes()[b].isVisible) };
});
check("a question row can be served as a wall of answer doors", built.built && built.meshes > 2, `${built.doors} doors, ${built.meshes} meshes`);
check("a wall row hides its item boxes (one question, not two)", built.boxesHidden, JSON.stringify(built.kinds));
check("every door carries one answer choice", built.choices && built.choices.length === built.doors, JSON.stringify(built.choices));
check("exactly one door is the correct one", built.correct >= 0 && built.correct < built.doors, `correct door = ${built.correct}`);
check("the gate shows a real question", typeof built.q === "string" && built.q.length > 3, built.q);

// ---- driving through the RIGHT door lets you past ----
const right = await p.evaluate(async () => {
  const g = window._getItemRows()[0].gate;
  const put = (rel, lat) => {
    playerCar.pos.x = g.pt.x + g.fx * rel + g.px * lat;
    playerCar.pos.z = g.pt.z + g.fz * rel + g.pz * lat;
  };
  playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.boostTimer = 0; playerCar.rating = 100;
  put(-6, g.doors[window._getItemRows()[0].correctIdx]); playerCar._gateRel = {};
  await new Promise((r) => requestAnimationFrame(r));            // register the "before" side
  put(2, g.doors[window._getItemRows()[0].correctIdx]);
  await new Promise((r) => setTimeout(r, 220));                  // let a few frames judge it
  return { dizzy: playerCar.dizzyTimer, boost: playerCar.boostTimer, rating: playerCar.rating };
});
check("the CORRECT door lets you through unharmed", right.dizzy === 0 && right.rating === 100, JSON.stringify(right));
check("the correct door rewards a speed boost", right.boost > 0, `boost=${right.boost}`);

// ---- a WRONG door crashes you, and drops you past the wall ----
const wrong = await p.evaluate(async () => {
  window._forceGateRow(window._getItemRows()[0]);
  const g = window._getItemRows()[0].gate;
  const r0 = window._getItemRows()[0];
  const bad = (r0.correctIdx + 1) % g.doors.length;
  const put = (rel, lat) => {
    playerCar.pos.x = g.pt.x + g.fx * rel + g.px * lat;
    playerCar.pos.z = g.pt.z + g.fz * rel + g.pz * lat;
  };
  playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.rating = 100; playerCar.invincibleTimer = 0;
  put(-6, g.doors[bad]); playerCar._gateRel = {};
  await new Promise((r) => requestAnimationFrame(r));
  put(2, g.doors[bad]);
  await new Promise((r) => setTimeout(r, 220));
  const rel = (playerCar.pos.x - g.pt.x) * g.fx + (playerCar.pos.z - g.pt.z) * g.fz;
  return { dizzy: playerCar.dizzyTimer, rating: playerCar.rating, rel,
           banner: document.getElementById("revenge-banner").textContent,
           shown: document.getElementById("revenge-banner").style.opacity };
});
check("a WRONG door makes you dizzy", wrong.dizzy > 0, `dizzyTimer=${wrong.dizzy}`);
check("a wrong door costs health", wrong.rating < 100, `rating=${wrong.rating}`);
check("after the crash you are PAST the wall (never trapped)", wrong.rel > 0, `rel=${wrong.rel.toFixed(1)}`);
check("the screen says you took the wrong door", /door|wall/i.test(wrong.banner) && wrong.shown === "1", wrong.banner);

// ---- hitting a solid pillar also crashes ----
const pillar = await p.evaluate(async () => {
  window._forceGateRow(window._getItemRows()[0]);
  const g = window._getItemRows()[0].gate;
  // a lateral spot that is NOT inside any doorway
  let lat = null;
  for (let x = -20; x <= 20; x += 0.5) if (!g.doors.some((c) => Math.abs(x - c) <= 3.0)) { lat = x; break; }
  const put = (rel) => { playerCar.pos.x = g.pt.x + g.fx * rel + g.px * lat; playerCar.pos.z = g.pt.z + g.fz * rel + g.pz * lat; };
  playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.rating = 100; playerCar.invincibleTimer = 0;
  put(-6); playerCar._gateRel = {};
  await new Promise((r) => requestAnimationFrame(r));
  put(2);
  await new Promise((r) => setTimeout(r, 220));
  return { lat, dizzy: playerCar.dizzyTimer };
});
check("smacking a solid part of the wall crashes you too", pillar.dizzy > 0, `lat=${pillar.lat} dizzy=${pillar.dizzy}`);

// ---- lightning never freezes the kart that fired it ----
const lit = await p.evaluate(async () => {
  playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.rating = 100;
  const others = window._allCars.filter((c) => c !== playerCar);
  others.forEach((c) => { c.dizzyTimer = 0; c.rating = 100; c.invincibleTimer = 0; });
  window._useItemForTest("lightning");
  await new Promise((r) => setTimeout(r, 260));
  return { selfDizzy: playerCar.dizzyTimer, selfRating: playerCar.rating,
           hitOthers: others.filter((c) => c.dizzyTimer > 0).length, others: others.length };
});
check("lightning does NOT freeze the kart that used it", lit.selfDizzy === 0 && lit.selfRating === 100, JSON.stringify(lit));
check("lightning does zap the rivals", lit.hitOthers > 0, `${lit.hitOthers}/${lit.others} rivals zapped`);

// ---- oil lands ON the road, not under a hill ----
const oil = await p.evaluate(async () => {
  const before = window._traps ? window._traps.length : null;
  window._useItemForTest("oil");
  await new Promise((r) => setTimeout(r, 200));
  const t = window._traps.filter((x) => x.type === "oil").pop();
  if (!t) return { made: false };
  return { made: true, y: t.pos.y, roadY: window._trackYAt ? window._trackYAt(t.pos.x, t.pos.z) : null,
           carY: playerCar.pos.y };
});
check("using oil actually leaves a slick behind", oil.made);
if (oil.made) check("the slick sits ON the road surface (not buried in a hill)", Math.abs(oil.y - oil.carY) < 2.5, `oilY=${oil.y?.toFixed(2)} carY=${oil.carY?.toFixed(2)}`);

// ---- attribution from a rival's fireball ----
const blame = await p.evaluate(async () => {
  playerCar.dizzyTimer = 0; playerCar.stunTimer = 0; playerCar.rating = 100; playerCar.invincibleTimer = 0;
  document.getElementById("revenge-banner").textContent = "";
  const rival = window._allCars.find((c) => c !== playerCar);
  window._creditHitForTest(playerCar, rival, "fireball");
  return { banner: document.getElementById("revenge-banner").textContent,
           stored: playerCar._lastHitBy ? playerCar._lastHitBy.label : null };
});
check("being hit names the attacker on screen", /Blasted by/.test(blame.banner) && !!blame.stored, `"${blame.banner}"`);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await b.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL KART GATE CHECKS PASS");
process.exit(fails.length ? 2 : 0);
