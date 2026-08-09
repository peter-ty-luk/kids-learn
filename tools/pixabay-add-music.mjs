// Add newly harvested tracks to the music library WITHOUT touching what is
// already there. (tools/pixabay-download.mjs is the original bootstrap script:
// it writes 01..10 and rewrites both manifests from scratch, so running it now
// would overwrite the existing tracks and wipe assets/audio/sfx/sfx.json.)
// Reads /tmp/pix-exciting.json, numbers new files after the highest existing
// one, and merges into tracks.json. Run tools/music-energy.mjs afterwards to
// measure and re-rank the whole library.
import fs from "fs";
import { execFileSync } from "child_process";

const DIR = "assets/audio/music";
const man = JSON.parse(fs.readFileSync("/tmp/pix-exciting.json", "utf8"));
const tracks = JSON.parse(fs.readFileSync(`${DIR}/tracks.json`, "utf8"));

const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);

function dl(url, dest) {
  try {
    execFileSync("curl", ["-sS", "-m", "90", "-A", UA, "-o", dest, url], { stdio: "pipe" });
    const sz = fs.statSync(dest).size;
    const head = fs.readFileSync(dest).slice(0, 3).toString("hex");
    const ok = sz > 3000 && (head === "494433" || head.startsWith("fff") || head.startsWith("ff"));
    return ok ? sz : (fs.unlinkSync(dest), 0);
  } catch { return 0; }
}

// carry on numbering from whatever is already in the folder
let next = 0;
for (const f of fs.readdirSync(DIR)) { const m = f.match(/^(\d+)-/); if (m) next = Math.max(next, +m[1]); }
const have = new Set(tracks.map((t) => t.title.toLowerCase()));

let added = 0;
for (const m of man.music) {
  if (have.has(m.title.toLowerCase())) { console.log(`skip (already have): ${m.title}`); continue; }
  const name = `${String(++next).padStart(2, "0")}-${slug(m.title)}.mp3`;
  const sz = dl(m.url, `${DIR}/${name}`);
  if (!sz) { next--; console.log(`FAILED  ${m.title}`); continue; }
  tracks.push({ file: name, title: m.title, tag: m.tag });
  have.add(m.title.toLowerCase());
  added++;
  console.log(`${name}  ${(sz / 1024).toFixed(0)}KB  [${m.tag}]  ${m.title}`);
}

fs.writeFileSync(`${DIR}/tracks.json`, JSON.stringify(tracks, null, 2) + "\n");
console.log(`\n+${added} tracks, library is now ${tracks.length}. Run tools/music-energy.mjs to re-rank.`);
