// ============================================================
// Match Dodge Ball — run around the court, pick up two things that GO
// TOGETHER (a word and its emoji, or a quiz pair from ../quiz via
// /quiz/pairs), and they fuse into a ball you can hurl at the other team.
// Official mode = classic dodgeball halves; free mode = run anywhere.
// Everything lives on window.DB so headless tests can drive it.
// ============================================================

const $ = (id) => document.getElementById(id);
const W = 960, H = 540, MID = W / 2;

// ---------- tiny synth sounds + a background music bed ----------
// The music is the same royalty-free racing set the kart game uses
// (assets/audio/music) — fast, driving tracks that suit a dodgeball rally.
const Sound = {
  ctx: null, on: true, music: null, tracks: [], _lastTrack: -1,
  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    try { this.on = localStorage.getItem('db-sound') !== '0'; } catch { /* */ }
    // The list arrives asynchronously, so startMusic() has to wait on it —
    // otherwise the first game starts before any track is known and stays silent.
    this._ready = this._ready || fetch('assets/audio/music/tracks.json')
      .then((r) => r.json()).then((l) => { this.tracks = l || []; })
      .catch(() => { this.tracks = []; /* no music files — synth SFX still work */ });
    this.updateBtn();
  },
  _playTrack() {
    if (!this.on || !this.tracks.length) return;
    this.stopMusic();
    // tracks.json is ordered liveliest first — tempo and loudness measured by
    // tools/music-energy.mjs, not guessed from the titles. A dodgeball rally
    // draws from the fast HALF of that list; the slower half is fine for the
    // quieter games but drags a match down.
    const pool = this.tracks.slice(0, Math.max(3, Math.ceil(this.tracks.length * 0.5)));
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === this._lastTrack) i = (i + 1) % pool.length;
    this._lastTrack = i;
    const a = new Audio(`assets/audio/music/${pool[i].file}`);
    a.loop = true; a.volume = 0.17;              // a bed, not a wall of sound
    a.play().catch(() => { /* browser wants a gesture first — the next start will do it */ });
    this.music = a;
  },
  startMusic() {
    if (!this.on) return;
    if (this.tracks.length) { this._playTrack(); return; }
    if (this._ready) this._ready.then(() => { if (this.on && DB.state && DB.state.status === 'playing') this._playTrack(); });
  },
  stopMusic() { if (this.music) { try { this.music.pause(); } catch { /* */ } this.music = null; } },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('db-sound', this.on ? '1' : '0'); } catch { /* */ }
    if (this.on) { if (DB.state && DB.state.status === 'playing') this.startMusic(); } else this.stopMusic();
    this.updateBtn();
  },
  updateBtn() { const b = $('sound-btn'); if (b) { b.textContent = this.on ? '🔊' : '🔈'; } },
  beep(f, d = 0.08, v = 0.14, t = 'square', w = 0) {
    if (!this.on || !this.ctx) return;
    const at = this.ctx.currentTime + w, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = t; o.frequency.value = f; g.gain.setValueAtTime(v, at); g.gain.exponentialRampToValueAtTime(0.001, at + d);
    o.connect(g); g.connect(this.ctx.destination); o.start(at); o.stop(at + d + 0.02);
  },
  pick() { this.beep(700, 0.05, 0.1, 'triangle'); },
  power() { [660, 880, 1180].forEach((f, i) => this.beep(f, 0.1, 0.13, 'square', i * 0.06)); },
  // A two-tone siren. `urgent` is the last few seconds before the walls move:
  // higher, louder and shorter, so the countdown audibly speeds up.
  alarm(urgent) {
    if (urgent) { [880, 660].forEach((f, i) => this.beep(f, 0.13, 0.2, 'sawtooth', i * 0.14)); return; }
    [520, 400].forEach((f, i) => this.beep(f, 0.22, 0.15, 'sawtooth', i * 0.24));
  },
  fuse() { this.beep(520, 0.07, 0.12, 'triangle'); this.beep(780, 0.09, 0.12, 'triangle', 0.07); this.beep(1040, 0.1, 0.1, 'triangle', 0.15); },
  fizzle() { this.beep(220, 0.14, 0.1, 'sawtooth'); },
  throwS() { this.beep(400, 0.05, 0.1); this.beep(600, 0.05, 0.08, 'square', 0.04); },
  ouch() { this.beep(160, 0.16, 0.14, 'sawtooth'); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.14, 0.13, 'triangle', i * 0.12)); },
  lose() { [400, 330, 262].forEach((f, i) => this.beep(f, 0.2, 0.12, 'sawtooth', i * 0.16)); },
};

// ---------- content: what "goes together" ----------
// Each set is a list of [left, right] pairs. `picture` sets put an emoji on the
// right, so that card is drawn as a picture and the fused ball takes the emoji.
// In the others both sides are words and the ball type is chosen by hash.
const PICTURE_PAIRS = [
  ['orange', '🍊'], ['apple', '🍎'], ['dog', '🐶'], ['cat', '🐱'], ['fish', '🐟'], ['star', '⭐'],
  ['car', '🚗'], ['ball', '⚽'], ['sun', '☀️'], ['moon', '🌙'], ['tree', '🌳'], ['cake', '🎂'],
  ['bee', '🐝'], ['frog', '🐸'], ['book', '📖'], ['milk', '🥛'], ['pizza', '🍕'], ['boat', '⛵'],
  ['banana', '🍌'], ['grapes', '🍇'], ['carrot', '🥕'], ['bread', '🍞'], ['cheese', '🧀'], ['egg', '🥚'],
  ['ice cream', '🍦'], ['cookie', '🍪'], ['candy', '🍬'], ['popcorn', '🍿'], ['burger', '🍔'], ['taco', '🌮'],
  ['lion', '🦁'], ['tiger', '🐯'], ['bear', '🐻'], ['panda', '🐼'], ['monkey', '🐵'], ['pig', '🐷'],
  ['cow', '🐮'], ['horse', '🐴'], ['sheep', '🐑'], ['rabbit', '🐰'], ['mouse', '🐭'], ['chicken', '🐔'],
  ['penguin', '🐧'], ['owl', '🦉'], ['snake', '🐍'], ['turtle', '🐢'], ['whale', '🐳'], ['octopus', '🐙'],
  ['train', '🚂'], ['bus', '🚌'], ['plane', '✈️'], ['rocket', '🚀'], ['bike', '🚲'], ['truck', '🚚'],
  ['rain', '🌧️'], ['snow', '❄️'], ['fire', '🔥'], ['rainbow', '🌈'], ['flower', '🌸'], ['leaf', '🍃'],
  ['house', '🏠'], ['school', '🏫'], ['clock', '🕐'], ['key', '🔑'], ['gift', '🎁'], ['balloon', '🎈'],
  ['guitar', '🎸'], ['drum', '🥁'], ['crown', '👑'], ['shoe', '👟'], ['hat', '🎩'], ['umbrella', '☂️'],
];
const OPPOSITE_PAIRS = [
  ['hot', 'cold'], ['big', 'small'], ['up', 'down'], ['day', 'night'], ['fast', 'slow'],
  ['happy', 'sad'], ['open', 'shut'], ['wet', 'dry'], ['old', 'new'], ['loud', 'quiet'],
  ['push', 'pull'], ['in', 'out'], ['left', 'right'], ['soft', 'hard'], ['light', 'dark'],
  ['high', 'low'], ['long', 'short'], ['full', 'empty'], ['near', 'far'], ['clean', 'dirty'],
  ['front', 'back'], ['first', 'last'], ['give', 'take'], ['above', 'below'], ['sweet', 'sour'],
  ['heavy', 'light'], ['awake', 'asleep'], ['begin', 'end'], ['young', 'old'], ['rich', 'poor'],
  ['true', 'false'], ['win', 'lose'],
];
const MATH_PAIRS = [
  ['2 + 3', '5'], ['4 + 4', '8'], ['6 + 5', '11'], ['7 + 3', '10'], ['9 + 4', '13'],
  ['8 + 8', '16'], ['5 + 7', '12'], ['6 + 9', '15'], ['10 - 4', '6'], ['12 - 5', '7'],
  ['15 - 6', '9'], ['20 - 8', '12'], ['11 - 3', '8'], ['18 - 9', '9'], ['14 - 7', '7'],
  ['2 × 3', '6'], ['4 × 5', '20'], ['6 × 6', '36'], ['3 × 7', '21'], ['8 × 4', '32'],
  ['9 × 3', '27'], ['5 × 5', '25'], ['7 × 7', '49'], ['12 ÷ 4', '3'], ['20 ÷ 5', '4'],
  ['18 ÷ 3', '6'], ['24 ÷ 6', '4'], ['30 ÷ 5', '6'], ['half of 10', '5'], ['double 7', '14'],
  ['half of 16', '8'], ['double 9', '18'],
];
const NATURE_PAIRS = [
  ['cow', 'moo'], ['dog', 'woof'], ['cat', 'meow'], ['duck', 'quack'], ['sheep', 'baa'],
  ['pig', 'oink'], ['lion', 'roar'], ['bee', 'buzz'], ['owl', 'hoot'], ['frog', 'ribbit'],
  ['bird', 'nest'], ['bee', 'hive'], ['fish', 'pond'], ['bear', 'cave'], ['rabbit', 'burrow'],
  ['spider', 'web'], ['horse', 'stable'], ['dog', 'kennel'], ['cat', 'kitten'], ['dog', 'puppy'],
  ['cow', 'calf'], ['sheep', 'lamb'], ['duck', 'duckling'], ['frog', 'tadpole'], ['horse', 'foal'],
  ['lion', 'cub'], ['hen', 'chick'], ['butterfly', 'caterpillar'], ['tree', 'seed'], ['cloud', 'rain'],
];
// The picker on the setup screen. `quiz` is filled from the sibling ../quiz
// project at runtime; `mixed` is everything local thrown together.
const CONTENT_SETS = {
  emoji:    { label: '😀 Picture words', pairs: PICTURE_PAIRS, picture: true },
  opposite: { label: '↔️ Opposites', pairs: OPPOSITE_PAIRS },
  math:     { label: '🔢 Number facts', pairs: MATH_PAIRS },
  nature:   { label: '🐾 Animals & nature', pairs: NATURE_PAIRS },
  mixed:    { label: '🎲 Mixed bag', mix: ['emoji', 'opposite', 'math', 'nature'] },
  quiz:     { label: '📚 Quiz pairs', quiz: true },
};
// Build this round's pair bank from whichever set was chosen.
function bankFor(content) {
  if (content === 'quiz') {
    if (QUIZ_BANK) return QUIZ_BANK.map((p, i) => ({ pairId: 'q' + i, left: p.left, right: p.right, emoji: null }));
    content = 'emoji';                                   // offline — fall back to pictures
  }
  const set = CONTENT_SETS[content] || CONTENT_SETS.emoji;
  const keys = set.mix || [content];
  const bank = [];
  for (const k of keys) {
    const s = CONTENT_SETS[k];
    if (!s || !s.pairs) continue;
    s.pairs.forEach((p, i) => bank.push({ pairId: k[0] + i, left: p[0], right: p[1], emoji: s.picture ? p[1] : null }));
  }
  return bank.length ? bank : PICTURE_PAIRS.map((p, i) => ({ pairId: 'e' + i, left: p[0], right: p[1], emoji: p[1] }));
}
let QUIZ_BANK = null; // [{left, right}] short text pairs from /quiz/pairs
async function loadQuizPairs() {
  try {
    const r = await fetch('/quiz/pairs'); const j = await r.json();
    const short = (v) => typeof v === 'string' ? v : (v && typeof v.text === 'string' && !v.math && !v.image ? v.text : null);
    const bank = [];
    for (const set of j.sets || []) for (const p of set.pairs || []) {
      const l = short(p.left), rt = short(p.right);
      if (l && rt && l.length <= 16 && rt.length <= 16) bank.push({ left: l, right: rt });
    }
    if (bank.length >= 6) QUIZ_BANK = bank;
  } catch { /* offline — emoji pairs still work */ }
}

