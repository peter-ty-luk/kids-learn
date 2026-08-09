// Does each game actually request and play a music file, and does the mute
// button really silence it? Watches real network requests, because `new Audio()`
// never puts an element in the DOM — querying for <audio> finds nothing.
// Needs the server on :3077.
const puppeteer = (await import("puppeteer-core")).default;
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? "  " + extra : ""}`); };

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
         "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });

const GAMES = [
  { name: "dodge", url: "dodge.html", ready: "window.DB", start: "DB.start()", vol: 0.17 },
  { name: "tower", url: "tower.html", ready: "window.TD && TD.ready", start: "TD.start()", vol: 0.15 },
];

for (const g of GAMES) {
  const p = await b.newPage();
  let pageErrors = 0;
  const mp3s = [];
  p.on("pageerror", (e) => { pageErrors++; console.log("PAGEERR:", e.message.slice(0, 200)); });
  p.on("request", (r) => { if (/\.mp3(\?|$)/i.test(r.url())) mp3s.push(r.url().split("/").pop()); });
  await p.goto(`http://localhost:3077/${g.url}`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(g.ready, { timeout: 30000 });
  // the real path: init sound, start the game, start the music
  await p.evaluate(`(async () => {
    window._soundForTest.init();
    ${g.start};
    window._soundForTest.startMusic();
    if (window._soundForTest._ready) await window._soundForTest._ready;
    window._soundForTest.startMusic();
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const st = await p.evaluate(`(() => { const s = window._soundForTest;
    return { playing: !!s.music, vol: s.music && s.music.volume, loop: s.music && s.music.loop,
             src: s.music && s.music.src.split('/').pop(), n: s.tracks.length,
             pool: s.tracks.slice(0, Math.max(3, Math.ceil(s.tracks.length * 0.5))).map((t) => t.file),
             slowest: s.tracks[s.tracks.length - 1].file,
             hasEnergy: s.tracks.every((t) => typeof t.energy === 'number'),
             sorted: s.tracks.every((t, i, a) => i === 0 || a[i - 1].energy >= t.energy) }; })()`);
  check(`${g.name}: a music track is loaded and playing`, st.playing && !!st.src, st.src);
  check(`${g.name}: the mp3 really is fetched`, mp3s.length > 0, mp3s.join(", ") || "none");
  check(`${g.name}: it loops at a background volume`, st.loop === true && Math.abs(st.vol - g.vol) < 0.001, `vol=${st.vol}`);
  check(`${g.name}: tracks.json carries the measured energy`, st.hasEnergy && st.n >= 20, `${st.n} tracks`);
  check(`${g.name}: tracks are ordered liveliest first`, st.sorted);
  check(`${g.name}: the track picked is from the lively end`, st.pool.includes(st.src), `picked ${st.src}, pool of ${st.pool.length}`);
  check(`${g.name}: the dullest track is never picked for an action game`, st.src !== st.slowest, `dullest=${st.slowest}`);
  // mute → silence, unmute → sound again
  const muted = await p.evaluate(`(() => { const s = window._soundForTest; s.toggle(); return { on: s.on, music: !!s.music }; })()`);
  check(`${g.name}: muting stops the music`, muted.on === false && muted.music === false);
  const un = await p.evaluate(`(() => { const s = window._soundForTest; s.toggle(); return { on: s.on, music: !!s.music }; })()`);
  check(`${g.name}: unmuting starts it again`, un.on === true && un.music === true);
  check(`${g.name}: no page errors`, pageErrors === 0, `errors=${pageErrors}`);
  await p.close();
}

await b.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} FAILED` : "\nALL MUSIC CHECKS PASS");
process.exit(bad.length ? 1 : 0);
