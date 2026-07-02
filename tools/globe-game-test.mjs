// Globe Quiz test (WebGL → swiftshader). Verifies the geo math, that a ray-pick
// on the real 3D globe maps back to the lon/lat shown, and the solo + hotseat
// round/scoring flow via window.GLOBE.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };
const browser = await puppeteer.launch(LAUNCH);
const p = await browser.newPage();
let pageErrors = 0; p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 160)); });
await p.goto("http://localhost:3077/globe.html", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.GLOBE && GLOBE.ready === true, { timeout: 60000 });
check("globe scene loads (Babylon + Earth texture)", await p.evaluate(() => !!(GLOBE.scene && GLOBE.sphere && GLOBE.scene.getMeshByName("earth"))));

// ---- geo math ----
const math = await p.evaluate(() => {
  const rt = (lon, lat) => { const r = GLOBE.vecToLonLat(GLOBE.lonLatToVec(lon, lat)); return Math.max(Math.abs(r.lon - lon), Math.abs(r.lat - lat)); };
  const cities = [[-74, 40.7], [139.7, 35.7], [114.17, 22.32], [18.4, -33.9], [-0.1, 51.5]];
  const maxErr = Math.max(...cities.map((c) => rt(c[0], c[1])));
  const hkTokyo = GLOBE.haversine({ lon: 114.17, lat: 22.32 }, { lon: 139.7, lat: 35.7 });
  const nyLondon = GLOBE.haversine({ lon: -74, lat: 40.7 }, { lon: -0.1, lat: 51.5 });
  return { maxErr, hkTokyo: Math.round(hkTokyo), nyLondon: Math.round(nyLondon), s0: GLOBE.scoreFor(0), s3000: GLOBE.scoreFor(3000) };
});
check("lon/lat ↔ 3D is an exact round-trip", math.maxErr < 1e-6, `maxErr=${math.maxErr.toExponential(1)}`);
check("great-circle distance is correct (HK→Tokyo ≈ 2900km)", Math.abs(math.hkTokyo - 2900) < 200, `${math.hkTokyo}km`);
check("great-circle distance is correct (NY→London ≈ 5570km)", Math.abs(math.nyLondon - 5570) < 250, `${math.nyLondon}km`);
check("scoring: bullseye = 1000, far = much less", math.s0 === 1000 && math.s3000 < 200, `0km=${math.s0} 3000km=${math.s3000}`);

// ---- tap correctness: ray-pick the real globe at a city, read back the lon/lat ----
const tap = await p.evaluate(() => {
  const test = (lon, lat) => {
    GLOBE.face(lon, lat); GLOBE.scene.render();
    const surf = GLOBE.lonLatToVec(lon, lat);                 // point on the surface
    const origin = GLOBE.camera.position;
    const ray = new BABYLON.Ray(origin, surf.subtract(origin).normalize(), 100);
    const hit = GLOBE.scene.pickWithRay(ray, (m) => m === GLOBE.sphere);
    if (!hit || !hit.hit) return 999;
    const ll = GLOBE.vecToLonLat(hit.pickedPoint);
    return GLOBE.haversine({ lon, lat }, ll); // km between tapped spot and intended
  };
  return { ny: Math.round(test(-74, 40.7)), tokyo: Math.round(test(139.7, 35.7)), syd: Math.round(test(151.2, -33.9)) };
});
check("tapping the globe maps back to the right place (within ~50km)", tap.ny < 60 && tap.tokyo < 60 && tap.syd < 60, JSON.stringify(tap));