const DB = { state: null, opts: { size: 2, court: 'official', content: 'emoji', ai: 'normal', theme: 'gym' }, ready: true };
window.DB = DB;

const AI_TUNE = {
  easy:   { speed: 118, matchAcc: 0.55, dodge: 0.35, aimSpread: 34, throwCd: 2.2 },
  normal: { speed: 138, matchAcc: 0.78, dodge: 0.65, aimSpread: 16, throwCd: 1.6 },
  tough:  { speed: 158, matchAcc: 0.94, dodge: 0.88, aimSpread: 6,  throwCd: 1.1 },
};
const FACES = [['🦊', '🐼', '🐸'], ['🐯', '🐵', '🐭']]; // team 0 (blue) / team 1 (red)

// ---------- special powers ----------
// Grabbed off the floor BEFORE you match a pair: whatever ball you fuse next
// carries the power, and it lasts three throws.
const POWERS = {
  bounce: { emoji: '🪀', name: 'Bouncy', blurb: 'the ball ricochets off the walls' },
  fire:   { emoji: '🔥', name: 'Fire Trail', blurb: 'it leaves a burning trail' },
  ghost:  { emoji: '👻', name: 'Ghost Ball', blurb: 'it flies straight through crates' },
  poison: { emoji: '☠️', name: 'Poison Cloud', blurb: 'hits a crate and gasses everyone near it' },
  triple: { emoji: '🎯', name: 'Triple Shot', blurb: 'three balls at once, fanned out' },
  turbo:  { emoji: '⚡', name: 'Turbo Ball', blurb: 'a super fast shot' },
  homing: { emoji: '🧲', name: 'Homing Ball', blurb: 'it chases whoever you aimed at' },
};
const POWER_KINDS = Object.keys(POWERS);
const POWER_THROWS = 3;         // charges a pickup is worth
const BOUNCE_LIMIT = 4;         // wall bounces before a bouncy ball gives up
// The lingering powers were over too quickly, so they all last a fifth longer.
const LINGER = 1.2;
const FIRE_TTL = 2.4 * LINGER;      // how long one burning patch keeps burning
const POISON_TTL = 3.6 * LINGER;    // how long a gas cloud hangs around
const BOUNCE_TTL = 4.5 * LINGER;    // how long a bouncy ball stays in play
const POISON_R = 104;               // twice the old 52 — a proper cloud to run from

// ---------- shrinking arena (survival mode) ----------
const SHRINK_EVERY = 60;        // seconds between shrinks
const SHRINK_FACTOR = 0.8;      // each shrink keeps 80% of the width and height
const SHRINK_WARN = 8;          // seconds of warning before it closes in

// ---------- visual themes ----------
// floor/second are the two plank tones, out is what shows beyond the sideline,
// line is the painted markings, sky is the wall behind the court.
const THEMES = {
  gym:    { label: '🏫 School Gym',  floor: [226, 188, 126], second: [214, 176, 116], out: [176, 140, 92],  line: '#ffffff', sky: [0.90, 0.86, 0.78], crate: [0.72, 0.51, 0.31] },
  beach:  { label: '🏖 Beach',       floor: [244, 222, 170], second: [236, 210, 152], out: [ 92, 172, 208], line: '#fff6d8', sky: [0.55, 0.80, 0.95], crate: [0.85, 0.70, 0.45] },
  jungle: { label: '🌴 Jungle',      floor: [126, 186, 104], second: [110, 170,  92], out: [ 52, 104,  56], line: '#f2ffe6', sky: [0.45, 0.72, 0.50], crate: [0.50, 0.36, 0.22] },
  space:  { label: '🚀 Space Deck',  floor: [ 58,  62, 104], second: [ 48,  52,  92], out: [ 14,  14,  32], line: '#8fe6ff', sky: [0.05, 0.05, 0.14], crate: [0.35, 0.38, 0.60], stars: true },
  ice:    { label: '❄️ Ice Rink',    floor: [206, 232, 248], second: [192, 222, 244], out: [122, 168, 198], line: '#4fa6d8', sky: [0.72, 0.86, 0.95], crate: [0.55, 0.72, 0.85] },
  lava:   { label: '🌋 Lava Pit',    floor: [ 76,  56,  62], second: [ 64,  46,  52], out: [188,  62,  30], line: '#ffb347', sky: [0.22, 0.10, 0.10], crate: [0.42, 0.28, 0.26] },
};

// ---------- state ----------
let nextPartId = 1;
function newState() {
  const o = DB.opts;
  const st = {
    mode: o.court, content: o.content, aiLevel: o.ai, size: o.size, status: 'playing',
    theme: THEMES[o.theme] ? o.theme : 'gym',
    timeLeft: 120, players: [], parts: [], balls: [], obstacles: [], floats: [], msg: '',
    bank: [], usedPairs: 0, winner: null,
    powers: [], hazards: [], nextPowerIn: 6,
    // The playable rectangle. Fixed in the normal modes; in survival it closes in.
    bounds: { x0: 0, y0: 0, x1: W, y1: H },
    elapsed: 0, shrinkIn: SHRINK_EVERY, shrinks: 0, shrinkWarned: false, shrinkBeep: 0,
  };
  // pair bank for this round
  st.bank = bankFor(o.content);
  // players: team 0 left (human is players[0]), team 1 right
  for (let team = 0; team <= 1; team++) {
    for (let k = 0; k < o.size; k++) {
      const x = team === 0 ? 160 + k * 40 : W - 160 - k * 40;
      const y = 140 + k * 120;
      st.players.push({
        i: st.players.length, team, emoji: FACES[team][k % 3], x, y, hp: 3, out: false,
        slots: [null, null], ball: null, power: null, stun: 0, invuln: 0, frozen: 0, throwCd: 0,
        isHuman: team === 0 && k === 0, aiTargetPart: null, dodgeUntil: 0, dodgeDir: null, px: x, py: y,
      });
    }
  }
  // obstacles: a couple of crates per half, mirrored
  const obs = [[300, 120], [260, 380], [430, 250]];
  for (const [x, y] of obs) { st.obstacles.push({ x: x - 26, y: y - 26, w: 52, h: 52 }); st.obstacles.push({ x: W - x - 26, y: y - 26, w: 52, h: 52 }); }
  return st;
}
const half = (x) => (x < MID ? 0 : 1);

// The court is the `bounds` rectangle; `m` is how much room to leave inside the
// sideline (a player's radius, or half a card).
function insideCourt(st, x, y, m) {
  const b = st.bounds;
  return x >= b.x0 + m && x <= b.x1 - m && y >= b.y0 + m && y <= b.y1 - m;
}

