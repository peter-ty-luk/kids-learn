// Harvest high-energy music from Pixabay for the non-racing games.
// The existing 10 tracks are all car-racing beds, which read as "boring" in a
// dodge-ball or tower-defense match. These queries aim at arcade / action /
// epic energy instead. Writes /tmp/pix-exciting.json for pixabay-download.mjs.
const fs = await import("fs");
const puppeteer = (await import("puppeteer-core")).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tag = which mood bucket the track lands in, so each game can pick a fitting one
const QUERIES = [
  ["arcade", "arcade game music"],
  ["arcade", "chiptune upbeat"],
  ["action", "epic action sport"],
  ["action", "adrenaline energetic rock"],
  ["battle", "epic battle drums"],
  ["battle", "boss fight music"],
  ["fun", "happy energetic kids"],
  ["fun", "funky upbeat playful"],
  ["electro", "high energy electronic"],
  ["electro", "dance workout energy"],
];
const PER_QUERY = 3;
const WANT = 14;

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
  await sleep(2200);
  const n = await page.$$eval('[class*="audioRow"]', (els) => els.length).catch(() => 0);
  for (let i = 0; i < n && out.length < max; i++) {
    lastMp3 = null;
    const meta = await page.evaluate((idx) => {
      const rows = document.querySelectorAll('[class*="audioRow"]');
      const row = rows[idx]; if (!row) return null;
      const btn = row.querySelector('button[class*="play" i], [class*="playOverlay" i]');
      if (btn) btn.click();
      const link = row.querySelector('a[href*="/music/"]');
      const dur = (row.innerText.match(/\d+:\d{2}/) || [])[0] || "";
      return { title: (link ? link.textContent : row.innerText.split("\n")[0]).trim().slice(0, 60), dur };
    }, i);
    if (!meta) continue;
    for (let t = 0; t < 40 && !lastMp3; t++) await sleep(100);
    if (lastMp3 && !taken.has(lastMp3)) { taken.add(lastMp3); out.push({ title: meta.title, dur: meta.dur, url: lastMp3 }); }
    await sleep(150);
  }
  return out;
}

const taken = new Set();
const music = [];
for (const [tag, q] of QUERIES) {
  if (music.length >= WANT) break;
  const got = await harvest(`https://pixabay.com/music/search/${encodeURIComponent(q)}/`, PER_QUERY, taken);
  got.forEach((g) => { g.tag = tag; g.query = q; });
  music.push(...got);
  console.log(`"${q}" [${tag}]: +${got.length} (total ${music.length})`);
}

fs.writeFileSync("/tmp/pix-exciting.json", JSON.stringify({ music: music.slice(0, WANT) }, null, 2));
console.log(`\nmanifest written: ${Math.min(music.length, WANT)} tracks -> /tmp/pix-exciting.json`);
await browser.close();