// ---- real input: draggable / zoomable / tap-to-pin on the actual canvas ----
await p.evaluate(() => { GLOBE.opts.players = 1; GLOBE.start(); document.getElementById("handoff").classList.remove("show"); });
await sleep(400);
check("canvas renders at full size once the game opens (not 300×150)", (await p.evaluate(() => GLOBE.scene.getEngine().getRenderWidth())) > 400);
const box = await p.evaluate(() => { const r = document.getElementById("globe-canvas").getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
const cam0 = await p.evaluate(() => ({ a: GLOBE.camera.alpha, b: GLOBE.camera.beta, r: GLOBE.camera.radius }));
await p.mouse.move(box.cx - 70, box.cy); await p.mouse.down();
for (let i = 1; i <= 8; i++) { await p.mouse.move(box.cx - 70 + i * 18, box.cy + i * 3); await sleep(10); }
await p.mouse.up(); await sleep(120);
const cam1 = await p.evaluate(() => ({ a: GLOBE.camera.alpha, b: GLOBE.camera.beta, r: GLOBE.camera.radius }));
check("dragging the globe rotates it", cam1.a !== cam0.a || cam1.b !== cam0.b);
await p.mouse.move(box.cx, box.cy); await p.mouse.wheel({ deltaY: -400 }); await sleep(120);
check("scrolling/pinching zooms the globe", (await p.evaluate(() => GLOBE.camera.radius)) !== cam1.r);
// a finger drag (pointerType touch) also rotates — what tablets generate
const camT0 = await p.evaluate(() => GLOBE.camera.alpha);
await p.evaluate((cx, cy) => { const cv = document.getElementById("globe-canvas"); const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: t === "pointerup" ? 0 : 1 })); ev("pointerdown", cx - 60, cy); for (let i = 1; i <= 8; i++) ev("pointermove", cx - 60 + i * 15, cy + i * 2); ev("pointerup", cx + 60, cy + 16); }, box.cx, box.cy);
await sleep(120);
check("a finger drag (touch) rotates the globe too", (await p.evaluate(() => GLOBE.camera.alpha)) !== camT0);
await p.mouse.click(box.cx + 25, box.cy - 12); await sleep(150);
check("tapping the globe drops a pin", await p.evaluate(() => !!(GLOBE.state && GLOBE.state.pending)));

// ---- SOLO flow: perfect guesses should score ~1000 each ----
const solo = await p.evaluate(async () => {
  GLOBE.opts.players = 1; GLOBE.opts.rounds = 3; GLOBE.opts.diff = "easy"; GLOBE.start();
  let revealsSeen = 0;
  for (let r = 0; r < 3; r++) {
    const place = GLOBE.state.places[GLOBE.state.round];
    GLOBE.pick({ lon: place.lon, lat: place.lat });   // perfect guess
    GLOBE.lock();
    if (document.getElementById("reveal").classList.contains("show")) revealsSeen++;
    GLOBE.next();
  }
  return { score: GLOBE.state.scores[0], revealsSeen, done: document.getElementById("results").classList.contains("show") };
});
check("solo: perfect guesses score ~1000 each (≈3000 total)", solo.score >= 2900, `score=${solo.score}`);
check("solo: a reveal panel shows after each round", solo.revealsSeen === 3);
check("solo: results screen after the last round", solo.done);

// ---- a far guess scores low ----
const far = await p.evaluate(() => {
  GLOBE.opts.players = 1; GLOBE.opts.rounds = 1; GLOBE.start();
  const place = GLOBE.state.places[0];
  GLOBE.pick({ lon: place.lon + 120, lat: -(place.lat) }); GLOBE.lock();
  return GLOBE.state.scores[0];
});
check("a wildly wrong guess scores far fewer points", far < 300, `score=${far}`);

// ---- HOTSEAT: 2 players, P1 perfect, P2 far → P1 wins ----
const two = await p.evaluate(() => {
  GLOBE.opts.players = 2; GLOBE.opts.rounds = 2; GLOBE.opts.diff = "easy"; GLOBE.start();
  let revealRows = 0;
  for (let r = 0; r < 2; r++) {
    for (let t = 0; t < 2; t++) {
      document.getElementById("handoff").classList.remove("show"); // dismiss the pass-device screen
      const place = GLOBE.state.places[GLOBE.state.round];
      if (t === 0) GLOBE.pick({ lon: place.lon, lat: place.lat });        // P1 perfect
      else GLOBE.pick({ lon: place.lon + 80, lat: place.lat + 30 });      // P2 off
      GLOBE.lock();
    }
    if (r === 0) revealRows = document.querySelectorAll("#reveal-rows .rev-row").length;
    GLOBE.next();
  }
  const order = GLOBE.state.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  return { p1: GLOBE.state.scores[0], p2: GLOBE.state.scores[1], winner: order[0].i, revealRows, results: document.getElementById("results").classList.contains("show") };
});
check("hotseat: reveal lists every player's guess", two.revealRows === 2, `rows=${two.revealRows}`);
check("hotseat: the more accurate player scores higher", two.p1 > two.p2, `P1=${two.p1} P2=${two.p2}`);
check("hotseat: winner is the most accurate player + results shown", two.winner === 0 && two.results);