// ---------- parts ----------
function freeSpot(st, side) {
  const bd = st.bounds;
  for (let tries = 0; tries < 60; tries++) {
    // margins keep a whole card inside the sidelines now that cards are big
    let x = side === 0 ? 82 + Math.random() * (MID - 174) : MID + 92 + Math.random() * (MID - 174);
    let y = 78 + Math.random() * (H - 156);
    // in survival the arena closes in, so cards must land inside what's left
    if (st.mode === 'survival') {
      x = bd.x0 + 46 + Math.random() * Math.max(1, bd.x1 - bd.x0 - 92);
      y = bd.y0 + 40 + Math.random() * Math.max(1, bd.y1 - bd.y0 - 80);
    }
    if (x < bd.x0 + 40 || x > bd.x1 - 40 || y < bd.y0 + 34 || y > bd.y1 - 34) continue;
    if (st.obstacles.some((o) => x > o.x - 34 && x < o.x + o.w + 34 && y > o.y - 34 && y < o.y + o.h + 34)) continue;
    // 88 ≈ the diagonal of a word card (74 × 37), the distance below which two
    // cards can still visually overlap even though their centres are apart
    if (st.parts.some((p) => Math.hypot(p.x - x, p.y - y) < 88)) continue;
    if (st.players.some((p) => !p.out && Math.hypot(p.x - x, p.y - y) < 50)) continue;
    return { x, y };
  }
  return null;
}
// spawn a whole PAIR into one half so a match is always findable without crossing
function spawnPair(st, side) {
  const def = st.bank[Math.floor(Math.random() * st.bank.length)];
  // avoid flooding the floor with copies of the same pair on one side
  const already = st.parts.filter((p) => p.half === side && p.pairId === def.pairId).length;
  if (already >= 2) return false;
  // place the first card BEFORE looking for the second spot — picking both spots
  // up front let the two halves of a pair land on top of each other
  const a = freeSpot(st, side);
  if (!a) return false;
  st.parts.push({ id: nextPartId++, pairId: def.pairId, side: 'left', text: def.left, emoji: null, x: a.x, y: a.y, half: side });
  const b = freeSpot(st, side);
  if (!b) { st.parts.pop(); return false; }
  st.parts.push({ id: nextPartId++, pairId: def.pairId, side: 'right', text: def.right, emoji: def.emoji, x: b.x, y: b.y, half: side });
  return true;
}
function topUpParts(st) {
  // A quieter floor: one whole pair fewer per half than before. Cards only ever
  // spawn two at a time (a pair must always be findable without crossing), so a
  // pair is the smallest step there is — trimming any finer would round straight
  // back up and change nothing. Never below two pairs, or a half could hold a
  // single card with no partner to match it.
  const want = Math.max(4, st.size * 2);
  for (let side = 0; side <= 1; side++) {
    let guard = 0;
    while (st.parts.filter((p) => p.half === side).length < want && guard++ < 8) spawnPair(st, side);
  }
}

// ---------- special power blocks ----------
let nextPowerId = 1;
// Keep a power block or two on the floor. In official mode each half gets its
// own so neither team has to cross the line to reach one.
function topUpPowers(st, dt) {
  st.nextPowerIn -= dt;
  if (st.nextPowerIn > 0) return;
  const sides = st.mode === 'official' ? [0, 1] : [Math.round(Math.random())];
  for (const side of sides) {
    if (st.powers.filter((w) => w.half === side).length >= 1) continue;
    const s = freeSpot(st, side);
    if (!s) continue;
    // `half` has to come from where the block actually landed, not from the side
    // we asked for: in survival freeSpot ignores the side and picks anywhere in
    // the shrinking arena, which used to mislabel about half of them.
    st.powers.push({ id: nextPowerId++, kind: POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)], x: s.x, y: s.y, half: half(s.x) });
  }
  st.nextPowerIn = 9 + Math.random() * 6;
}
function grabPower(p, w, st) {
  st.powers = st.powers.filter((x) => x !== w);
  const had = p.power;                              // swapping out an unused power?
  p.power = { kind: w.kind, left: POWER_THROWS };
  const def = POWERS[w.kind];
  addFloat(st, p.x, p.y - 34, `${def.emoji} ${def.name}!`);
  if (p.isHuman) {
    Sound.power();
    const swap = had && had.kind !== w.kind ? `Swapped ${POWERS[had.kind].emoji} for ` : '';
    setMsg(`${swap}${def.emoji} ${def.name} — ${def.blurb}. Next ${POWER_THROWS} throws!`);
    refreshTray();
  }
}

// ---------- ball creation ----------
function ballFor(st, pairId) {
  const def = st.bank.find((b) => b.pairId === pairId);
  if (def && def.emoji) return { emoji: def.emoji, dmg: 1, kind: 'emoji' };
  // quiz pairs: hash decides a fun ball type
  let h = 0; for (const c of String(pairId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const r = h % 100;
  if (r < 22) return { emoji: '💥', dmg: 2, kind: 'power' };
  if (r < 38) return { emoji: '❄️', dmg: 1, kind: 'ice' };
  return { emoji: '🏀', dmg: 1, kind: 'normal' };
}
function tryCombine(p, st) {
  const [a, b] = p.slots;
  if (!a || !b) return;
  if (a.pairId === b.pairId && a.side !== b.side) {
    p.ball = ballFor(st, a.pairId);
    p.ball.label = `${a.text} + ${b.text}`;
    // A power only counts if it was already in hand when the pair fused — that's
    // what "grab it before the match" means.
    if (p.power && p.power.left > 0) p.ball.power = p.power.kind;
    p.slots = [null, null];
    if (p.isHuman) {
      Sound.fuse();
      const pw = p.ball.power ? ` ${POWERS[p.ball.power].emoji}${POWERS[p.ball.power].name}` : '';
      setMsg(`✨ ${p.ball.label} → ${p.ball.emoji}${pw} ball! Throw it!`);
    }
    addFloat(st, p.x, p.y - 30, `✨ ${p.ball.emoji}`);
  } else {
    // not a pair — both parts scatter back onto the floor and you're briefly dizzy
    for (const part of [a, b]) { const s = freeSpot(st, part.half); if (s) { part.x = s.x; part.y = s.y; st.parts.push(part); } }
    p.slots = [null, null];
    p.stun = 0.8;
    if (p.isHuman) { Sound.fizzle(); setMsg(`❌ "${a.text}" and "${b.text}" don't go together!`); }
    addFloat(st, p.x, p.y - 30, '❌');
  }
  if (p.isHuman) refreshTray();
}
function pickup(p, part, st) {
  st = st || DB.state;
  if (p.ball || p.out || p.stun > 0) return false;
  const slot = p.slots[0] ? (p.slots[1] ? -1 : 1) : 0;
  if (slot < 0) return false;
  st.parts = st.parts.filter((x) => x !== part);
  p.slots[slot] = part;
  if (p.isHuman) { Sound.pick(); refreshTray(); }
  tryCombine(p, st);
  return true;
}
function dropParts(p, st) {
  st = st || DB.state;
  for (const part of p.slots) { if (part) { const s = freeSpot(st, half(p.x)); if (s) { part.x = s.x; part.y = s.y; part.half = half(p.x); st.parts.push(part); } } }
  p.slots = [null, null];
  if (p.isHuman) refreshTray();
}

// ---------- throwing ----------
function throwBall(p, tx, ty, st) {
  st = st || DB.state;
  if (!p.ball || p.out || p.stun > 0 || p.frozen > 0) return false;
  const dx = tx - p.x, dy = ty - p.y, len = Math.hypot(dx, dy) || 1;
  let speed = p.ball.kind === 'power' ? 300 : 340;
  const power = p.ball.power || null;
  if (power === 'turbo') speed *= 2.1;
  const baseAng = Math.atan2(dy / len, dx / len);
  // Triple Shot fans three balls out; everything else is a single shot.
  const angles = power === 'triple' ? [-Math.PI / 6, 0, Math.PI / 6] : [0];
  const target = power === 'homing' ? nearestEnemy(p, st) : null;
  for (const a of angles) {
    st.balls.push({
      x: p.x, y: p.y - 6, dx: Math.cos(baseAng + a), dy: Math.sin(baseAng + a),
      speed, dmg: p.ball.dmg, kind: p.ball.kind, emoji: p.ball.emoji, team: p.team,
      ttl: power === 'bounce' ? BOUNCE_TTL : 2.6,
      power, bounces: 0, homeFor: power === 'homing' ? 1.4 : 0, target, fireAcc: 0, owner: p.i,
    });
  }
  p.ball = null; p.throwCd = 0.4;
  if (power && p.power) {
    p.power.left -= 1;
    if (p.power.left <= 0) { p.power = null; if (p.isHuman) setMsg('Your special power is used up — find another block!'); }
  }
  if (p.isHuman) { Sound.throwS(); refreshTray(); }
  return true;
}
function nearestEnemy(p, st) {
  let best = null, bd = 1e9;
  for (const e of st.players) { if (e.team === p.team || e.out) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
  return best;
}

// ---------- tick ----------
function tick(dt) {
  const st = DB.state; if (!st || st.status !== 'playing') return;
  st.timeLeft -= dt;
  st.elapsed += dt;
  updateShrink(st, dt);
  topUpParts(st);
  topUpPowers(st, dt);

  for (const p of st.players) {
    if (p.out) continue;
    if (p.stun > 0) p.stun -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.frozen > 0) { p.frozen -= dt; continue; }
    if (p.stun > 0) continue;
    if (p.throwCd > 0) p.throwCd -= dt;

    // velocity for aim-lead (AI uses it)
    p.vx = (p.x - p.px) / Math.max(dt, 0.001); p.vy = (p.y - p.py) / Math.max(dt, 0.001);
    p.px = p.x; p.py = p.y;

    if (p.isHuman) humanMove(p, dt, st); else aiMove(p, dt, st);

    // court bounds (the arena wall, which closes in during survival) plus the
    // official-mode half confinement
    const pr = 16;
    const cb = st.bounds;
    p.x = Math.max(cb.x0 + pr, Math.min(cb.x1 - pr, p.x));
    p.y = Math.max(cb.y0 + pr, Math.min(cb.y1 - pr, p.y));
    if (st.mode === 'official') {
      if (p.team === 0) p.x = Math.min(p.x, MID - pr - 2); else p.x = Math.max(p.x, MID + pr + 2);
    }
    // obstacles block walking
    for (const o of st.obstacles) {
      const nx = Math.max(o.x, Math.min(o.x + o.w, p.x)), ny = Math.max(o.y, Math.min(o.y + o.h, p.y));
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < pr) { const push = (pr - d) || pr; const ux = (p.x - nx) / (d || 1), uy = (p.y - ny) / (d || 1); p.x += ux * push; p.y += uy * push; }
    }
    // Walk over a special power block → carry its power. Anything you can reach
    // you can take: the old rule refused the grab while you still held an unused
    // power, which stranded you if no matching pair turned up, and it also went
    // by the block's recorded half rather than where it really was. Official
    // mode already pins you to your own side, so reach is the only test needed.
    for (const w of st.powers) {
      if (Math.hypot(w.x - p.x, w.y - p.y) < pr + 14) { grabPower(p, w, st); break; }
    }
    // walk over a part → pick it up
    if (!p.ball) {
      for (const part of st.parts) {
        if (st.mode === 'official' && part.half !== p.team) continue;
        if (Math.hypot(part.x - p.x, part.y - p.y) < pr + 12) { pickup(p, part, st); break; }
      }
    }
  }

  // balls fly
  const bd = st.bounds;
  for (const b of st.balls) {
    b.ttl -= dt; if (b.ttl <= 0) { b.dead = true; continue; }
    // Homing balls curve towards whoever they were aimed at.
    if (b.homeFor > 0 && b.target && !b.target.out) {
      b.homeFor -= dt;
      const hx = b.target.x - b.x, hy = b.target.y - b.y, hl = Math.hypot(hx, hy) || 1;
      const turn = Math.min(1, 3.4 * dt);
      b.dx += (hx / hl - b.dx) * turn; b.dy += (hy / hl - b.dy) * turn;
      const l = Math.hypot(b.dx, b.dy) || 1; b.dx /= l; b.dy /= l;
    }
    b.x += b.dx * b.speed * dt; b.y += b.dy * b.speed * dt;
    // Fire Trail drops burning patches along the flight path.
    if (b.power === 'fire') {
      b.fireAcc += dt;
      if (b.fireAcc >= 0.045) { b.fireAcc = 0; st.hazards.push({ type: 'fire', x: b.x, y: b.y, r: 15, ttl: FIRE_TTL, team: b.team }); }
    }
    if (b.power === 'bounce') {
      // ricochet off the arena walls a few times before giving up
      let hit = false;
      if (b.x < bd.x0 + 6) { b.x = bd.x0 + 6; b.dx = Math.abs(b.dx); hit = true; }
      if (b.x > bd.x1 - 6) { b.x = bd.x1 - 6; b.dx = -Math.abs(b.dx); hit = true; }
      if (b.y < bd.y0 + 6) { b.y = bd.y0 + 6; b.dy = Math.abs(b.dy); hit = true; }
      if (b.y > bd.y1 - 6) { b.y = bd.y1 - 6; b.dy = -Math.abs(b.dy); hit = true; }
      if (hit) { b.bounces++; addFloat(st, b.x, b.y, '🪀'); if (b.bounces > BOUNCE_LIMIT) { b.dead = true; continue; } }
    } else if (b.x < bd.x0 - 20 || b.x > bd.x1 + 20 || b.y < bd.y0 - 20 || b.y > bd.y1 + 20) { b.dead = true; continue; }
    // obstacles block balls — unless it's a Ghost Ball
    if (b.power !== 'ghost' && st.obstacles.some((o) => b.x > o.x - 4 && b.x < o.x + o.w + 4 && b.y > o.y - 4 && b.y < o.y + o.h + 4)) {
      b.dead = true;
      if (b.power === 'poison') { st.hazards.push({ type: 'poison', x: b.x, y: b.y, r: POISON_R, ttl: POISON_TTL, team: b.team }); addFloat(st, b.x, b.y, '☠️ gas!'); }
      else addFloat(st, b.x, b.y, '💨');
      continue;
    }
    // hit a player?
    for (const p of st.players) {
      if (p.team === b.team || p.out || p.invuln > 0) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < 17) {
        b.dead = true;
        if (b.kind === 'ice') p.frozen = 1.3;
        p.x += b.dx * 16; p.y += b.dy * 16;
        hurt(p, b.dmg, st, b.dmg > 1 ? '💥-2' : '-1 ❤️', 1.0);
        break;
      }
    }
  }
  st.balls = st.balls.filter((b) => !b.dead);

  // burning trails + poison clouds keep hurting whoever stands in them
  for (const hz of st.hazards) {
    hz.ttl -= dt;
    if (hz.ttl <= 0) { hz.dead = true; continue; }
    for (const p of st.players) {
      if (p.team === hz.team || p.out || p.invuln > 0) continue;
      if (Math.hypot(p.x - hz.x, p.y - hz.y) < hz.r) hurt(p, 1, st, hz.type === 'fire' ? '🔥-1' : '☠️-1', 1.4);
    }
  }
  st.hazards = st.hazards.filter((h) => !h.dead);

  for (const f of st.floats) f.t -= dt; st.floats = st.floats.filter((f) => f.t > 0);

  // win check
  const alive = (team) => st.players.filter((p) => p.team === team && !p.out).length;
  const hearts = (team) => st.players.filter((p) => p.team === team).reduce((s, p) => s + Math.max(0, p.hp), 0);
  if (alive(0) === 0 || alive(1) === 0) endGame(alive(0) === 0 ? 1 : 0, 'knockout');
  else if (st.mode !== 'survival' && st.timeLeft <= 0) {
    // Survival has no clock — it runs until one side is wiped out.
    const h0 = hearts(0), h1 = hearts(1);
    endGame(h0 === h1 ? -1 : (h0 > h1 ? 0 : 1), 'time');
  }
  updateHud();
}

