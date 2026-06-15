import fs from "fs";
import { execFileSync } from "child_process";

const man = JSON.parse(fs.readFileSync("/tmp/pix-manifest.json", "utf8"));
fs.mkdirSync("assets/audio/music", { recursive: true });
fs.mkdirSync("assets/audio/sfx", { recursive: true });

const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);

function dl(url, dest) {
  try {
    execFileSync("curl", ["-sS", "-m", "60", "-A", UA, "-o", dest, url], { stdio: "pipe" });
    const sz = fs.statSync(dest).size;
    const head = fs.readFileSync(dest).slice(0, 3).toString("hex");
    const ok = sz > 3000 && (head === "494433" /*ID3*/ || head.startsWith("fff") || head.startsWith("ff"));
    return ok ? sz : (fs.unlinkSync(dest), 0);
  } catch (e) { return 0; }
}

const musicManifest = [];
man.music.slice(0, 10).forEach((m, i) => {
  const name = `${String(i + 1).padStart(2, "0")}-${slug(m.title)}.mp3`;
  const sz = dl(m.url, `assets/audio/music/${name}`);
  console.log(`music ${name}: ${sz ? (sz / 1024).toFixed(0) + "KB ✓" : "FAILED"}`);
  if (sz) musicManifest.push({ file: name, title: m.title });
});

const sfxManifest = {};
man.sfx.forEach((s) => {
  const name = `${s.key}.mp3`;
  const sz = dl(s.url, `assets/audio/sfx/${name}`);
  console.log(`sfx  ${name}: ${sz ? (sz / 1024).toFixed(0) + "KB ✓" : "FAILED"}`);
  if (sz) sfxManifest[s.key] = { file: name, title: s.title };
});

fs.writeFileSync("assets/audio/music/tracks.json", JSON.stringify(musicManifest, null, 2));
fs.writeFileSync("assets/audio/sfx/sfx.json", JSON.stringify(sfxManifest, null, 2));
console.log(`\n✓ ${musicManifest.length} music + ${Object.keys(sfxManifest).length} sfx downloaded`);
