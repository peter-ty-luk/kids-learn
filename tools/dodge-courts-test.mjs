// Dodge Ball — court shapes, themes, the bigger matching banks, the power-block
// grab rule, and controls that follow the camera. Needs the server on :3077.
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

// ---------- matching content ----------
const banks = await p.evaluate(() => {
  const out = {};
  for (const key of Object.keys(DB.CONTENT_SETS)) {
    const bank = DB.bankFor(key);
    const ids = new Set(bank.map((x) => x.pairId));
    const sameSide = bank.filter((x) => String(x.left) === String(x.right)).length;
    out[key] = { n: bank.length, uniqueIds: ids.size, sameSide };
  }
  return out;
});
const oldSize = 18;                                    // the whole bank before this change
check("there are more matching sets than just emoji + quiz", Object.keys(banks).length >= 5, Object.keys(banks).join(", "));
check("the picture bank is far bigger than it was", banks.emoji.n >= 60, `${banks.emoji.n} pairs (was ${oldSize})`);
check("mixed bag really combines the other sets", banks.mixed.n >= banks.emoji.n + banks.opposite.n, `${banks.mixed.n} pairs`);
check("no set has duplicate pair ids", Object.values(banks).every((x) => x.n === x.uniqueIds));
check("no pair asks you to match a card with itself", Object.values(banks).every((x) => x.sameSide === 0));

const totalLocal = banks.mixed.n;
console.log(`  · local matching pairs: ${oldSize} → ${totalLocal}`);

// ---------- the court is bounded in every mode ----------
const bounds = await p.evaluate(() => {
  const out = {};
  for (const mode of ["official", "free", "survival"]) {
    DB.opts.court = mode; DB.opts.size = 2; DB.start();
    const st = DB.state, me = st.players[0];
    let escaped = 0;
    // shove the player at every wall from the middle and let physics answer
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      me.x = 480 + Math.cos(ang) * 4000; me.y = 270 + Math.sin(ang) * 4000;
      DB.tick(0.016);
      if (!DB.insideCourt(st, me.x, me.y, 2)) escaped++;
    }
    let cardsOff = 0;
    for (let i = 0; i < 40; i++) DB.tick(0.05);
    for (const c of st.parts) if (!DB.insideCourt(st, c.x, c.y, 0)) cardsOff++;
    out[mode] = { escaped, cardsOff, parts: st.parts.length };
  }
  return out;
});
for (const [name, r] of Object.entries(bounds)) {
  check(`${name}: a player can never get outside the court`, r.escaped === 0, `${r.escaped}/32 escapes`);
  check(`${name}: every card lands on the court`, r.cardsOff === 0 && r.parts > 0, `${r.parts} cards, ${r.cardsOff} off-court`);
}

// ---------- themes ----------
const themes = await p.evaluate(() => {
  const out = [];
  for (const t of Object.keys(DB.THEMES)) {
    DB.opts.court = "free"; DB.opts.theme = t; DB.start();
    const sc = BABYLON.EngineStore.Instances.find((e) => e.getRenderingCanvas() === document.getElementById("db-canvas")).scenes[0];
    const g = sc.meshes.find((m) => m.name === "court");
    out.push({ t, sky: [sc.clearColor.r, sc.clearColor.g, sc.clearColor.b].map((v) => Math.round(v * 100)).join(","), ground: !!g });
  }
  return out;
});
check("every theme builds a court", themes.every((t) => t.ground), `${themes.length} themes`);
check("themes actually change the backdrop", new Set(themes.map((t) => t.sky)).size === themes.length, themes.map((t) => `${t.t}=${t.sky}`).join(" | "));