// One place where a player loses hearts, so balls, fire, gas and the closing
// wall all knock somebody out the same way.
function hurt(p, dmg, st, floatTxt, invuln) {
  if (p.out) return;
  p.hp -= dmg;
  p.invuln = invuln == null ? 1.0 : invuln;
  if (floatTxt) addFloat(st, p.x, p.y - 26, floatTxt);
  if (p.isHuman || st.players.some((q) => q.isHuman && q.team !== p.team)) Sound.ouch();
  if (p.hp <= 0) {
    p.hp = 0;
    p.out = true; p.slots = [null, null]; p.ball = null; p.power = null;
    addFloat(st, p.x, p.y - 30, '🏳 out!');
    setMsg(p.isHuman ? '💫 You are out — cheer your team on!' : `${p.emoji} is out!`);
    if (p.isHuman) refreshTray();
  }
}

// ---------- survival mode: the arena closes in ----------
function updateShrink(st, dt) {
  if (st.mode !== 'survival') return;
  st.shrinkIn -= dt;
  // A single message eight seconds out was easy to miss. The alarm now runs for
  // the whole countdown: a banner across the court, a beep every second, and a
  // faster beep for the last three.
  if (st.shrinkIn <= SHRINK_WARN && st.shrinkIn > 0) {
    if (!st.shrinkWarned) { st.shrinkWarned = true; st.shrinkBeep = 0; setMsg('⚠️ THE WALLS ARE CLOSING IN — get away from the edge!'); }
    st.shrinkBeep -= dt;
    if (st.shrinkBeep <= 0) {
      const urgent = st.shrinkIn <= 3;
      Sound.alarm(urgent);
      st.shrinkBeep = urgent ? 0.34 : 0.8;
    }
    showAlarm(st, Math.ceil(st.shrinkIn));
  } else if (st.shrinkIn > SHRINK_WARN) {
    showAlarm(st, 0);
  }
  if (st.shrinkIn > 0) return;
  showAlarm(st, 0);

  const b = st.bounds;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const hw = ((b.x1 - b.x0) * SHRINK_FACTOR) / 2, hh = ((b.y1 - b.y0) * SHRINK_FACTOR) / 2;
  st.bounds = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  st.shrinks++;
  st.shrinkIn = SHRINK_EVERY;
  st.shrinkWarned = false;
  setMsg(`💥 The arena shrank! (${st.shrinks})`);
  Sound.alarm();

  // Shove everyone inside. Anyone with nowhere to go is crushed.
  for (const p of st.players) {
    if (p.out) continue;
    if (!pushInside(p, st)) hurt(p, 99, st, '🧱 crushed!', 0);
  }
  // cards and power blocks outside the new wall are gone
  st.parts = st.parts.filter((q) => inBounds(st, q.x, q.y, 24));
  st.powers = st.powers.filter((q) => inBounds(st, q.x, q.y, 24));
}
function inBounds(st, x, y, m) {
  const b = st.bounds;
  if (!(x >= b.x0 + m && x <= b.x1 - m && y >= b.y0 + m && y <= b.y1 - m)) return false;
  return insideCourt(st, x, y, m);
}
// The countdown banner over the court. n = seconds left, 0 hides it.
function showAlarm(st, n) {
  const el = $('shrink-alarm');
  if (!el) return;
  if (!n) { if (el.classList.contains('show')) el.classList.remove('show'); return; }
  el.classList.add('show');
  el.classList.toggle('urgent', n <= 3);
  el.textContent = `⚠️ WALLS CLOSING IN — ${n}`;
}
// Move a player back inside the wall, out of any crate it lands in. Returns
// false when there is genuinely nowhere left to stand.
function pushInside(p, st) {
  const b = st.bounds, pr = 16;
  if (b.x1 - b.x0 < pr * 2 || b.y1 - b.y0 < pr * 2) return false;
  let x = Math.max(b.x0 + pr, Math.min(b.x1 - pr, p.x));
  let y = Math.max(b.y0 + pr, Math.min(b.y1 - pr, p.y));
  const blocked = (px, py) => st.obstacles.some((o) => px > o.x - pr && px < o.x + o.w + pr && py > o.y - pr && py < o.y + o.h + pr);
  if (!blocked(x, y)) { p.x = x; p.y = y; return true; }
  // search outward for the nearest free spot still inside the wall
  for (let r = 8; r <= 160; r += 8) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r, ny = y + Math.sin(ang) * r;
      if (nx < b.x0 + pr || nx > b.x1 - pr || ny < b.y0 + pr || ny > b.y1 - pr) continue;
      if (!insideCourt(st, nx, ny, pr)) continue;
      if (!blocked(nx, ny)) { p.x = nx; p.y = ny; return true; }
    }
  }
  return false;
}

function endGame(winnerTeam, how) {
  const st = DB.state; if (st.status !== 'playing') return;
  st.status = 'over'; st.winner = winnerTeam;
  Sound.stopMusic();
  const youWon = winnerTeam === 0;
  if (winnerTeam === -1) { $('end-title').textContent = '🤝 A draw!'; }
  else { $('end-title').textContent = youWon ? '🏆 Blue team wins!' : '🔴 Red team wins!'; if (youWon) Sound.win(); else Sound.lose(); }
  $('end-sub').textContent = how === 'knockout' ? 'The whole other team is out!' : 'Time up — most hearts wins!';
  $('end-overlay').classList.add('show');
}

