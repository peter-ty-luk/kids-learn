// Touch / tablet playability test. Emulates a coarse-pointer touch device and
// drives each game with synthetic touch/pointer events:
//   Maze  — d-pad shows, canvas swipe sets a move key, tap drops a piece.
//   Match — board lays out for mobile, tapping two matching cards matches them.
//   Kart  — on-screen controls appear while racing and set the same gameKeys
//           the keyboard uses; the item button replays a Space press.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAUNCH = { executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage"] };
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };
const browser = await puppeteer.launch(LAUNCH);

async function touchPage() {
  const p = await browser.newPage();
  // puppeteer's emulateMediaFeatures rejects "pointer", so set it via raw CDP
  const client = await p.target().createCDPSession();
  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "any-pointer", value: "coarse" }] });
  await p.setViewport({ width: 820, height: 1100, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 140)));
  return p;
}
// dispatch a synthetic touch sequence on an element by id
const touchSwipe = (page, id, dx, dy) => page.evaluate((id, dx, dy) => {
  const el = document.getElementById(id), r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const T = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  const ev = (type, x, y, end) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: end ? [] : [T(x, y)], changedTouches: [T(x, y)] }));
  ev("touchstart", cx, cy); ev("touchmove", cx + dx, cy + dy);
}, id, dx, dy);
const touchEnd = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id), r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const T = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
  el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [T] }));
}, id);
const touchTap = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id), r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const T = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
  el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [T], changedTouches: [T] }));
  el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [T] }));
}, id);

// ===== MAZE =====
{
  const p = await touchPage();
  await p.goto("http://localhost:3077/maze.html", { waitUntil: "networkidle2" });
  await p.waitForFunction(() => window.MZ && MZ.sets && MZ.sets.length > 0, { timeout: 15000 });
  await p.evaluate(() => { Object.assign(MZ.opts, { players: 1, size: "medium", dark: false, traps: false }); MZ.start(); });
  await p.waitForFunction(() => MZ.state && MZ.state.status === "playing");

  const dpad = await p.evaluate(() => getComputedStyle(document.getElementById("dpad")).display);
  check("maze: d-pad is shown on a touch device", dpad === "flex", `display=${dpad}`);

  // swipe right on the canvas → the move key ArrowRight is held
  await touchSwipe(p, "maze-canvas", 80, 0);
  const swiped = await p.evaluate(() => MZ.keys.has("ArrowRight"));
  check("maze: swiping the canvas sets a movement key", swiped);
  await touchEnd(p, "maze-canvas");
  const cleared = await p.evaluate(() => MZ.keys.size === 0);
  check("maze: lifting the finger stops movement", cleared);

  // a quick TAP is the action: tap on a piece picks it up; tap again drops it
  await p.evaluate(() => { const L = MZ.state.items.find(i => i.side === "left" && i.owner === 0); MZ.teleport(0, L.x, L.y); });
  await touchTap(p, "maze-canvas");
  const carried = await p.evaluate(() => !!MZ.state.players[0].carrying);
  await touchTap(p, "maze-canvas");
  const dropped = await p.evaluate(() => !MZ.state.players[0].carrying);
  check("maze: a quick tap picks up a piece, and tapping again drops it", carried && dropped);

  // d-pad button works (touchstart holds the key)
  await p.evaluate(() => { const b = document.querySelector('#dpad [data-dir="up"]'); b.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true })); });
  const dpadHeld = await p.evaluate(() => MZ.keys.has("ArrowUp"));
  check("maze: d-pad button holds a direction", dpadHeld);
  await p.close();
}

// ===== MATCH =====
{
  const p = await touchPage();
  await p.goto("http://localhost:3077/match.html", { waitUntil: "networkidle2" });
  await p.waitForFunction(() => document.querySelectorAll("#subject-chips .chip").length > 0, { timeout: 15000 });
  await p.evaluate(() => { state.subject = "Mathematics"; document.querySelector('.mode[data-mode="easy"]').click(); document.getElementById("start-btn").click(); });
  await p.waitForFunction(() => document.querySelectorAll("#board .tile").length > 0, { timeout: 8000 });
  const fit = await p.evaluate(() => { const b = document.getElementById("board"); return { noOverflow: b.scrollWidth <= window.innerWidth + 2, cols: getComputedStyle(b).gridTemplateColumns.split(" ").length }; });
  check("match: board fits the screen with no horizontal overflow", fit.noOverflow, JSON.stringify(fit));
  // tapping a card registers immediately (tap → click handler → selected)
  const tapReg = await p.evaluate(() => { const c = state.cards[0]; c.el.click(); return c.el.classList.contains("sel"); });
  check("match: tapping a card registers the tap (selects it)", tapReg);
  // and a matching pair resolves after the flip animation
  const matched = await p.evaluate(() => new Promise((res) => {
    const L = state.cards.find(c => c.side === "left" && !c.matched);
    const R = state.cards.find(c => c.side === "right" && c.pairId === L.pairId);
    // clear any current selection first
    if (state.selected.length) state.selected[0].el.click();
    L.el.click(); R.el.click();
    setTimeout(() => res(L.matched && R.matched), 400);
  }));
  check("match: tapping two matching cards matches them", matched);
  await p.close();
}

// ===== KART =====
{
  const p = await touchPage();
  await p.goto("http://localhost:3077/index.html", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#offline-btn", { timeout: 30000 });
  await p.waitForFunction(() => typeof gameKeys !== "undefined", { timeout: 15000 }).catch(() => {});

  const hiddenAtMenu = await p.evaluate(() => getComputedStyle(document.getElementById("touch-controls")).display);
  check("kart: touch controls hidden in the menu", hiddenAtMenu === "none", `display=${hiddenAtMenu}`);

  // simulate "race HUD on screen" → controls appear (MutationObserver + coarse media)
  await p.evaluate(() => { document.getElementById("hud").style.display = "block"; });
  await sleep(150);
  const shown = await p.evaluate(() => ({ inRace: document.body.classList.contains("in-race"), disp: getComputedStyle(document.getElementById("touch-controls")).display }));
  check("kart: controls appear while racing on a touch device", shown.inRace && shown.disp === "flex", JSON.stringify(shown));

  // press the steering + gas buttons → they set the same gameKeys the keyboard uses
  const press = (key, on) => p.evaluate((key, on) => { const b = document.querySelector(`#touch-controls [data-key="${key}"]`); b.dispatchEvent(new PointerEvent(on ? "pointerdown" : "pointerup", { bubbles: true })); }, key, on);
  await press("ArrowLeft", true);
  check("kart: holding ◀ steers left (gameKeys.ArrowLeft)", await p.evaluate(() => gameKeys["ArrowLeft"] === true));
  await press("ArrowLeft", false);
  check("kart: releasing ◀ stops steering", await p.evaluate(() => gameKeys["ArrowLeft"] === false));
  await press("ArrowUp", true);
  check("kart: holding ▲ accelerates (gameKeys.ArrowUp)", await p.evaluate(() => gameKeys["ArrowUp"] === true));
  await press("ArrowUp", false);

  // item button replays a Space keydown
  const itemFired = await p.evaluate(() => new Promise((res) => {
    const h = (e) => { if (e.code === "Space") { window.removeEventListener("keydown", h); res(true); } };
    window.addEventListener("keydown", h);
    document.querySelector('#touch-controls [data-key="Space"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    setTimeout(() => res(false), 500);
  }));
  check("kart: item button replays a Space press", itemFired);
  await p.close();
}

await browser.close();
const fails = results.filter(r => !r.ok);
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL TOUCH CHECKS PASS");
process.exit(fails.length ? 2 : 0);
