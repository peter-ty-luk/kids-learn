// Does each game really use the whole window, with nothing pushed off screen?
// Measures at several window shapes: no page scrolling, every control inside
// the viewport, and how much of the window the actual playfield covers.
// Needs the server on :3077.
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const SIZES = [
  { name: "1920x1080 desktop", w: 1920, h: 1080 },
  { name: "1366x768 laptop", w: 1366, h: 768 },
  { name: "1280x800 laptop", w: 1280, h: 800 },
  { name: "1024x768 iPad land", w: 1024, h: 768 },
  { name: "820x1180 iPad port", w: 820, h: 1180 },
];

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] });
const p = await b.newPage();
let pageErrors = 0;
p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 200)); });

// area of the polygon the playfield's four corners project to, as a % of the window
const coverageFn = `(corners) => {
  const eng = window._eng, cam = window._cam, sc = window._scene;
  const W = eng.getRenderWidth(), H = eng.getRenderHeight();
  const vp = cam.viewport.toGlobal(W, H);
  sc.updateTransformMatrix();
  const m = sc.getTransformMatrix();
  const pts = corners.map((c) => {
    const v = BABYLON.Vector3.Project(new BABYLON.Vector3(c[0], 0, c[1]), BABYLON.Matrix.Identity(), m, vp);
    return [v.x, v.y];
  });
  // shoelace over the corners in order TL, TR, BR, BL
  const o = [pts[0], pts[1], pts[3], pts[2]];
  let a = 0;
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += o[i][0] * o[j][1] - o[j][0] * o[i][1]; }
  const area = Math.abs(a) / 2;
  const inside = pts.every((q) => q[0] >= -2 && q[0] <= W + 2 && q[1] >= -2 && q[1] <= H + 2);
  return { pct: Math.round((area / (W * H)) * 100), inside, W, H };
}`;

// ---------------- DODGE BALL ----------------
console.log("\nMATCH DODGE BALL");
await p.goto("http://localhost:3077/dodge.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.DB, { timeout: 20000 });
await p.evaluate(() => { DB.opts.court = "free"; DB.opts.size = 2; DB.start(); });
await p.evaluate(() => { window._eng = null; });
// reach the engine/camera the game made
await p.evaluate(`(() => {
  const cv = document.getElementById('db-canvas');
  window._eng = BABYLON.EngineStore.Instances.find((e) => e.getRenderingCanvas() === cv);
  window._scene = window._eng.scenes[0];
  window._cam = window._scene.activeCamera;
})()`);

for (const s of SIZES) {
  await p.setViewport({ width: s.w, height: s.h });
  await new Promise((r) => setTimeout(r, 350));
  await p.evaluate(() => { window._eng.resize(); DB.frameCourt(); });
  await new Promise((r) => setTimeout(r, 250));
  const m = await p.evaluate(`(() => {
    const cov = (${coverageFn})([[0,0],[96,0],[0,54],[96,54]]);
    const doc = document.documentElement;
    const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, rt: r.right, w: r.width, h: r.height }; };
    const cv = document.getElementById('db-canvas').getBoundingClientRect();
    return {
      cov,
      scrolls: doc.scrollHeight > window.innerHeight + 1 || doc.scrollWidth > window.innerWidth + 1,
      canvasPct: Math.round((cv.width * cv.height) / (window.innerWidth * window.innerHeight) * 100),
      hud: rect('hud'), tray: rect('tray'), throwBtn: rect('act-throw'), time: rect('hud-time'),
      vw: window.innerWidth, vh: window.innerHeight,
    };
  })()`);
  const controlsIn = m.hud && m.tray && m.hud.t >= 0 && m.tray.b <= m.vh + 1 && m.throwBtn.rt <= m.vw + 1 && m.throwBtn.l >= 0;
  check(`dodge ${s.name}: nothing scrolls off the page`, !m.scrolls);
  check(`dodge ${s.name}: canvas fills the window`, m.canvasPct >= 97, `${m.canvasPct}%`);
  check(`dodge ${s.name}: hearts/clock/throw all on screen`, !!controlsIn);
  check(`dodge ${s.name}: whole court visible`, m.cov.inside, `court covers ${m.cov.pct}% of the window`);
  check(`dodge ${s.name}: court fills most of the window`, m.cov.pct >= 55, `${m.cov.pct}%`);
}

// ---------------- TOWER DEFENSE ----------------
console.log("\nTOWER QUIZ DEFENSE");
await p.goto("http://localhost:3077/tower.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.TD && TD.ready, { timeout: 30000 });
await p.evaluate(() => { TD.start(); });
await p.evaluate(`(() => {
  const cv = document.getElementById('td-canvas');
  window._eng = BABYLON.EngineStore.Instances.find((e) => e.getRenderingCanvas() === cv);
  window._scene = window._eng.scenes[0];
  window._cam = window._scene.activeCamera;
})()`);

for (const s of SIZES) {
  await p.setViewport({ width: s.w, height: s.h });
  await new Promise((r) => setTimeout(r, 350));
  await p.evaluate(() => { window._eng.resize(); TD.frameField && TD.frameField(); });
  await new Promise((r) => setTimeout(r, 250));
  const m = await p.evaluate(`(() => {
    const cov = (${coverageFn})([[47-56,25.8-33],[47+56,25.8-33],[47-56,25.8+33],[47+56,25.8+33]]);
    const doc = document.documentElement;
    const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, rt: r.right, w: r.width, h: r.height }; };
    const cv = document.getElementById('td-canvas').getBoundingClientRect();
    const choices = document.querySelectorAll('#q-choices button');
    const lastChoice = choices.length ? choices[choices.length - 1].getBoundingClientRect() : null;
    return {
      cov,
      scrolls: doc.scrollHeight > window.innerHeight + 1 || doc.scrollWidth > window.innerWidth + 1,
      canvasPct: Math.round((cv.width * cv.height) / (window.innerWidth * window.innerHeight) * 100),
      hud: rect('hud'), prompt: rect('q-prompt'), shop: rect('shop'), quit: rect('quit-btn'),
      lastChoiceBottom: lastChoice ? lastChoice.bottom : null, nChoices: choices.length,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  })()`);
  const qIn = m.prompt && m.prompt.b <= m.vh + 1 && m.prompt.t >= 0;
  const choicesIn = m.lastChoiceBottom != null && m.lastChoiceBottom <= m.vh + 1;
  const shopIn = m.shop && m.shop.rt <= m.vw + 1 && m.shop.t >= 0;
  check(`tower ${s.name}: nothing scrolls off the page`, !m.scrolls);
  check(`tower ${s.name}: question + all answers on screen`, !!qIn && choicesIn, `${m.nChoices} choices, last ends at ${Math.round(m.lastChoiceBottom)}/${m.vh}`);
  check(`tower ${s.name}: shop + leave button on screen`, !!shopIn && m.quit && m.quit.b <= m.vh + 1);
  check(`tower ${s.name}: battlefield takes most of the window`, m.canvasPct >= 55, `canvas ${m.canvasPct}% of window`);
  check(`tower ${s.name}: whole island visible`, m.cov.inside, `island covers ${m.cov.pct}% of the window`);
}

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);
await b.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAILED` : "\nALL SCREEN-FIT CHECKS PASS");
process.exit(bad.length ? 1 : 0);