// ---------- human input ----------
const keys = new Set();
function humanMove(p, dt) {
  // Keys and the joystick say which way to go ON SCREEN; screenToGame turns
  // that into court directions using the camera's actual orientation, so the
  // controls stay correct even when the view turns a quarter turn in portrait.
  let right = 0, up = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) right -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) right += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) up += 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) up -= 1;
  if (joy.active) { right = joy.dx; up = joy.dy; }
  if (Math.hypot(right, up) < 0.01) return;
  const g = screenToGame(right, up);
  p.x += g.x * 165 * dt; p.y += g.y * 165 * dt;
}
function humanThrow() {
  const st = DB.state; if (!st) return;
  const p = st.players[0];
  const e = nearestEnemy(p, st);
  if (p.ball && e) {
    // small lead so running targets are still hittable
    const d = Math.hypot(e.x - p.x, e.y - p.y), t = d / 340;
    throwBall(p, e.x + (e.vx || 0) * t * 0.5, e.y + (e.vy || 0) * t * 0.5, st);
  }
}

// ---------- AI ----------
function aiMove(p, dt, st) {
  const tune = AI_TUNE[st.aiLevel];
  // dodge incoming balls
  const now = performance.now() / 1000;
  if (now > (p.dodgeUntil || 0)) {
    for (const b of st.balls) {
      if (b.team === p.team) continue;
      const toP = { x: p.x - b.x, y: p.y - b.y }, d = Math.hypot(toP.x, toP.y);
      if (d < 180 && (toP.x * b.dx + toP.y * b.dy) / (d || 1) > 0.86) {
        if (Math.random() < tune.dodge) { p.dodgeDir = { x: -b.dy, y: b.dx }; p.dodgeUntil = now + 0.35; }
        break;
      }
    }
  }
  if (now < (p.dodgeUntil || 0) && p.dodgeDir) { p.x += p.dodgeDir.x * tune.speed * 1.25 * dt; p.y += p.dodgeDir.y * tune.speed * 1.25 * dt; return; }

  if (p.ball) {
    // move toward a throwing spot, then throw at the nearest enemy
    const e = nearestEnemy(p, st);
    if (!e) return;
    const want = st.mode === 'official' ? { x: p.team === 0 ? MID - 60 : MID + 60, y: e.y } : { x: e.x, y: e.y };
    moveToward(p, want.x, want.y, tune.speed, dt);
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 330 && p.throwCd <= 0) {
      const t = d / 340, sp = tune.aimSpread;
      throwBall(p, e.x + (e.vx || 0) * t * 0.6 + (Math.random() * 2 - 1) * sp, e.y + (e.vy || 0) * t * 0.6 + (Math.random() * 2 - 1) * sp, st);
      p.throwCd = tune.throwCd;
    }
    return;
  }
  // grab a special power block if one is going spare and it's not a detour
  if (!p.power) {
    const reach = st.powers.filter((w) => (st.mode !== 'official' || w.half === p.team));
    let best = null, bdst = 260;
    for (const w of reach) { const d = Math.hypot(w.x - p.x, w.y - p.y); if (d < bdst) { bdst = d; best = w; } }
    if (best) { moveToward(p, best.x, best.y, tune.speed, dt); return; }
  }
  // choose a part to walk to
  const mine = (part) => st.mode !== 'official' || part.half === p.team;
  let target = p.aiTargetPart && st.parts.includes(p.aiTargetPart) && mine(p.aiTargetPart) ? p.aiTargetPart : null;
  if (!target) {
    if (p.slots[0]) {
      // find the true partner… or, if this AI is not so clever, any random part
      const held = p.slots[0];
      const partner = st.parts.filter((x) => mine(x) && x.pairId === held.pairId && x.side !== held.side);
      const pool = (Math.random() < tune.matchAcc && partner.length) ? partner : st.parts.filter(mine);
      target = pool[Math.floor(Math.random() * pool.length)] || null;
    } else {
      let bd = 1e9;
      for (const part of st.parts) { if (!mine(part)) continue; const d = Math.hypot(part.x - p.x, part.y - p.y); if (d < bd) { bd = d; target = part; } }
    }
    p.aiTargetPart = target;
  }
  if (target) moveToward(p, target.x, target.y, tune.speed, dt);
}
function moveToward(p, x, y, speed, dt) {
  const dx = x - p.x, dy = y - p.y, len = Math.hypot(dx, dy);
  if (len > 4) { p.x += (dx / len) * speed * dt; p.y += (dy / len) * speed * dt; }
}