// ---- FLAG mode: the clue is a country flag; tapping inside the country = bullseye ----
const flag = await p.evaluate(() => {
  const inJP = GLOBE.pointInCountry(139.7, 35.7, "Japan");   // Tokyo is inside Japan
  const notJP = GLOBE.pointInCountry(-74, 40.7, "Japan");    // New York is not
  GLOBE.opts.clue = "flag"; GLOBE.opts.players = 1; GLOBE.opts.rounds = 2; GLOBE.opts.diff = "easy"; GLOBE.start();
  const target = GLOBE.state.places[0];
  const flagEl = document.getElementById("place-flag");
  const flagShown = flagEl.style.display !== "none" && /\/flags\//.test(flagEl.src);
  const nameHidden = document.getElementById("place-name").textContent === "this country";
  GLOBE.pick({ lon: target.lon, lat: target.lat }); GLOBE.lock();   // tap the capital (inside the country)
  const r = GLOBE.state.roundPicks[0];
  return { inJP, notJP, flagShown, nameHidden, hasCC: !!target.cc, pts: r.pts, inside: r.inside };
});
check("flag mode: point-in-country works (Tokyo∈Japan, NY∉Japan)", flag.inJP && !flag.notJP);
check("flag mode: clue shows a flag image + hides the country name", flag.flagShown && flag.nameHidden && flag.hasCC);
check("flag mode: tapping inside the country scores a bullseye (1000)", flag.pts === 1000 && flag.inside, JSON.stringify(flag));

// the reported bug: a wrong country (even a close neighbour) must NOT read as correct
const wrong = await p.evaluate(() => {
  GLOBE.opts.clue = "flag"; GLOBE.opts.players = 1; GLOBE.opts.rounds = 1; GLOBE.start();
  GLOBE.state.places[0] = GLOBE.COUNTRIES.find((c) => c.name === "Japan");
  document.getElementById("handoff").classList.remove("show");
  GLOBE.pick({ lon: 126.98, lat: 37.57 }); GLOBE.lock(); // Seoul: WRONG country, but close to Japan
  const r = GLOBE.state.roundPicks[0];
  return { pts: r.pts, inside: r.inside, clicked: r.clicked, scoreline: document.getElementById("scoreline").textContent };
});
check("flag mode: a wrong country scores 0 — even a close neighbour (no partial credit)", wrong.pts === 0 && wrong.inside === false, JSON.stringify(wrong));
check("flag mode: wrong guess names the tapped country AND the correct answer", wrong.clicked === "South Korea" && /correct answer is Japan/.test(wrong.scoreline), JSON.stringify(wrong));
check("countryAt finds the tapped country", await p.evaluate(() => GLOBE.countryAt(2.35, 48.86) === "France" && GLOBE.countryAt(0, 0) === null));

// reveal must tell the correct answer (name + location) when you're wrong
const rev = await p.evaluate(() => {
  GLOBE.opts.players = 1; GLOBE.opts.clue = "name"; GLOBE.opts.rounds = 1; GLOBE.start();
  GLOBE.state.places[0] = GLOBE.PLACES.find((x) => x.name === "Tokyo");
  document.getElementById("handoff").classList.remove("show");
  GLOBE.pick({ lon: -74, lat: 40 }); GLOBE.lock(); // tap New York when the answer is Tokyo
  return { title: document.getElementById("reveal-title").textContent, scoreline: document.getElementById("scoreline").textContent, hasLabel: !!GLOBE.scene.getMeshByName("answerLabel") };
});
check("reveal states the correct answer when wrong (name mode)", /Tokyo/.test(rev.title) && /answer is Tokyo/.test(rev.scoreline), JSON.stringify(rev));
check("reveal labels the correct location on the globe", rev.hasLabel);

check("no page errors during the whole run", pageErrors === 0, `errors=${pageErrors}`);

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL GLOBE CHECKS PASS");
process.exit(fails.length ? 2 : 0);
