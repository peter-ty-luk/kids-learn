// Verify the Pixabay audio is wired in: music track loads + loops on race start,
// SFX preload, and playSfx() succeeds — with no console/network errors.
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const audioResp = [];
const errors = [];
page.on("response", (r) => { const u = r.url(); if (/\/assets\/audio\//.test(u)) audioResp.push({ url: u.split("/assets/audio/")[1], status: r.status() }); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 100)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console: " + m.text().slice(0, 100)); });

await page.goto("http://localhost:3077", { waitUntil: "networkidle2" });
await page.click("#offline-btn");            // also triggers SoundManager.init() → SFX preload
await page.waitForSelector(".car-card");
await page.evaluate(() => document.querySelectorAll(".car-card")[0].click());
await page.click('.track-card[data-track-id="0"]');
await page.click("#start-race-btn");
await page.waitForFunction(() => typeof AssetManager !== "undefined" && AssetManager.loaded === true, { timeout: 45000 });
await page.waitForFunction(() => window._raceEnded === false, { timeout: 20000 }); // GO → startMusic()
await sleep(2500);

// explicitly exercise a few SFX through the game's API
const sfxOk = await page.evaluate(() => {
  const keys = ["boost", "crash", "win", "lap", "horn"];
  return keys.map(k => ({ k, ok: SoundManager.playSfx(k) }));
});
await sleep(800);

const music = audioResp.filter(a => a.url.startsWith("music/") && a.url.endsWith(".mp3"));
const sfx = audioResp.filter(a => a.url.startsWith("sfx/"));
const tracksJson = audioResp.find(a => a.url === "music/tracks.json");

console.log(`tracks.json: ${tracksJson ? "HTTP " + tracksJson.status : "NOT REQUESTED"}`);
console.log(`music track loaded: ${music.length ? music.map(m => m.url + "(" + m.status + ")").join(", ") : "NONE"}`);
console.log(`sfx files fetched: ${sfx.length} (statuses: ${[...new Set(sfx.map(s => s.status))].join(",")})`);
console.log(`playSfx results: ${sfxOk.map(s => s.k + "=" + (s.ok ? "✓" : "✗")).join(" ")}`);
console.log(`bad statuses: ${audioResp.filter(a => a.status >= 400).map(a => a.url + " " + a.status).join(", ") || "none"}`);
console.log(`errors: ${errors.length ? errors.join(" | ") : "none"}`);

const pass = tracksJson && tracksJson.status === 200 && music.length >= 1 && music.every(m => m.status === 200 || m.status === 206)
  && sfx.length >= 5 && sfxOk.every(s => s.ok) && !audioResp.some(a => a.status >= 400) && errors.length === 0;
console.log(`\n${pass ? "✓ AUDIO WIRED IN AND PLAYING" : "✗ PROBLEM"}`);
await browser.close();
process.exit(pass ? 0 : 2);
