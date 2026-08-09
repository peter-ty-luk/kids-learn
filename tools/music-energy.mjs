// Measure how energetic each music track actually is, instead of guessing from
// its title. Decodes every mp3 in the browser's audio engine and reports tempo,
// loudness and brightness, then writes an "energy" score back into tracks.json
// so the games can prefer the lively ones. Needs the server on :3077.
const fs = await import("fs");
const puppeteer = (await import("puppeteer-core")).default;

const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 200)));
await p.goto("http://localhost:3077/dodge.html", { waitUntil: "domcontentloaded" });

const tracks = JSON.parse(fs.readFileSync("assets/audio/music/tracks.json", "utf8"));

const out = [];
for (const t of tracks) {
  const r = await p.evaluate(async (file) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await fetch(`assets/audio/music/${file}`).then((x) => x.arrayBuffer());
    const audio = await ctx.decodeAudioData(buf);
    const sr = audio.sampleRate;
    const ch = audio.getChannelData(0);
    // amplitude envelope at ~100 frames a second
    const hop = Math.round(sr / 100);
    const frames = Math.floor(ch.length / hop);
    const env = new Float32Array(frames);
    let peak = 0, sumsq = 0;
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let j = 0; j < hop; j++) { const v = ch[i * hop + j]; s += v * v; }
      env[i] = Math.sqrt(s / hop);
      if (env[i] > peak) peak = env[i];
      sumsq += s;
    }
    const rms = Math.sqrt(sumsq / ch.length);
    // brightness: how much of the signal is fast wiggle (a crude high-pass)
    let hp = 0;
    for (let i = 1; i < ch.length; i += 7) { const d = ch[i] - ch[i - 1]; hp += d * d; }
    const bright = Math.sqrt(hp / (ch.length / 7)) / (rms || 1e-9);
    // onset strength: only rises count, that is where the beats are
    const flux = new Float32Array(frames);
    for (let i = 1; i < frames; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
    let fm = 0; for (let i = 0; i < frames; i++) fm += flux[i];
    fm /= frames || 1;
    for (let i = 0; i < frames; i++) flux[i] = Math.max(0, flux[i] - fm);
    // autocorrelate the onsets over 60..200 bpm to find the tempo
    let bestLag = 0, bestScore = -1;
    for (let lag = Math.round(100 * 60 / 200); lag <= Math.round(100 * 60 / 60); lag++) {
      let s = 0;
      for (let i = lag; i < frames; i++) s += flux[i] * flux[i - lag];
      s /= (frames - lag);
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    const bpm = bestLag ? 100 * 60 / bestLag : 0;
    // beat punch: how strongly the onsets stand out from the average level
    let fsum = 0, fmax = 0;
    for (let i = 0; i < frames; i++) { fsum += flux[i]; if (flux[i] > fmax) fmax = flux[i]; }
    const punch = fmax > 0 ? (fsum / frames) / fmax : 0;
    ctx.close();
    return { secs: +audio.duration.toFixed(1), rms: +rms.toFixed(4), peak: +peak.toFixed(3),
             bright: +bright.toFixed(4), bpm: Math.round(bpm), punch: +punch.toFixed(4) };
  }, t.file);
  out.push({ ...t, ...r });
  console.log(`${t.file.padEnd(38)} ${String(r.bpm).padStart(3)} bpm  rms ${r.rms.toFixed(3)}  bright ${r.bright.toFixed(3)}  ${r.secs}s`);
}
await b.close();

// Score: fast + loud + bright. Each part is scaled against the best track in
// the set, so the score says "how lively compared with the rest of this music",
// not an absolute measure of anything.
const max = (k) => Math.max(...out.map((o) => o[k])) || 1;
const mb = max("bpm"), mr = max("rms"), mbr = max("bright");
for (const o of out) o.energy = +(0.45 * (o.bpm / mb) + 0.35 * (o.rms / mr) + 0.20 * (o.bright / mbr)).toFixed(3);
out.sort((a, b2) => b2.energy - a.energy);

console.log("\nranked by energy (liveliest first):");
for (const o of out) console.log(`  ${o.energy.toFixed(3)}  ${String(o.bpm).padStart(3)}bpm  ${o.title}`);

// keep the mood tag the harvest gave it (arcade / action / battle / …)
const slim = out.map((o) => ({ file: o.file, title: o.title, ...(o.tag ? { tag: o.tag } : {}), bpm: o.bpm, energy: o.energy }));
fs.writeFileSync("assets/audio/music/tracks.json", JSON.stringify(slim, null, 2) + "\n");
console.log(`\ntracks.json rewritten with tempo + energy, ${slim.length} tracks (liveliest first)`);
