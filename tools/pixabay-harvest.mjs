// Harvest direct cdn.pixabay.com mp3 URLs by clicking each track's play button
// (the URL only loads on play). Writes a JSON manifest to /tmp/pix-manifest.json.
const fs = await import("fs");
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MUSIC_QUERIES = ["racing", "race car", "fast sport", "energetic action", "upbeat electronic game", "driving rock", "adrenaline", "chiptune racing"];
const SFX_WANTS = [
  ["engine", "car engine loop"], ["boost", "power up whoosh"], ["crash", "car crash"],
  ["hit", "metal impact"], ["pickup", "power up collect"], ["coin", "coin pickup"],
  ["lap", "success ding bell"], ["win", "win fanfare"], ["countdown", "racing countdown beep"],
  ["click", "ui click"], ["start", "race start beep"], ["horn", "train horn"],
];

const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36");

let lastMp3 = null;
page.on("response", (r) => {
  const u = r.url();
  if (/cdn\.pixabay\.com\/.*audio_[a-z0-9]+\.mp3/i.test(u)) lastMp3 = u.split("?")[0];
});

async function harvest(url, max, taken) {
  const out = [];
  try { await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 }); }
  catch { return out; }
  await sleep(2000);
  const n = await page.$$eval('[class*="audioRow"]', (els) => els.length).catch(() => 0);
  for (let i = 0; i < n && out.length < max; i++) {
    lastMp3 = null;
    const meta = await page.evaluate((idx) => {
      const rows = document.querySelectorAll('[class*="audioRow"]');
      const row = rows[idx]; if (!row) return null;
      const btn = row.querySelector('button[class*="play" i], [class*="playOverlay" i]');
      if (btn) btn.click();
      const link = row.querySelector('a[href*="/music/"], a[href*="/sound-effects/"]');
      const dur = (row.innerText.match(/\d+:\d{2}/) || [])[0] || "";
      return { title: (link ? link.textContent : row.innerText.split("\n")[0]).trim().slice(0, 60), dur };
    }, i);
    if (!meta) continue;
    for (let t = 0; t < 40 && !lastMp3; t++) await sleep(100); // wait for the play→fetch
    if (lastMp3 && !taken.has(lastMp3)) {
      taken.add(lastMp3);
      out.push({ title: meta.title, dur: meta.dur, url: lastMp3 });
    }
    await sleep(150);
  }
  return out;
}

const taken = new Set();
const music = [];
for (const q of MUSIC_QUERIES) {
  if (music.length >= 12) break;
  const got = await harvest(`https://pixabay.com/music/search/${encodeURIComponent(q)}/`, 4, taken);
  got.forEach((g) => { g.query = q; });
  music.push(...got);
  console.log(`music "${q}": +${got.length} (total ${music.length})`);
}

const sfx = [];
for (const [key, q] of SFX_WANTS) {
  const got = await harvest(`https://pixabay.com/sound-effects/search/${encodeURIComponent(q)}/`, 1, taken);
  if (got.length) { got[0].key = key; sfx.push(got[0]); }
  console.log(`sfx ${key} ("${q}"): ${got.length ? "✓ " + got[0].title : "—"}`);
}

fs.writeFileSync("/tmp/pix-manifest.json", JSON.stringify({ music: music.slice(0, 12), sfx }, null, 2));
console.log(`\nmanifest written: ${Math.min(music.length,12)} music + ${sfx.length} sfx`);
await browser.close();