// ---------- UI ----------
function setMsg(m) { const el = $('msg'); if (el) el.textContent = m; if (DB.state) DB.state.msg = m; }
function addFloat(st, x, y, txt) { st.floats.push({ x, y, txt, t: 1.1 }); }
function refreshTray() {
  const st = DB.state; if (!st) return;
  const p = st.players[0];
  for (let i = 0; i < 2; i++) {
    const el = $('slot-' + i); if (!el) continue;
    el.classList.remove('filled', 'ball');
    if (p.ball && i === 0) { el.textContent = `${p.ball.emoji} ready!`; el.classList.add('ball'); }
    else if (p.ball && i === 1) { el.textContent = '—'; }
    else if (p.slots[i]) { el.textContent = p.slots[i].text; el.classList.add('filled'); }
    else el.textContent = 'empty';
  }
  $('act-throw').disabled = !p.ball || p.out;
}
function updateHud() {
  const st = DB.state; if (!st) return;
  const hearts = (team) => st.players.filter((p) => p.team === team).reduce((s, p) => s + Math.max(0, p.hp), 0);
  $('hud-blue').textContent = hearts(0);
  $('hud-red').textContent = hearts(1);
  // Survival counts UP and shows when the wall next closes in; the other modes
  // count the clock down to the final whistle.
  if (st.mode === 'survival') {
    const s = Math.max(0, Math.ceil(st.shrinkIn));
    $('hud-time').textContent = `🧱 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  } else {
    const t = Math.max(0, Math.ceil(st.timeLeft));
    $('hud-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  const box = $('power-box');
  if (box) {
    const pw = st.players[0] && st.players[0].power;
    box.style.display = pw ? '' : 'none';
    if (pw) { $('power-name').textContent = `${POWERS[pw.kind].emoji} ${POWERS[pw.kind].name}`; $('power-left').textContent = pw.left; }
  }
}

// ---------- rendering: Babylon 3D (kart-game standard) ----------
// A real 3D gym: wooden court with painted lines, crates you can hide behind,
// chunky 3D players with emoji faces, billboard cards on the floor and flying
// emoji balls with shadows. Game logic is untouched — this mirrors DB.state.
const WU = 10;
const wx = (x) => x / WU, wz = (y) => y / WU;
let engine3d = null, scene = null, camera = null, shadowGen = null, canvas = null, floatLayer = null;
const meshOf = new Map();
const texCache = {}, matCache = {};

function mat3(name, r, g, b, opts = {}) {
  if (matCache[name]) return matCache[name];
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  m.specularColor = new BABYLON.Color3(0.06, 0.06, 0.06);
  if (opts.e) m.emissiveColor = new BABYLON.Color3(r * opts.e, g * opts.e, b * opts.e);
  if (opts.alpha != null) m.alpha = opts.alpha;
  matCache[name] = m; return m;
}
// a billboard plane showing crisp text/emoji (textures cached by key)
function spriteTex(key, draw, w = 128, h = 128) {
  if (texCache[key]) return texCache[key];
  const t = new BABYLON.DynamicTexture('t_' + key, { width: w, height: h }, scene, true);
  t.hasAlpha = true;
  const c = t.getContext(); c.clearRect(0, 0, w, h);
  draw(c, w, h); t.update();
  texCache[key] = t; return t;
}
function billboard(name, tex, w, h) {
  const pl = BABYLON.MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
  const m = new BABYLON.StandardMaterial(name + 'M', scene);
  m.diffuseTexture = tex; m.opacityTexture = tex; m.emissiveColor = BABYLON.Color3.White();
  m.disableLighting = true; m.backFaceCulling = false;
  pl.material = m; pl.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; pl.isPickable = false;
  return pl;
}
const emojiTex = (e) => spriteTex('em_' + e, (c, w, h) => { c.font = `${h * 0.78}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(e, w / 2, h / 2 + h * 0.047); }, 256, 256);
const heartsTex = (n) => spriteTex('hp' + n, (c, w, h) => { c.font = `${h * 0.53}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('❤️'.repeat(Math.max(0, n)) || '💔', w / 2, h / 2); }, 384, 128);
function cardTex(part) {
  const isE = part.emoji != null;
  const key = 'card_' + (isE ? part.emoji : part.text) + '_' + part.side;
  // An emoji card is SQUARE and a word card is 2:1 — the texture has to match the
  // plane it lands on, or the picture gets squeezed to a sliver.
  return spriteTex(key, (c, w, h) => {
    const pad = h * 0.047, bw = w - pad * 2, bh = h - pad * 2, r = h * 0.17;
    c.fillStyle = '#fffdf5';
    c.strokeStyle = part.side === 'left' ? '#ffab4a' : '#4ec97e'; c.lineWidth = h * 0.062;
    c.beginPath(); c.moveTo(pad + r, pad); c.arcTo(pad + bw, pad, pad + bw, pad + bh, r); c.arcTo(pad + bw, pad + bh, pad, pad + bh, r); c.arcTo(pad, pad + bh, pad, pad, r); c.arcTo(pad, pad, pad + bw, pad, r); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#2c3242'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (isE) { c.font = `${h * 0.66}px serif`; c.fillText(part.emoji, w / 2, h / 2 + h * 0.03); return; }
    // Long labels wrap onto extra lines rather than shrinking to nothing. Text with
    // spaces breaks between words; Chinese, which has none, breaks between characters.
    const spaced = /\s/.test(part.text);
    const chunks = spaced ? part.text.split(/\s+/) : [...part.text];
    const joiner = spaced ? ' ' : '';
    const maxW = bw - h * 0.16, maxH = bh - h * 0.12;
    const layout = (fs) => {
      c.font = `bold ${fs}px 'Segoe UI', sans-serif`;
      const lines = []; let cur = '';
      for (const piece of chunks) {
        const trial = cur ? cur + joiner + piece : piece;
        if (!cur || c.measureText(trial).width <= maxW) cur = trial;
        else { lines.push(cur); cur = piece; }
      }
      if (cur) lines.push(cur);
      const widest = Math.max(...lines.map((l) => c.measureText(l).width));
      return { lines, ok: widest <= maxW && lines.length * fs * 1.15 <= maxH };
    };
    let fs = h * 0.42, out = layout(fs);
    while (!out.ok && fs > h * 0.13) { fs -= h * 0.02; out = layout(fs); }
    const lh = fs * 1.15, y0 = h / 2 + h * 0.016 - ((out.lines.length - 1) * lh) / 2;
    out.lines.forEach((l, i) => c.fillText(l, w / 2, y0 + i * lh));
  }, isE ? 384 : 512, isE ? 384 : 256);
}

// The floor is one baked texture. It depends on the theme and the mode (only an
// official match paints halves), so it is rebuilt when either changes.
let courtGround = null, courtKey = '';
function buildCourt(st) {
  const theme = THEMES[(st && st.theme) || 'gym'] || THEMES.gym;
  const key = `${(st && st.theme) || 'gym'}|${st ? st.mode : 'official'}`;
  if (courtGround && courtKey === key) return;
  if (courtGround) { if (courtGround.material) { if (courtGround.material.diffuseTexture) courtGround.material.diffuseTexture.dispose(); courtGround.material.dispose(); } courtGround.dispose(); }
  courtKey = key;
  const ground = BABYLON.MeshBuilder.CreateGround('court', { width: 128, height: 76 }, scene);
  ground.position.set(wx(W / 2), 0, wz(H / 2));
  const t = new BABYLON.DynamicTexture('floor_' + key, { width: 1024, height: 608 }, scene, true);
  const c = t.getContext();
  const rgb = (a, m = 1) => `rgb(${(a[0] * m) | 0},${(a[1] * m) | 0},${(a[2] * m) | 0})`;
  // everything beyond the sideline
  c.fillStyle = rgb(theme.out); c.fillRect(0, 0, 1024, 608);
  if (theme.stars) {                                    // space deck gets a starfield outside
    c.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 260; i++) { const sxp = (i * 197) % 1024, syp = (i * 331) % 608; c.fillRect(sxp, syp, (i % 3) ? 1.6 : 2.6, (i % 3) ? 1.6 : 2.6); }
  }
  // the court area mapping: ground 128×76 world; court is 96×54 centered
  const sx = 1024 / 128, sy = 608 / 76;                 // texture px per world unit
  const cx0 = (128 - 96) / 2 * sx, cy0 = (76 - 54) / 2 * sy, cw = 96 * sx, ch = 54 * sy;
  // Clip to the sideline, then paint the playing surface inside it.
  c.save();
  c.beginPath(); c.rect(cx0, cy0, cw, ch); c.clip();
  // planks / tiles inside the court
  c.fillStyle = rgb(theme.floor); c.fillRect(0, 0, 1024, 608);
  for (let y = 0; y < 608; y += 38) {
    for (let x = 0; x < 1024; x += 128) {
      const shade = 0.94 + (((x / 128 + y / 38) * 7) % 5) * 0.022;
      c.fillStyle = (((x / 128 + y / 38) | 0) % 2) ? rgb(theme.second, shade) : rgb(theme.floor, shade);
      c.fillRect(x, y, 128, 38);
    }
  }
  c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 2;
  for (let y = 0; y <= 608; y += 38) { c.beginPath(); c.moveTo(0, y); c.lineTo(1024, y); c.stroke(); }
  for (let x = 0; x <= 1024; x += 128) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 608); c.stroke(); }
  // team tints + halfway line only make sense where the halves are real
  if (st && st.mode === 'official') {
    c.fillStyle = 'rgba(80,140,255,0.13)'; c.fillRect(cx0, cy0, cw / 2, ch);
    c.fillStyle = 'rgba(255,90,90,0.13)'; c.fillRect(cx0 + cw / 2, cy0, cw / 2, ch);
    c.strokeStyle = theme.line; c.lineWidth = 10;
    c.beginPath(); c.moveTo(cx0 + cw / 2, cy0); c.lineTo(cx0 + cw / 2, cy0 + ch); c.stroke();
  }
  c.strokeStyle = theme.line; c.lineWidth = 8;
  c.beginPath(); c.arc(cx0 + cw / 2, cy0 + ch / 2, 7 * sx, 0, 7); c.stroke();
  c.restore();
  // the sideline itself, painted on top so it reads as a hard edge
  c.strokeStyle = theme.line; c.lineWidth = 11;
  c.strokeRect(cx0, cy0, cw, ch);
  t.update();
  const gm = new BABYLON.StandardMaterial('courtM_' + key, scene);
  gm.diffuseTexture = t; gm.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
  ground.material = gm; ground.receiveShadows = true; ground.isPickable = false;
  courtGround = ground;
  if (scene) scene.clearColor = new BABYLON.Color4(theme.sky[0], theme.sky[1], theme.sky[2], 1);
}

function makeCrate(o) {
  const th = THEMES[(DB.state && DB.state.theme) || 'gym'] || THEMES.gym;
  const key = (DB.state && DB.state.theme) || 'gym';
  const hW = (o.w / 2) / WU, hD = (o.h / 2) / WU;
  const box = BABYLON.MeshBuilder.CreateBox('crate', { width: o.w / WU, height: 3.4, depth: o.h / WU }, scene);
  box.position.set(wx(o.x) + hW, 1.7, wz(o.y) + hD);
  box.material = mat3('crate_' + key, th.crate[0], th.crate[1], th.crate[2]);
  const lid = BABYLON.MeshBuilder.CreateBox('lid', { width: o.w / WU + 0.24, height: 0.5, depth: o.h / WU + 0.24 }, scene);
  lid.position.y = 1.85; lid.parent = box; lid.material = mat3('crateLid_' + key, th.crate[0] * 0.8, th.crate[1] * 0.8, th.crate[2] * 0.8);
  box.isPickable = lid.isPickable = false;
  shadowGen && shadowGen.addShadowCaster(box);
  return box;
}

function makePlayerMesh(p) {
  const root = new BABYLON.TransformNode('player', scene);
  const jersey = p.team === 0 ? mat3('jerseyB', 0.3, 0.5, 1) : mat3('jerseyR', 1, 0.36, 0.36);
  const body = BABYLON.MeshBuilder.CreateCapsule('pb', { radius: 1.45, height: 3.5 }, scene);
  body.position.y = 1.75; body.parent = root; body.material = jersey; body.isPickable = false;
  root._body = body;
  // Seen from overhead the jersey is hidden behind the face, so the team colour
  // lives in a ring on the floor instead.
  const ring = BABYLON.MeshBuilder.CreateDisc('ring', { radius: 2.5, tessellation: 28 }, scene);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; ring.parent = root; ring.isPickable = false;
  ring.material = p.team === 0 ? mat3('ringB', 0.25, 0.45, 1, { alpha: 0.5, e: 0.25 }) : mat3('ringR', 1, 0.3, 0.3, { alpha: 0.5, e: 0.25 });
  // feet
  for (const s of [-1, 1]) {
    const foot = BABYLON.MeshBuilder.CreateSphere('pf', { diameter: 0.78, segments: 6 }, scene);
    foot.position.set(s * 0.56, 0.38, 0.14); foot.parent = root; foot.material = mat3('shoe', 0.95, 0.95, 0.98); foot.isPickable = false;
    (root._feet = root._feet || []).push(foot);
  }
  // Overhead camera: height barely separates things on screen, so the face,
  // hearts and carried ball are spread out sideways (z = up/down the screen)
  // instead of being stacked on top of each other.
  const face = billboard('face', emojiTex(p.emoji), 3.3, 3.3);
  face.position.set(0, 3.9, 0); face.parent = root;
  const hp = billboard('hpP', heartsTex(p.hp), 4.2, 1.45);
  hp.position.set(0, 3.9, -3.2); hp.parent = root; root._hp = hp; root._hpN = p.hp;
  shadowGen && shadowGen.addShadowCaster(body);
  return root;
}

// Four slabs marking the live playing area. Only shown in survival, where the
// wall closes in every minute; they glow while the shrink warning is up.
let arenaWalls = null;
function syncArenaWalls(st) {
  const on = st.mode === 'survival';
  if (!arenaWalls) {
    if (!on) return;
    arenaWalls = [];
    for (let i = 0; i < 4; i++) {
      const w = BABYLON.MeshBuilder.CreateBox('wall' + i, { width: 1, height: 5, depth: 1 }, scene);
      w.isPickable = false;
      w.material = mat3('arenaWall', 0.95, 0.35, 0.45, { alpha: 0.62, e: 0.35 });
      arenaWalls.push(w);
    }
  }
  const b = st.bounds, TH = 1.4;
  const x0 = wx(b.x0), x1 = wx(b.x1), z0 = wz(b.y0), z1 = wz(b.y1);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sw = x1 - x0, sd = z1 - z0;
  const warn = st.shrinkWarned && st.shrinkIn > 0;
  const put = (m, x, z, w2, d2) => {
    m.setEnabled(on);
    m.position.set(x, 2.5, z);
    m.scaling.set(w2, 1, d2);
    m.visibility = warn ? 0.55 + Math.sin(performance.now() / 90) * 0.35 : 0.62;
  };
  put(arenaWalls[0], cx, z0 - TH / 2, sw + TH * 2, TH);
  put(arenaWalls[1], cx, z1 + TH / 2, sw + TH * 2, TH);
  put(arenaWalls[2], x0 - TH / 2, cz, TH, sd);
  put(arenaWalls[3], x1 + TH / 2, cz, TH, sd);
}

function createScene() {
  canvas = $('db-canvas');
  try { engine3d = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true); }
  catch { engine3d = null; return; }
  scene = new BABYLON.Scene(engine3d);
  scene.clearColor = new BABYLON.Color4(0.9, 0.86, 0.78, 1);          // warm gym wall
  // fixed cinematic angle — the canvas touch surface is the MOVE joystick, so
  // the camera must not grab pointer events
  // Overhead view. The court is exactly 16:9 like the canvas, so looking almost
  // straight down with a narrow lens fills nearly the whole screen; the small
  // tilt is what keeps the crates and players looking three-dimensional.
  camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, 0.12, 85, new BABYLON.Vector3(wx(W / 2), 0, wz(H / 2)), scene);
  frameCourt();
  const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9; hemi.groundColor = new BABYLON.Color3(0.45, 0.4, 0.32);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.35, -1, -0.3), scene);
  sun.intensity = 0.8; sun.position = new BABYLON.Vector3(60, 55, 40);
  shadowGen = new BABYLON.ShadowGenerator(1024, sun);
  shadowGen.useBlurExponentialShadowMap = true; shadowGen.blurKernel = 16;
  window.addEventListener('resize', () => { if (engine3d) { engine3d.resize(); frameCourt(); } });
}

// Fit the whole court to whatever shape the window happens to be. Babylon's fov
// is the VERTICAL angle, so the horizontal reach is fov widened by the canvas
// aspect — a tall window therefore needs a wider lens to keep the sidelines on
// screen. Solving both directions at once and taking the larger requirement is
// what stops the court being cropped on one axis or floating in dead space.
function frameCourt() {
  if (!camera || !engine3d) return;
  const wpx = engine3d.getRenderWidth(), hpx = engine3d.getRenderHeight();
  if (!wpx || !hpx || !scene) return;
  // A 16:9 court in a portrait window leaves most of the screen empty, so the
  // whole view takes a quarter turn and the long side of the court runs down
  // the screen instead. The controls follow the camera automatically.
  const turned = wpx / hpx < 0.95;
  camera.alpha = turned ? 0 : -Math.PI / 2;
  // Then fit by measuring: project the four corners and widen or narrow the
  // lens until the worst one sits just inside the edge. The tilt means there is
  // no exact formula, and a guessed margin was letting a corner slip off.
  const c = [[0, 0], [W, 0], [0, H], [W, H]].map((q) => new BABYLON.Vector3(wx(q[0]), 0, wz(q[1])));
  const fill = 0.96;
  for (let pass = 0; pass < 6; pass++) {
    scene.updateTransformMatrix();
    const vp = camera.viewport.toGlobal(wpx, hpx);
    const m = scene.getTransformMatrix();
    let worst = 0;
    for (const v3 of c) {
      const v = BABYLON.Vector3.Project(v3, BABYLON.Matrix.Identity(), m, vp);
      if (!isFinite(v.x) || !isFinite(v.y)) return;
      worst = Math.max(worst, Math.abs((v.x / wpx) * 2 - 1), Math.abs((v.y / hpx) * 2 - 1));
    }
    if (worst <= 0) return;
    if (Math.abs(worst - fill) < 0.008) break;
    camera.fov = Math.max(0.25, Math.min(1.45, camera.fov * (worst / fill)));
  }
  updateAxisMap();
}

// Which way is "screen right" and "screen up" in court coordinates. Measured
// from the camera by projecting two short steps rather than assumed, so it
// stays right whatever angle the view ends up at.
let axisMap = { a: 1, b: 0, c: 0, d: 1 };
function updateAxisMap() {
  if (!scene || !camera || !engine3d) return;
  const wpx = engine3d.getRenderWidth(), hpx = engine3d.getRenderHeight();
  if (!wpx || !hpx) return;
  scene.updateTransformMatrix();
  const vp = camera.viewport.toGlobal(wpx, hpx);
  const m = scene.getTransformMatrix();
  const P = (gx, gy) => BABYLON.Vector3.Project(new BABYLON.Vector3(wx(gx), 0, wz(gy)), BABYLON.Matrix.Identity(), m, vp);
  const o = P(W / 2, H / 2), sx = P(W / 2 + 10, H / 2), sy = P(W / 2, H / 2 + 10);
  const ax = sx.x - o.x, ay = sx.y - o.y;               // screen move per step of court x
  const bx = sy.x - o.x, by = sy.y - o.y;               // ... and of court y
  const det = ax * by - bx * ay;
  if (!isFinite(det) || Math.abs(det) < 1e-9) return;
  axisMap = { a: by / det, b: -bx / det, c: -ay / det, d: ax / det };   // inverted
}
// screen intent (right, up) → a unit direction on the court
function screenToGame(right, up) {
  const sx = right, sy = -up;                           // canvas y grows downward
  const gx = axisMap.a * sx + axisMap.b * sy;
  const gy = axisMap.c * sx + axisMap.d * sy;
  const l = Math.hypot(gx, gy) || 1;
  return { x: gx / l, y: gy / l };
}

function setupCanvas() {
  if (!scene) createScene();
  if (engine3d) { engine3d.resize(); frameCourt(); requestAnimationFrame(() => { engine3d.resize(); frameCourt(); }); }
  floatLayer = $('float-layer');
  for (const [, m] of meshOf) m.dispose();
  meshOf.clear();
  // the floor depends on this round's theme and mode
  if (scene) buildCourt(DB.state);
  // static crates for THIS round
  if (scene && DB.state) for (const o of DB.state.obstacles) { const m = makeCrate(o); meshOf.set(o, m); }
}

function syncScene() {
  const st = DB.state; if (!scene || !st) return;
  const t = performance.now() / 1000;
  const seen = new Set(st.obstacles);

  for (const p of st.players) {
    let m = meshOf.get(p);
    if (!m) { m = makePlayerMesh(p); meshOf.set(p, m); }
    seen.add(p);
    m.position.set(wx(p.x), 0, wz(p.y));
    // running bounce (from real velocity), face the move direction subtly
    const moving = Math.hypot(p.vx || 0, p.vy || 0) > 8;
    m._body.position.y = 1.75 + (moving ? Math.abs(Math.sin(t * 9 + p.i)) * 0.3 : 0);
    if (m._feet) m._feet.forEach((f, k) => { f.position.y = 0.38 + (moving ? Math.abs(Math.sin(t * 9 + p.i + k * Math.PI)) * 0.42 : 0); });
    // hearts refresh only when they change
    if (m._hpN !== p.hp) { m._hp.material.diffuseTexture = m._hp.material.opacityTexture = heartsTex(p.hp); m._hpN = p.hp; }
    // held ball hovers over the head
    if (p.ball && !m._held) { m._held = billboard('held', emojiTex(p.ball.emoji), 2.8, 2.8); m._held.parent = m; }
    if (m._held) { if (!p.ball) { m._held.dispose(); m._held = null; } else { m._held.position.set(0, 4.1, 3.3 + Math.sin(t * 4) * 0.18); } }
    // status FX
    const grey = p.out;
    m._body.material = grey ? mat3('outGrey', 0.55, 0.55, 0.58) : (p.team === 0 ? matCache.jerseyB : matCache.jerseyR);
    if (p.out && !m._flag) { m._flag = billboard('flag', emojiTex('🏳'), 2.4, 2.4); m._flag.position.set(0, 4.2, 3.3); m._flag.parent = m; }
    if (!p.out && m._flag) { m._flag.dispose(); m._flag = null; }
    if (p.frozen > 0 && !m._ice) {
      m._ice = BABYLON.MeshBuilder.CreateBox('ice', { width: 3.3, height: 5.0, depth: 3.3 }, scene);
      m._ice.position.y = 2.5; m._ice.parent = m; m._ice.isPickable = false;
      m._ice.material = mat3('iceCube', 0.6, 0.85, 1, { alpha: 0.4, e: 0.35 });
    }
    if (p.frozen <= 0 && m._ice) { m._ice.dispose(); m._ice = null; }
    if (p.stun > 0 && !m._dizz) { m._dizz = billboard('dz', emojiTex('💫'), 2.1, 2.1); m._dizz.position.set(3.2, 4.2, 0); m._dizz.parent = m; }
    if (p.stun <= 0 && m._dizz) { m._dizz.dispose(); m._dizz = null; }
    if (p.invuln > 0 && !p.out) m._body.visibility = 0.55 + Math.sin(t * 20) * 0.2; else m._body.visibility = 1;
  }

  // floor cards
  for (const part of st.parts) {
    let m = meshOf.get(part);
    if (!m) {
      m = new BABYLON.TransformNode('part', scene);
      const isE = part.emoji != null;
      // Every word card is the SAME size and the text shrinks to fit it. Sizing the
      // card by text length instead made one-character words (木, 把) render too
      // small to read, and let long ones overhang the sideline.
      const card = billboard('c', cardTex(part), isE ? 4.6 : 7.4, isE ? 4.6 : 3.7);
      card.position.y = isE ? 1.25 : 1.0; card.parent = m;
      const sh = BABYLON.MeshBuilder.CreateDisc('sh', { radius: 0.8, tessellation: 14 }, scene);
      sh.rotation.x = Math.PI / 2; sh.position.y = 0.03; sh.parent = m;
      sh.material = mat3('shadow', 0, 0, 0, { alpha: 0.16 }); sh.isPickable = false;
      m._card = card;
      meshOf.set(part, m);
    }
    seen.add(part);
    m.position.set(wx(part.x), 0, wz(part.y));
    m._card.position.y = (part.emoji ? 1.25 : 1.0) + Math.sin(t * 2.2 + part.id) * 0.12;   // gentle bob
  }

  // the arena wall (survival mode) — four slabs that march inwards
  syncArenaWalls(st);

  // special power blocks — a glowing crystal you run over
  for (const w of st.powers) {
    let m = meshOf.get(w);
    if (!m) {
      m = new BABYLON.TransformNode('power', scene);
      const gem = BABYLON.MeshBuilder.CreatePolyhedron('pw', { type: 1, size: 1.5 }, scene);
      gem.position.y = 2.2; gem.parent = m; gem.isPickable = false;
      gem.material = mat3('powerGem', 1, 0.86, 0.25, { alpha: 0.85, e: 0.5 });
      const ring = BABYLON.MeshBuilder.CreateDisc('pwr', { radius: 3.0, tessellation: 26 }, scene);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.07; ring.parent = m; ring.isPickable = false;
      ring.material = mat3('powerRing', 1, 0.9, 0.3, { alpha: 0.4, e: 0.4 });
      const icon = billboard('pwi', emojiTex(POWERS[w.kind].emoji), 3.0, 3.0);
      icon.position.y = 2.2; icon.parent = m;
      m._gem = gem;
      meshOf.set(w, m);
    }
    seen.add(w);
    m.position.set(wx(w.x), 0, wz(w.y));
    m._gem.rotation.y += 0.03;
    m._gem.position.y = 2.2 + Math.sin(t * 2.6 + w.id) * 0.25;
  }

  // fire trails + poison clouds
  for (const hz of st.hazards) {
    let m = meshOf.get(hz);
    if (!m) {
      const fire = hz.type === 'fire';
      m = BABYLON.MeshBuilder.CreateDisc('hz', { radius: hz.r / 10, tessellation: 20 }, scene);
      m.rotation.x = Math.PI / 2; m.position.y = 0.09; m.isPickable = false;
      m.material = fire ? mat3('fireHz', 1, 0.45, 0.1, { alpha: 0.6, e: 0.65 })
                        : mat3('poisonHz', 0.45, 0.95, 0.3, { alpha: 0.45, e: 0.45 });
      m._icon = billboard('hzi', emojiTex(fire ? '🔥' : '☠️'), fire ? 2.2 : 3.4, fire ? 2.2 : 3.4);
      m._icon.position.set(0, fire ? 1.4 : 2.4, 0); m._icon.parent = m;
      m._max = hz.ttl;
      meshOf.set(hz, m);
    }
    seen.add(hz);
    m.position.x = wx(hz.x); m.position.z = wz(hz.y);
    m.visibility = Math.max(0.15, hz.ttl / m._max);           // fades as it burns out
  }

  // balls in flight
  for (const bl of st.balls) {
    let m = meshOf.get(bl);
    if (!m) {
      m = new BABYLON.TransformNode('ball', scene);
      const em = billboard('be', emojiTex(bl.emoji), 3.0, 3.0); em.parent = m; em.position.y = 1.5; m._em = em;
      if (bl.power) { const tag = billboard('bp', emojiTex(POWERS[bl.power].emoji), 2.0, 2.0); tag.parent = m; tag.position.set(0, 1.6, 2.0); }
      const sh = BABYLON.MeshBuilder.CreateDisc('bs', { radius: 0.5, tessellation: 12 }, scene);
      sh.rotation.x = Math.PI / 2; sh.position.y = 0.04; sh.parent = m;
      sh.material = mat3('shadow', 0, 0, 0, { alpha: 0.16 });
      meshOf.set(bl, m);
    }
    seen.add(bl);
    m.position.set(wx(bl.x), 0, wz(bl.y));
    m._em.rotation.z = t * 9;                                     // spin!
  }

  for (const [k, m] of meshOf) if (!seen.has(k)) { m.dispose(); meshOf.delete(k); }
}

function renderFloats() {
  const st = DB.state; if (!floatLayer || !scene || !st) return;
  let html = '';
  for (const f of st.floats) {
    const v = BABYLON.Vector3.Project(
      new BABYLON.Vector3(wx(f.x), 2.6, wz(f.y)),
      BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine3d.getRenderWidth(), engine3d.getRenderHeight()));
    html += `<span style="left:${(v.x / engine3d.getRenderWidth() * 100).toFixed(1)}%;top:${(v.y / engine3d.getRenderHeight() * 100).toFixed(1)}%;opacity:${Math.max(0, f.t).toFixed(2)};transform:translate(-50%,-${(70 + (1.1 - f.t) * 40) | 0}%)">${f.txt}</span>`;
  }
  floatLayer.innerHTML = html;
}

function render() {
  if (!scene) return;
  syncScene();
  renderFloats();
  scene.render();
}

// ---------- loop ----------
let _last = 0, _raf = null;
function loop(t) {
  const dt = Math.min(0.05, (t - _last) / 1000 || 0.016);
  _last = t;
  if (DB.state && DB.state.status === 'playing') { tick(dt); render(); }
  _raf = requestAnimationFrame(loop);
}
function turbo(seconds, dt = 0.05) { const st = DB.state; let t = 0; while (st.status === 'playing' && t < seconds) { tick(dt); t += dt; } }

// ---------- input wiring ----------
window.addEventListener('keydown', (e) => {
  const st = DB.state; if (!st || st.status !== 'playing' || $('game').style.display === 'none') return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Space') humanThrow();
  if (e.code === 'KeyQ') dropParts(DB.state.players[0]);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// touch joystick on the canvas
const joy = { active: false, ox: 0, oy: 0, dx: 0, dy: 0 };
function bindTouch() {
  const cv = $('db-canvas');
  const pt = (e) => { const r = cv.getBoundingClientRect(); const t = e.touches[0]; return { x: (t.clientX - r.left) * (W / r.width), y: (t.clientY - r.top) * (H / r.height) }; };
  cv.addEventListener('touchstart', (e) => { e.preventDefault(); const p = pt(e); joy.active = true; joy.ox = p.x; joy.oy = p.y; joy.dx = 0; joy.dy = 0; }, { passive: false });
  cv.addEventListener('touchmove', (e) => { e.preventDefault(); if (!joy.active) return; const p = pt(e); const dx = p.x - joy.ox, dy = p.y - joy.oy, len = Math.hypot(dx, dy); if (len > 6) { joy.dx = dx / Math.max(len, 34); joy.dy = -dy / Math.max(len, 34); } }, { passive: false });
  const end = (e) => { e.preventDefault(); joy.active = false; joy.dx = joy.dy = 0; };
  cv.addEventListener('touchend', end, { passive: false });
  cv.addEventListener('touchcancel', end, { passive: false });
}

// ---------- screens ----------
function startGame() {
  DB.state = newState();
  topUpParts(DB.state);
  $('setup').style.display = 'none'; $('game').style.display = 'block';
  document.body.classList.add('playing');          // court takes over the window
  showAlarm(null, 0);                              // clear any alarm left over from a survival round
  $('end-overlay').classList.remove('show');
  setupCanvas(); refreshTray(); updateHud();
  setMsg(DB.opts.content === 'quiz' && !QUIZ_BANK ? 'Quiz pairs not available — playing with emoji words!' : 'Match two cards that go together to make a ball!');
  if (_raf == null) _raf = requestAnimationFrame(loop);
}
function toMenu() { DB.state = null; Sound.stopMusic(); showAlarm(null, 0); document.body.classList.remove('playing'); $('game').style.display = 'none'; $('setup').style.display = 'block'; }

function setOpt(group, attr, val) { document.querySelectorAll(`#${group} .opt`).forEach((o) => o.classList.toggle('on', o.dataset[attr] === String(val))); }
// The theme and content pickers are built from the tables above so a new entry
// shows up on the setup screen without touching the HTML.
function buildOpts(group, attr, table, chosen) {
  const el = $(group); if (!el) return;
  el.innerHTML = '';
  for (const [key, def] of Object.entries(table)) {
    const d = document.createElement('div');
    d.className = 'opt' + (key === chosen ? ' on' : '');
    d.dataset[attr] = key;
    d.textContent = def.label;
    el.appendChild(d);
  }
}
buildOpts('opt-theme', 'theme', THEMES, DB.opts.theme);
buildOpts('opt-content', 'content', CONTENT_SETS, DB.opts.content);
$('opt-size').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; DB.opts.size = +o.dataset.size; setOpt('opt-size', 'size', o.dataset.size); });
$('opt-court').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; DB.opts.court = o.dataset.court; setOpt('opt-court', 'court', o.dataset.court); });
$('opt-theme').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; DB.opts.theme = o.dataset.theme; setOpt('opt-theme', 'theme', o.dataset.theme); });
$('opt-content').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; DB.opts.content = o.dataset.content; setOpt('opt-content', 'content', o.dataset.content); });
$('opt-ai').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; DB.opts.ai = o.dataset.ai; setOpt('opt-ai', 'ai', o.dataset.ai); });
$('start-btn').addEventListener('click', () => { Sound.init(); startGame(); Sound.startMusic(); });
if ($('sound-btn')) $('sound-btn').addEventListener('click', () => Sound.toggle());
$('quit-btn').addEventListener('click', toMenu);
$('end-again').addEventListener('click', startGame);
$('end-menu').addEventListener('click', toMenu);
$('act-throw').addEventListener('click', humanThrow);
$('act-drop').addEventListener('click', () => DB.state && dropParts(DB.state.players[0]));
document.addEventListener('DOMContentLoaded', bindTouch);

// expose for tests
DB.tick = tick; DB.turbo = turbo; DB.pickup = pickup; DB.throwBall = throwBall; DB.dropParts = dropParts;
DB.nearestEnemy = nearestEnemy; DB.spawnPair = spawnPair; DB.ballFor = ballFor; DB.start = startGame; DB.W = W; DB.H = H; DB.MID = MID;
DB.POWERS = POWERS; DB.grabPower = grabPower; DB.topUpPowers = topUpPowers; DB.updateShrink = updateShrink; DB.SHRINK = { every: SHRINK_EVERY, factor: SHRINK_FACTOR, warn: SHRINK_WARN, throws: POWER_THROWS };
DB.THEMES = THEMES; DB.CONTENT_SETS = CONTENT_SETS; DB.bankFor = bankFor;
DB.insideCourt = insideCourt; DB.topUpParts = topUpParts;
DB.screenToGame = screenToGame; DB.frameCourt = frameCourt;

loadQuizPairs();
window._soundForTest = Sound;   // headless checks inspect the music bed