// ---------- power blocks ----------
const power = await p.evaluate(() => {
  // 1. a block can be taken even while an unused power is already in hand
  DB.opts.court = "free"; DB.opts.size = 2; DB.opts.theme = "gym"; DB.start();
  const st = DB.state, me = st.players[0];
  st.players.forEach((q, i) => { if (i) q.frozen = 999; });
  st.powers.length = 0; st.nextPowerIn = 0; DB.topUpPowers(st, 0.1);
  const w = st.powers[0];
  me.power = { kind: "turbo", left: 3 };
  const before = me.power.kind;
  me.x = w.x; me.y = w.y; DB.tick(0.016);
  const swapped = me.power && me.power.kind === w.kind && st.powers.length === 0;

  // 2. the recorded half must match where the block really is, in every mode
  let spawned = 0, mismatched = 0;
  for (const mode of ["official", "free", "survival"]) {
    DB.opts.court = mode; DB.start();
    const s2 = DB.state;
    for (let i = 0; i < 150; i++) {
      s2.powers.length = 0; s2.nextPowerIn = 0; DB.topUpPowers(s2, 0.1);
      for (const q of s2.powers) { spawned++; if ((q.half === 0) !== (q.x < DB.MID)) mismatched++; }
    }
  }
  return { swapped, before, after: me.power && me.power.kind, spawned, mismatched };
});
check("a power block can be grabbed even when one is already in hand", power.swapped, `${power.before} → ${power.after}`);
check("a block's recorded half always matches where it is", power.mismatched === 0, `${power.mismatched}/${power.spawned} mismatched`);

// ---------- controls follow the camera ----------
const ctl = await p.evaluate(async () => {
  const eng = BABYLON.EngineStore.Instances.find((e) => e.getRenderingCanvas() === document.getElementById("db-canvas"));
  const sc = eng.scenes[0], cam = sc.activeCamera;
  DB.opts.court = "free"; DB.start();
  const st = DB.state, me = st.players[0];
  st.players.forEach((q, i) => { if (i) q.frozen = 999; });
  // where does the player end up ON SCREEN after pressing "up"?
  const screenY = () => {
    sc.updateTransformMatrix();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const v = BABYLON.Vector3.Project(new BABYLON.Vector3(me.x / 10, 0, me.y / 10), BABYLON.Matrix.Identity(), sc.getTransformMatrix(), vp);
    return { x: v.x, y: v.y };
  };
  const probe = () => {
    me.x = 480; me.y = 270;
    const a = screenY();
    const g = DB.screenToGame(0, 1);              // "up the screen"
    me.x += g.x * 60; me.y += g.y * 60;
    const up = screenY();
    me.x = 480; me.y = 270;
    const g2 = DB.screenToGame(1, 0);             // "right on the screen"
    me.x += g2.x * 60; me.y += g2.y * 60;
    const right = screenY();
    return { upMovesUp: up.y < a.y - 3, rightMovesRight: right.x > a.x + 3 };
  };
  const land = probe();                            // wide window (current viewport)
  return { land, alpha: cam.alpha };
});
check("pressing up moves you UP the screen", ctl.land.upMovesUp);
check("pressing right moves you RIGHT across the screen", ctl.land.rightMovesRight);

// same again with the window turned portrait — the view rotates, controls must follow
await p.setViewport({ width: 820, height: 1180 });
await new Promise((r) => setTimeout(r, 400));
const ctlP = await p.evaluate(() => {
  const eng = BABYLON.EngineStore.Instances.find((e) => e.getRenderingCanvas() === document.getElementById("db-canvas"));
  eng.resize(); DB.frameCourt();
  const sc = eng.scenes[0], cam = sc.activeCamera;
  const st = DB.state, me = st.players[0];
  const screenAt = () => {
    sc.updateTransformMatrix();
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const v = BABYLON.Vector3.Project(new BABYLON.Vector3(me.x / 10, 0, me.y / 10), BABYLON.Matrix.Identity(), sc.getTransformMatrix(), vp);
    return { x: v.x, y: v.y };
  };
  me.x = 480; me.y = 270;
  const a = screenAt();
  const g = DB.screenToGame(0, 1);
  me.x += g.x * 60; me.y += g.y * 60;
  const up = screenAt();
  me.x = 480; me.y = 270;
  const g2 = DB.screenToGame(1, 0);
  me.x += g2.x * 60; me.y += g2.y * 60;
  const right = screenAt();
  return { turned: Math.abs(cam.alpha + Math.PI / 2) > 0.1, upMovesUp: up.y < a.y - 3, rightMovesRight: right.x > a.x + 3 };
});
check("a portrait window turns the court a quarter turn", ctlP.turned);
check("portrait: pressing up still moves you UP the screen", ctlP.upMovesUp);
check("portrait: pressing right still moves you RIGHT", ctlP.rightMovesRight);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);
await b.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAILED` : "\nALL DODGE COURT + CONTENT CHECKS PASS");
process.exit(bad.length ? 1 : 0);
