// ============================================================
// Tower Quiz Defense — attacker vs defender, powered by questions.
// Answer questions (from the sibling ../quiz project via /quiz/mcq) to earn
// coins; spend coins on troops (attacker) or towers (defender). One side is
// you, the other is an AI whose income is tuned to feel like a rival kid.
// All state lives on window.TD so headless tests can drive it.
// ============================================================

const $ = (id) => document.getElementById(id);

// ---------- tiny synth sounds (self-contained, no assets) ----------
const Sound = {
  ctx: null, on: true,
  music: null, tracks: [], _lastTrack: -1,
  init() {
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    try { this.on = localStorage.getItem('td-sound') !== '0'; } catch { /* */ }
    // Same royalty-free driving tracks the kart game uses (assets/audio/music).
    // The list arrives asynchronously, so startMusic() has to wait on it — otherwise
    // the first battle starts before any track is known and stays silent.
    this._ready = this._ready || fetch('assets/audio/music/tracks.json')
      .then((r) => r.json()).then((l) => { this.tracks = l || []; })
      .catch(() => { this.tracks = []; /* no files — synth SFX still work */ });
    this.updateBtn();
  },
  _playTrack() {
    if (!this.on || !this.tracks.length) return;
    this.stopMusic();
    // tracks.json is ordered liveliest first — tempo and loudness measured by
    // tools/music-energy.mjs, not guessed from the titles. Battles take the
    // fast half of the library.
    const pool = this.tracks.slice(0, Math.max(3, Math.ceil(this.tracks.length * 0.5)));
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === this._lastTrack) i = (i + 1) % pool.length;
    this._lastTrack = i;
    const a = new Audio(`assets/audio/music/${pool[i].file}`);
    a.loop = true; a.volume = 0.15;              // quiet enough to read questions over
    a.play().catch(() => { /* needs a gesture first */ });
    this.music = a;
  },
  startMusic() {
    if (!this.on) return;
    if (this.tracks.length) { this._playTrack(); return; }
    if (this._ready) this._ready.then(() => { if (this.on && TD.state && TD.state.status === 'playing') this._playTrack(); });
  },
  stopMusic() { if (this.music) { try { this.music.pause(); } catch { /* */ } this.music = null; } },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('td-sound', this.on ? '1' : '0'); } catch { /* */ }
    if (this.on) { if (TD.state && TD.state.status === 'playing') this.startMusic(); } else this.stopMusic();
    this.updateBtn();
  },
  updateBtn() { const b = $('sound-btn'); if (b) b.textContent = this.on ? '🔊' : '🔈'; },
  beep(freq, dur = 0.08, vol = 0.15, type = 'square', when = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  coin() { this.beep(880, 0.06, 0.12, 'triangle'); this.beep(1320, 0.09, 0.12, 'triangle', 0.06); },
  good() { this.beep(660, 0.08, 0.12, 'triangle'); this.beep(880, 0.1, 0.12, 'triangle', 0.08); },
  bad() { this.beep(180, 0.16, 0.12, 'sawtooth'); },
  build() { this.beep(300, 0.05, 0.14, 'square'); this.beep(220, 0.07, 0.12, 'square', 0.05); },
  boom() { this.beep(120, 0.2, 0.16, 'sawtooth'); },
  hit() { this.beep(240, 0.05, 0.1, 'square'); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.14, 0.14, 'triangle', i * 0.12)); },
  lose() { [400, 330, 262].forEach((f, i) => this.beep(f, 0.2, 0.13, 'sawtooth', i * 0.16)); },
};

// ---------- config (all balance knobs in one place) ----------
const CONFIG = {
  BASE_HP: 260,
  DRIP: { amount: 2, every: 5 },            // passive coins for BOTH sides
  REWARDS: { 1: 8, 2: 14, 3: 22 },          // coins per correct answer by difficulty
  WRONG_LOCK: 1.4,                          // seconds the choices lock after a miss
  AI_RATE: { chill: 1.35, normal: 1.8, tough: 2.3 },   // AI coins per second (its "answers")
  // STRATEGY AXES — every pick has a counter:
  //  · armored troops shrug off arrows/zaps (×0.5) but cannons crush them (×1.6)
  //  · AIR troops float over cannon + tesla fire (only air-capable towers hit them)
  //  · swarms overwhelm slow single-shot towers; tesla/cannon clean them up
  UNITS: {
    runner:  { emoji: '🐰', name: 'Runner',  cost: 14, hp: 125, speed: 64,  dmg: 26, tip: 'Cheap & steady' },
    speedy:  { emoji: '🦅', name: 'Speedy',  cost: 22, hp: 82,  speed: 102, dmg: 34, tip: 'Races past slow towers' },
    brute:   { emoji: '🐗', name: 'Brute',   cost: 34, hp: 450, speed: 37,  dmg: 62, armored: true, tip: '🛡 armored: laughs at arrows' },
    balloon: { emoji: '🎈', name: 'Balloon', cost: 30, hp: 140, speed: 55,  dmg: 42, air: true, tip: '✈ flies OVER 💣 and ⚡' },
    mice:    { emoji: '🐭', name: 'Mice ×4', cost: 26, hp: 42,  speed: 82,  dmg: 11, pack: 4, tip: 'A swarm — too many to snipe' },
  },
  TOWERS: {
    archer: { emoji: '🏹', name: 'Archer', cost: 38, range: 100, dmg: 7,  rate: 0.5,  air: true,  vsArmor: 0.5, tip: 'Hits ✈ air · weak vs 🛡' },
    ice:    { emoji: '❄️', name: 'Ice',    cost: 45, range: 92,  dmg: 3,  rate: 0.7,  air: true,  vsArmor: 1,   slow: 0.35, slowFor: 0.8, tip: 'Slows everything, even ✈' },
    cannon: { emoji: '💣', name: 'Cannon', cost: 60, range: 88,  dmg: 15, rate: 1.15, air: false, vsArmor: 1.6, splash: 36, tip: 'Splash! crushes 🛡 · can’t aim up' },
    sniper: { emoji: '🎯', name: 'Sniper', cost: 65, range: 175, dmg: 30, rate: 2.0,  air: true,  vsArmor: 1,   tip: 'Huge range · overkilled by swarms' },
    tesla:  { emoji: '⚡', name: 'Tesla',  cost: 55, range: 66,  dmg: 3,  rate: 0.22, air: false, vsArmor: 0.5, tip: 'Zap-zap-zap! shreds swarms' },
  },
  UPGRADES: {
    // attacker
    armor: { emoji: '🛡', name: 'Armor',  desc: 'New troops +18% HP',    base: 40, growth: 1.5, side: 'attack' },
    drums: { emoji: '🥁', name: 'Drums',  desc: 'New troops +9% speed',  base: 40, growth: 1.5, side: 'attack' },
    // defender
    sharpen: { emoji: '⚒️', name: 'Sharpen', desc: 'All towers +14% damage', base: 45, growth: 1.5, side: 'defend' },
    repair:  { emoji: '🔧', name: 'Repair',  desc: 'Base +40 HP',            base: 55, growth: 1,   side: 'defend' },
  },
};

// Path waypoints across the 960×520 field (attacker camp → defender base).
const PATH = [[0, 260], [140, 260], [140, 110], [380, 110], [380, 410], [620, 410], [620, 180], [820, 180], [820, 300], [900, 300]];
// Tower slots flanking the path.
const SLOTS = [[80, 190], [200, 180], [200, 330], [310, 60], [310, 180], [450, 180], [450, 330], [450, 470], [560, 300], [690, 250], [690, 110], [750, 350], [875, 230], [760, 240]];

// path geometry: cumulative lengths so a troop is just "distance along path"
const SEGS = []; let PATH_LEN = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const [x1, y1] = PATH[i], [x2, y2] = PATH[i + 1];
  const len = Math.hypot(x2 - x1, y2 - y1);
  SEGS.push({ x1, y1, x2, y2, len, start: PATH_LEN });
  PATH_LEN += len;
}
function pathPos(s) {
  s = Math.max(0, Math.min(PATH_LEN, s));
  for (const seg of SEGS) {
    if (s <= seg.start + seg.len) { const u = (s - seg.start) / seg.len; return { x: seg.x1 + (seg.x2 - seg.x1) * u, y: seg.y1 + (seg.y2 - seg.y1) * u }; }
  }
  return { x: PATH[PATH.length - 1][0], y: PATH[PATH.length - 1][1] };
}
// how much of the path a tower at (x,y,range) covers — used by the AI to pick slots
function slotCoverage(x, y, range) {
  let c = 0;
  for (let s = 0; s < PATH_LEN; s += 20) { const p = pathPos(s); if (Math.hypot(p.x - x, p.y - y) <= range) c++; }
  return c;
}

const TD = { state: null, config: CONFIG, ready: false, opts: { role: 'defend', ai: 'normal', mins: 3 } };
window.TD = TD;

// ---------- question feed ----------
const QUIZ = { pools: { 1: [], 2: [], 3: [] }, bags: { 1: [], 2: [], 3: [] } };
const FALLBACK_QS = [
  { prompt: 'What is 4 + 3?', choices: ['5', '6', '7', '8'], answer: '7', diff: 1 },
  { prompt: 'What is 9 - 4?', choices: ['5', '4', '6', '3'], answer: '5', diff: 1 },
  { prompt: 'What is 6 × 7?', choices: ['36', '42', '48', '40'], answer: '42', diff: 2 },
  { prompt: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], answer: '6', diff: 2 },
  { prompt: 'What is 144 ÷ 12?', choices: ['10', '11', '12', '13'], answer: '12', diff: 3 },
  { prompt: 'What is 25% of 80?', choices: ['15', '20', '25', '40'], answer: '20', diff: 3 },
];
async function loadQuestions() {
  let qs = [];
  try { const r = await fetch('/quiz/mcq'); const j = await r.json(); qs = j.questions || []; } catch { /* offline */ }
  if (!qs.length) qs = FALLBACK_QS;
  for (const q of qs) (QUIZ.pools[q.diff] || QUIZ.pools[2]).push(q);
  // any empty tier borrows from its neighbours so every tab always works
  for (const d of [1, 2, 3]) if (!QUIZ.pools[d].length) QUIZ.pools[d] = QUIZ.pools[d === 1 ? 2 : d === 3 ? 2 : 1].slice() || FALLBACK_QS.slice();
  TD.ready = true;
  const sb = $('start-btn'); if (sb) { sb.disabled = false; sb.textContent = 'Start Battle ▶'; }
}
function nextQuestion(diff) {
  if (!QUIZ.bags[diff].length) QUIZ.bags[diff] = QUIZ.pools[diff].slice().sort(() => Math.random() - 0.5);
  return QUIZ.bags[diff].shift();
}

// ---------- game state ----------
function newState() {
  const o = TD.opts;
  return {
    role: o.role, aiLevel: o.ai, status: 'playing',
    timeLeft: o.mins * 60, baseHP: CONFIG.BASE_HP, baseMax: CONFIG.BASE_HP,
    coins: 30, aiCoins: 30, dripAcc: 0, aiAcc: 0, aiPulse: 0,
    troops: [], towers: [], shots: [], floats: [], booms: [],
    upgrades: { armor: 0, drums: 0, sharpen: 0, repair: 0 },
    aiUpgrades: { armor: 0, drums: 0, sharpen: 0, repair: 0 },
    kills: 0, sent: 0, answered: 0,
    selBuild: null, qDiff: 2, q: null, qLock: 0,
    winner: null,
  };
}
const mySide = () => TD.state.role;                       // 'attack' | 'defend'
const aiSide = () => (TD.state.role === 'attack' ? 'defend' : 'attack');

// upgrades helper: which set applies to a given side
function upgOf(side) { const st = TD.state; return (side === mySide()) ? st.upgrades : st.aiUpgrades; }
function upgCost(key, side) { const u = CONFIG.UPGRADES[key]; return Math.round(u.base * Math.pow(u.growth, upgOf(side)[key])); }

// ---------- actions (used by UI, AI and tests) ----------
function spawnTroop(kind, side, sOffset = 0) {
  const st = TD.state, def = CONFIG.UNITS[kind]; if (!def) return null;
  const u = upgOf(side);
  const troop = {
    kind, side, s: sOffset, emoji: def.emoji,
    hp: Math.round(def.hp * Math.pow(1.18, u.armor)), max: Math.round(def.hp * Math.pow(1.18, u.armor)),
    speed: def.speed * Math.pow(1.09, u.drums), dmg: def.dmg, slow: 0,
    air: !!def.air, armored: !!def.armored,
  };
  st.troops.push(troop); st.sent++;
  return troop;
}
// a "pack" unit (the mice) spawns several critters strung out behind each other
function spawnUnit(kind, side) {
  const def = CONFIG.UNITS[kind]; if (!def) return;
  const n = def.pack || 1;
  for (let i = 0; i < n; i++) spawnTroop(kind, side, -i * 9);
}
// `side` is a ROLE string ('attack' | 'defend'); the wallet is yours when the
// role matches your side, the AI's otherwise.
const walletOf = (side) => (side === mySide() ? 'coins' : 'aiCoins');
function buyUnit(kind, side) {
  const st = TD.state; if (!st || st.status !== 'playing') return false;
  side = side || mySide(); if (side !== 'attack') return false;
  const def = CONFIG.UNITS[kind]; if (!def) return false;
  const wallet = walletOf(side);
  if (st[wallet] < def.cost) return false;
  st[wallet] -= def.cost;
  spawnUnit(kind, side);
  if (side === mySide()) { Sound.build(); updateHud(); refreshShop(); }
  return true;
}
function placeTower(kind, slotIdx, side) {
  const st = TD.state; if (!st || st.status !== 'playing') return false;
  side = side || mySide(); if (side !== 'defend') return false;
  const def = CONFIG.TOWERS[kind]; if (!def) return false;
  if (slotIdx < 0 || slotIdx >= SLOTS.length) return false;
  if (st.towers.some((t) => t.slot === slotIdx)) return false;
  const wallet = walletOf(side);
  if (st[wallet] < def.cost) return false;
  st[wallet] -= def.cost;
  const [x, y] = SLOTS[slotIdx];
  st.towers.push({ kind, side, slot: slotIdx, x, y, cd: 0, emoji: def.emoji });
  if (side === mySide()) { Sound.build(); st.selBuild = null; updateHud(); refreshShop(); }
  return true;
}
function buyUpgrade(key, side) {
  const st = TD.state; if (!st || st.status !== 'playing') return false;
  side = side || mySide();
  const u = CONFIG.UPGRADES[key]; if (!u || u.side !== side) return false;
  const cost = upgCost(key, side), wallet = walletOf(side);
  if (st[wallet] < cost) return false;
  st[wallet] -= cost;
  if (key === 'repair') { st.baseHP = Math.min(st.baseMax, st.baseHP + 40); }
  else upgOf(side)[key]++;
  if (side === mySide()) { Sound.build(); updateHud(); refreshShop(); }
  return true;
}

// ---------- the simulation tick ----------
function tick(dt) {
  const st = TD.state; if (!st || st.status !== 'playing') return;
  st.timeLeft -= dt;

  // passive drip for both sides
  st.dripAcc += dt;
  while (st.dripAcc >= CONFIG.DRIP.every) { st.dripAcc -= CONFIG.DRIP.every; st.coins += CONFIG.DRIP.amount; st.aiCoins += CONFIG.DRIP.amount; }

  // AI income (its "question answering") + strategy
  st.aiAcc += CONFIG.AI_RATE[st.aiLevel] * dt;
  if (st.aiAcc >= 1) { const add = Math.floor(st.aiAcc); st.aiCoins += add; st.aiAcc -= add; }
  TD._lastDt = dt;
  aiThink();

  // troops walk the path
  for (const tr of st.troops) {
    const slowMul = tr.slow > 0 ? (1 - (tr.slowPow || 0.35)) : 1;
    if (tr.slow > 0) tr.slow -= dt;
    tr.s += tr.speed * slowMul * dt;
    if (tr.s >= PATH_LEN) {
      tr.dead = true;
      st.baseHP -= tr.dmg;
      st.booms.push({ x: 900, y: 300, t: 0.5 });
      if (mySide() === 'defend') Sound.boom();
      addFloat(880, 260, `-${tr.dmg} 🏰`);
    }
  }
  st.troops = st.troops.filter((t) => !t.dead);

  // towers fire — respecting the strategy axes: ground-only towers can't touch
  // AIR troops, and armored troops take each tower's vsArmor multiplier
  for (const tw of st.towers) {
    tw.cd -= dt; if (tw.cd > 0) continue;
    const def = CONFIG.TOWERS[tw.kind];
    const baseDmg = def.dmg * Math.pow(1.14, upgOf(tw.side).sharpen);
    const canHit = (tr) => !(tr.air && !def.air);
    // target the FRONT-most targetable troop in range
    let best = null, bestS = -1;
    for (const tr of st.troops) {
      if (!canHit(tr)) continue;
      const p = pathPos(tr.s);
      if (Math.hypot(p.x - tw.x, p.y - tw.y) <= def.range && tr.s > bestS) { best = tr; bestS = tr.s; }
    }
    if (!best) continue;
    tw.cd = def.rate;
    const bp = pathPos(best.s);
    st.shots.push({ x1: tw.x, y1: tw.y, x2: bp.x, y2: bp.y, t: 0.14, kind: tw.kind, air: best.air });
    const hurt = (tr, d) => {
      tr.hp -= tr.armored ? d * (def.vsArmor != null ? def.vsArmor : 1) : d;
      if (def.slow) { tr.slow = Math.max(tr.slow || 0, def.slowFor); tr.slowPow = def.slow; }
      if (tr.hp <= 0 && !tr.dead) { tr.dead = true; st.kills++; st.booms.push({ x: pathPos(tr.s).x, y: pathPos(tr.s).y, t: 0.4 }); }
    };
    if (def.splash) { for (const tr of st.troops) { if (!canHit(tr)) continue; const p = pathPos(tr.s); if (Math.hypot(p.x - bp.x, p.y - bp.y) <= def.splash) hurt(tr, baseDmg); } }
    else hurt(best, baseDmg);
    if (mySide() === 'defend') Sound.hit();
  }
  st.troops = st.troops.filter((t) => !t.dead);

  // effects age
  for (const s of st.shots) s.t -= dt; st.shots = st.shots.filter((s) => s.t > 0);
  for (const b of st.booms) b.t -= dt; st.booms = st.booms.filter((b) => b.t > 0);
  for (const f of st.floats) f.t -= dt; st.floats = st.floats.filter((f) => f.t > 0);
  if (st.qLock > 0) st.qLock -= dt;

  // win / lose
  if (st.baseHP <= 0) endGame('attack');
  else if (st.timeLeft <= 0) endGame('defend');
}

function endGame(winnerSide) {
  const st = TD.state; if (st.status !== 'playing') return;
  st.status = 'over'; st.winner = winnerSide;
  Sound.stopMusic();
  const youWon = winnerSide === mySide();
  if (youWon) Sound.win(); else Sound.lose();
  $('end-title').textContent = youWon ? '🏆 You win!' : '🤖 The AI wins!';
  $('end-sub').textContent = winnerSide === 'attack'
    ? 'The base was destroyed!' + ` (${st.kills} troops fell on the way)`
    : `The base survived with ${Math.max(0, Math.round(st.baseHP))} HP! (${st.kills} troops stopped)`;
  $('end-overlay').classList.add('show');
}

// ---------- AI ----------
// One strategy brain used by the AI side — and, when TD.autoPilot is set, by
// the "player" side too (that's how the balance sim plays AI vs AI).
// Defender: keep building the best-coverage free slot; repair/sharpen later.
// Attacker: save into pulses, then send a mixed squad (bigger on tough).
function sideThink(side) {
  const st = TD.state, wallet = walletOf(side);
  if (side === 'defend') {
    // scout the attack: if AIR keeps coming and we lack air-capable towers,
    // build one NOW instead of following the book
    const airSeen = st.troops.filter((t) => t.air).length + (st._airEverSeen || 0);
    if (st.troops.some((t) => t.air)) st._airEverSeen = (st._airEverSeen || 0) + 0.05;
    const airTowers = st.towers.filter((t) => CONFIG.TOWERS[t.kind].air).length;
    const order = ['archer', 'cannon', 'archer', 'ice', 'sniper', 'tesla', 'cannon', 'sniper'];
    const built = st.towers.length;
    let nextKind = order[Math.min(built, order.length - 1)];
    if (airSeen >= 1 && airTowers < Math.max(1, built / 2)) nextKind = airTowers % 2 ? 'sniper' : 'archer';
    const def = CONFIG.TOWERS[nextKind];
    if (st[wallet] >= def.cost && built < SLOTS.length) {
      let bestIdx = -1, bestCov = -1;
      for (let i = 0; i < SLOTS.length; i++) {
        if (st.towers.some((t) => t.slot === i)) continue;
        const cov = slotCoverage(SLOTS[i][0], SLOTS[i][1], def.range);
        if (cov > bestCov) { bestCov = cov; bestIdx = i; }
      }
      if (bestIdx >= 0) { placeTower(nextKind, bestIdx, side); return; }
    }
    if (st.baseHP < st.baseMax * 0.55 && st[wallet] >= upgCost('repair', side)) { buyUpgrade('repair', side); return; }
    if (built >= 5 && st[wallet] >= upgCost('sharpen', side)) buyUpgrade('sharpen', side);
  } else {
    const pulseAt = { chill: 70, normal: 105, tough: 150 }[st.aiLevel];
    if (st[wallet] >= pulseAt) {
      if (Math.random() < 0.22 && st[wallet] >= upgCost('armor', side) + 45) buyUpgrade('armor', side);
      // scout the defence and counter-pick the wave composition
      const count = (k) => st.towers.filter((t) => t.kind === k).length;
      const groundOnly = count('cannon') + count('tesla');
      const airCap = count('archer') + count('sniper') + count('ice');
      const antiArmor = count('cannon') + count('sniper');
      let mix;
      if (st.towers.length >= 2 && groundOnly >= airCap) mix = ['balloon', 'balloon', 'brute', 'balloon', 'mice'];       // they can't shoot up!
      else if (st.towers.length >= 2 && antiArmor <= 1) mix = ['brute', 'brute', 'mice', 'brute', 'speedy'];              // arrows tickle armor
      else if (count('sniper') >= 2) mix = ['mice', 'mice', 'speedy', 'runner', 'mice'];                                   // drown the snipers
      else mix = ['brute', 'speedy', 'mice', 'balloon', 'runner'];
      let mi = 0, guard = 0;
      while (st[wallet] >= 14 && guard++ < 16) {
        const kind = mix[mi++ % mix.length];
        if (CONFIG.UNITS[kind].cost <= st[wallet]) { st[wallet] -= CONFIG.UNITS[kind].cost; spawnUnit(kind, side); }
        else break;
      }
    }
  }
}
function aiThink() {
  sideThink(aiSide());
  // balance-sim mode: the player side is ALSO driven by the same brain, with
  // the same income rate as the AI (instead of question answering)
  if (TD.autoPilot) {
    const st = TD.state;
    st._apAcc = (st._apAcc || 0) + CONFIG.AI_RATE[st.aiLevel] * TD._lastDt;
    if (st._apAcc >= 1) { const add = Math.floor(st._apAcc); st.coins += add; st._apAcc -= add; }
    sideThink(mySide());
  }
}

// ---------- question panel ----------
function showQuestion() {
  const st = TD.state;
  st.q = nextQuestion(st.qDiff);
  $('q-prompt').textContent = st.q.prompt;
  const box = $('q-choices'); box.innerHTML = '';
  st.q.choices.forEach((c) => {
    const b = document.createElement('button');
    b.textContent = c;
    b.addEventListener('click', () => answer(c));
    box.appendChild(b);
  });
  $('q-feedback').textContent = '';
}
function answer(choice) {
  const st = TD.state; if (!st || st.status !== 'playing' || !st.q || st.qLock > 0) return false;
  const correct = String(choice) === String(st.q.answer);
  st.answered++;
  const btns = [...$('q-choices').children];
  if (correct) {
    const reward = CONFIG.REWARDS[st.qDiff];
    st.coins += reward;
    Sound.coin();
    $('q-feedback').textContent = `✓ +${reward} 🪙`;
    $('q-feedback').style.color = '#1f7a44';
    btns.forEach((b) => { if (b.textContent === String(st.q.answer)) b.classList.add('good'); b.disabled = true; });
    addFloat(60, 60, `+${reward} 🪙`);
    updateHud(); refreshShop();
    setTimeout(() => { if (TD.state && TD.state.status === 'playing') showQuestion(); }, 650);
  } else {
    Sound.bad();
    st.qLock = CONFIG.WRONG_LOCK;
    $('q-feedback').textContent = `✗ It was ${st.q.answer}`;
    $('q-feedback').style.color = '#b3324b';
    btns.forEach((b) => { b.disabled = true; if (b.textContent === String(st.q.answer)) b.classList.add('good'); else if (b.textContent === String(choice)) b.classList.add('bad'); });
    setTimeout(() => { if (TD.state && TD.state.status === 'playing') showQuestion(); }, CONFIG.WRONG_LOCK * 1000);
  }
  return correct;
}
function setQDiff(d) {
  const st = TD.state; st.qDiff = d;
  document.querySelectorAll('.dtab').forEach((t) => t.classList.toggle('on', +t.dataset.d === d));
  showQuestion();
}

// ---------- shop ----------
function refreshShop() {
  const st = TD.state; if (!st) return;
  const items = $('shop-items'), ups = $('shop-upgrades');
  items.innerHTML = ''; ups.innerHTML = '';
  if (mySide() === 'attack') {
    $('shop-title').textContent = '⚔️ Send troops';
    for (const [k, u] of Object.entries(CONFIG.UNITS)) {
      const b = document.createElement('button');
      b.className = 'buy'; b.disabled = st.coins < u.cost;
      b.innerHTML = `<span class="big">${u.emoji}</span>${u.name}<br><small class="tip">${u.tip || ''}</small><br><span class="cost">${u.cost} 🪙</span>`;
      b.addEventListener('click', () => buyUnit(k));
      items.appendChild(b);
    }
  } else {
    $('shop-title').textContent = '🛡 Build towers — pick one, then tap a spot';
    for (const [k, t] of Object.entries(CONFIG.TOWERS)) {
      const b = document.createElement('button');
      b.className = 'buy' + (st.selBuild === k ? ' sel' : ''); b.disabled = st.coins < t.cost;
      b.innerHTML = `<span class="big">${t.emoji}</span>${t.name}<br><small class="tip">${t.tip || ''}</small><br><span class="cost">${t.cost} 🪙</span>`;
      b.addEventListener('click', () => { st.selBuild = st.selBuild === k ? null : k; refreshShop(); });
      items.appendChild(b);
    }
  }
  for (const [k, u] of Object.entries(CONFIG.UPGRADES)) {
    if (u.side !== mySide()) continue;
    const cost = upgCost(k, mySide());
    const lvl = upgOf(mySide())[k];
    const b = document.createElement('button');
    b.className = 'buy'; b.disabled = st.coins < cost;
    b.innerHTML = `<span class="big">${u.emoji}</span>${u.name}${k !== 'repair' ? ' Lv' + (lvl + 1) : ''}<br><small>${u.desc}</small><br><span class="cost">${cost} 🪙</span>`;
    b.addEventListener('click', () => buyUpgrade(k));
    ups.appendChild(b);
  }
  $('shop-hint').textContent = mySide() === 'defend'
    ? (st.selBuild ? 'Now tap a dashed circle on the field!' : 'Tip: ❄️ slows troops, 💣 splashes groups.')
    : 'Tip: 🐗 soak arrows, 🦅 outrun them. Mix them!';
}

// ---------- HUD ----------
function updateHud() {
  const st = TD.state; if (!st) return;
  $('hud-coins').textContent = st.coins;
  $('hud-ai').textContent = st.aiCoins;
  $('hud-base').textContent = Math.max(0, Math.round(st.baseHP));
  const t = Math.max(0, Math.ceil(st.timeLeft));
  $('hud-time').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
function addFloat(x, y, txt) { TD.state.floats.push({ x, y, txt, t: 1.2 }); }

// ---------- rendering: Babylon 3D (kart-game standard) ----------
// The battlefield is a real 3D scene: low-poly grass field, a dirt-ribbon road,
// procedural towers/troops with shadows, glowing shots and particle-style booms —
// the same bright look the kart game builds from primitives. All game LOGIC is
// unchanged; this layer just mirrors TD.state into meshes each frame.
const WU = 10;                                  // logical px per world unit
const wx = (x) => x / WU, wz = (y) => y / WU;   // logical → world (y up)
let engine3d = null, scene = null, camera = null, shadowGen = null, canvas = null;
let floatLayer = null;
const meshOf = new Map();                       // state object → its mesh root
let padMeshes = [], matCache = {}, clouds = [], rangeRing = null;

function mat(name, r, g, b, opts = {}) {
  if (matCache[name]) return matCache[name];
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  if (opts.e) m.emissiveColor = new BABYLON.Color3(r * opts.e, g * opts.e, b * opts.e);
  if (opts.alpha != null) m.alpha = opts.alpha;
  matCache[name] = m; return m;
}
function srand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function buildWorld() {
  const rnd = srand(20260704);
  // ---- floating-island diorama: grass slab with dirt cliffs over a soft sea ----
  const IW = 112, ID = 66, CX = wx(470), CZ = wz(258);
  const gt = new BABYLON.DynamicTexture('grass', { width: 1024, height: 1024 }, scene, true);
  const gc = gt.getContext();
  gc.fillStyle = '#7ec850'; gc.fillRect(0, 0, 1024, 1024);
  // mottled light/dark grass patches, then fine speckles — reads as painted turf
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 1024, y = rnd() * 1024, r = 40 + rnd() * 90;
    const g2 = gc.createRadialGradient(x, y, 4, x, y, r);
    const tone = rnd() < 0.5 ? 'rgba(110,185,70,0.5)' : 'rgba(150,220,110,0.45)';
    g2.addColorStop(0, tone); g2.addColorStop(1, 'rgba(0,0,0,0)');
    gc.fillStyle = g2; gc.beginPath(); gc.arc(x, y, r, 0, 7); gc.fill();
  }
  for (let i = 0; i < 3200; i++) { const r = rnd(); gc.fillStyle = r < 0.45 ? '#8ad25c' : r < 0.8 ? '#6fb845' : '#98dd6c'; gc.fillRect((rnd() * 1024) | 0, (rnd() * 1024) | 0, 3, 3); }
  // a few baked flowers
  for (let i = 0; i < 90; i++) { gc.fillStyle = ['#ffd9e8', '#fff3b0', '#ffffff'][i % 3]; const x = rnd() * 1024, y = rnd() * 1024; gc.fillRect(x, y, 4, 4); gc.fillStyle = '#f7c948'; gc.fillRect(x + 1, y + 1, 2, 2); }
  gt.update();
  const gm = new BABYLON.StandardMaterial('groundM', scene);
  gm.diffuseTexture = gt; gm.specularColor = BABYLON.Color3.Black();
  const ground = BABYLON.MeshBuilder.CreateBox('ground', { width: IW, height: 3, depth: ID }, scene);
  ground.position.set(CX, -1.5, CZ);
  const cliff = new BABYLON.StandardMaterial('cliffM', scene);
  cliff.diffuseColor = new BABYLON.Color3(0.52, 0.38, 0.26); cliff.specularColor = BABYLON.Color3.Black();
  const multi = new BABYLON.MultiMaterial('islandM', scene);
  multi.subMaterials = [cliff, cliff, cliff, cliff, gm, cliff];      // +Y face gets the grass
  ground.material = multi; ground.subMeshes = [];
  const verts = ground.getTotalVertices();
  for (let f = 0; f < 6; f++) new BABYLON.SubMesh(f, 0, verts, f * 6, 6, ground);
  ground.receiveShadows = true; ground.isPickable = false;
  // a second, deeper slab makes the cliff feel layered
  const under = BABYLON.MeshBuilder.CreateBox('under', { width: IW - 5, height: 2.4, depth: ID - 5 }, scene);
  under.position.set(CX, -3.9, CZ); under.material = mat('underRock', 0.4, 0.3, 0.22); under.isPickable = false;
  // soft sea far below
  const sea = BABYLON.MeshBuilder.CreateGround('sea', { width: 420, height: 300 }, scene);
  sea.position.set(CX, -9, CZ);
  const seaM = new BABYLON.StandardMaterial('seaM', scene);
  seaM.diffuseColor = new BABYLON.Color3(0.36, 0.62, 0.85); seaM.specularColor = new BABYLON.Color3(0.15, 0.18, 0.2);
  sea.material = seaM; sea.isPickable = false;
  // drifting puffy clouds (drawn between sea and island edge — pure charm)
  clouds = [];
  for (let i = 0; i < 5; i++) {
    const cl = new BABYLON.TransformNode('cloud' + i, scene);
    for (let k = 0; k < 3; k++) {
      const puff = BABYLON.MeshBuilder.CreateSphere('cp', { diameter: 3.2 + rnd() * 2.4, segments: 8 }, scene);
      puff.position.set(k * 2.1 - 2 + rnd(), rnd() * 0.5, rnd() * 1.6 - 0.8);
      puff.parent = cl; puff.isPickable = false;
      puff.material = mat('cloudW', 0.98, 0.99, 1, { e: 0.35, alpha: 0.92 });
    }
    cl.position.set(CX - 40 + rnd() * 80, 13 + rnd() * 4, CZ - 26 + rnd() * 44);
    cl._spd = 0.55 + rnd() * 0.6; cl._x0 = cl.position.x;
    clouds.push(cl);
  }

  // the dirt road: a ribbon along the waypoints (same trick as the kart track).
  // Normals are SMOOTHED over a ±14px window so the ribbon doesn't pinch into
  // bowties at the 90° corners, and it's lit flat (emissive) so no dark facets.
  const roadDir = (s) => {
    const a = pathPos(Math.max(0, s - 14)), b = pathPos(Math.min(PATH_LEN, s + 14));
    let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  const mkRibbon = (name, hw, y, r, g, bl) => {
    const left = [], right = [];
    for (let s = 0; s <= PATH_LEN; s += 6) {
      const p = pathPos(s), d = roadDir(s);
      left.push(new BABYLON.Vector3(wx(p.x - d.y * hw), y, wz(p.y + d.x * hw)));
      right.push(new BABYLON.Vector3(wx(p.x + d.y * hw), y, wz(p.y - d.x * hw)));
    }
    const rib = BABYLON.MeshBuilder.CreateRibbon(name, { pathArray: [left, right] }, scene);
    const m = new BABYLON.StandardMaterial(name + 'M', scene);
    m.emissiveColor = new BABYLON.Color3(r, g, bl); m.disableLighting = true; m.backFaceCulling = false;
    rib.material = m; rib.isPickable = false;
    return rib;
  };
  mkRibbon('roadEdge', 22, 0.028, 0.68, 0.5, 0.3);   // darker shoulder
  mkRibbon('road', 18, 0.032, 0.85, 0.65, 0.41);     // dirt surface
  // pebbles pressed into the dirt + little edge stones — a used, hand-laid road
  for (let s = 14; s < PATH_LEN; s += 26) {
    const p = pathPos(s), d = roadDir(s);
    const off = (rnd() * 2 - 1) * 1.1;
    const peb = BABYLON.MeshBuilder.CreateSphere('peb', { diameter: 0.34 + rnd() * 0.3, segments: 5 }, scene);
    peb.position.set(wx(p.x) - d.y * off, 0.06, wz(p.y) + d.x * off);
    peb.scaling.y = 0.4; peb.material = mat(rnd() < 0.5 ? 'peb1' : 'peb2', 0.72 - rnd() * 0.1, 0.58, 0.4); peb.isPickable = false;
    if (s % 78 < 26) {
      for (const sd of [-1, 1]) {
        const es = BABYLON.MeshBuilder.CreateSphere('edge', { diameter: 0.5 + rnd() * 0.25, segments: 5 }, scene);
        es.position.set(wx(p.x) - d.y * sd * 2.35, 0.1, wz(p.y) + d.x * sd * 2.35);
        es.scaling.y = 0.55; es.material = mat('edgeStone', 0.62, 0.64, 0.68); es.isPickable = false;
      }
    }
  }

  // base HP bar floating over the castle (green → red as it drops)
  const baseBarB = BABYLON.MeshBuilder.CreatePlane('bhb', { width: 7, height: 0.8 }, scene);
  baseBarB.position.set(wx(900), 9.2, wz(300)); baseBarB.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  baseBarB.material = mat('hpBack', 0.12, 0.13, 0.16, { e: 0.9 }); baseBarB.isPickable = false;
  const baseBarF = BABYLON.MeshBuilder.CreatePlane('bhf', { width: 6.7, height: 0.5 }, scene);
  baseBarF.position.z = -0.01; baseBarF.parent = baseBarB; baseBarF.isPickable = false;
  baseBarF.material = mat('hpGreen', 0.25, 0.85, 0.45, { e: 0.9 });
  TD._baseBar = baseBarF;

  // stone build pads (pickable — tap to place a tower)
  padMeshes = SLOTS.map(([sx, sy], i) => {
    const pad = BABYLON.MeshBuilder.CreateCylinder('pad' + i, { diameter: 2.6, height: 0.24, tessellation: 20 }, scene);
    pad.position.set(wx(sx), 0.15, wz(sy));
    pad.material = new BABYLON.StandardMaterial('padM' + i, scene);
    pad.material.diffuseColor = new BABYLON.Color3(0.47, 0.5, 0.56);
    pad.material.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    pad.metadata = { slot: i };
    return pad;
  });

  // the castle (defender base): keep + corner towers + a little flag
  const castle = new BABYLON.TransformNode('castle', scene);
  const keep = BABYLON.MeshBuilder.CreateBox('keep', { width: 6, height: 4.4, depth: 6 }, scene);
  keep.position.y = 2.2; keep.parent = castle; keep.material = mat('castleWall', 0.78, 0.8, 0.85);
  for (const [cx, cz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const t = BABYLON.MeshBuilder.CreateCylinder('ct', { diameter: 2.2, height: 6, tessellation: 12 }, scene);
    t.position.set(cx, 3, cz); t.parent = castle; t.material = keep.material;
    const roof = BABYLON.MeshBuilder.CreateCylinder('cr', { diameterTop: 0, diameterBottom: 2.6, height: 1.8, tessellation: 12 }, scene);
    roof.position.set(cx, 6.9, cz); roof.parent = castle; roof.material = mat('roofRed', 0.85, 0.25, 0.25);
  }
  const pole = BABYLON.MeshBuilder.CreateCylinder('pole', { diameter: 0.16, height: 3 }, scene);
  pole.position.y = 6; pole.parent = castle; pole.material = mat('pole', 0.35, 0.25, 0.15);
  const flag = BABYLON.MeshBuilder.CreatePlane('flag', { width: 1.6, height: 1 }, scene);
  flag.position.set(0.9, 7, 0); flag.parent = castle; flag.material = mat('flagY', 1, 0.83, 0.25, { e: 0.5 });
  flag.material.backFaceCulling = false;
  castle.position.set(wx(900), 0, wz(300));
  castle.getChildMeshes().forEach((m) => { m.isPickable = false; shadowGen && shadowGen.addShadowCaster(m); });

  // attacker camp: a cheerful tent
  const tent = BABYLON.MeshBuilder.CreateCylinder('tent', { diameterTop: 0, diameterBottom: 4.6, height: 3.4, tessellation: 4 }, scene);
  tent.position.set(wx(26), 1.7, wz(226)); tent.rotation.y = Math.PI / 4;
  tent.material = mat('tentY', 0.95, 0.72, 0.3); tent.isPickable = false;
  shadowGen && shadowGen.addShadowCaster(tent);

  // trees + bushes off the road (deterministic sprinkle)
  const clearOf = (x, y) => {
    for (let s = 0; s < PATH_LEN; s += 14) { const p = pathPos(s); if (Math.hypot(p.x - x, p.y - y) < 55) return false; }
    return SLOTS.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 45) && Math.hypot(900 - x, 300 - y) > 80 && Math.hypot(26 - x, 226 - y) > 60;
  };
  for (let i = 0; i < 46; i++) {
    const x = 25 + rnd() * 910, y = 25 + rnd() * 470;
    if (!clearOf(x, y)) continue;
    const pick = rnd();
    if (pick < 0.34) {                    // pine
      const trunk = BABYLON.MeshBuilder.CreateCylinder('trk', { diameter: 0.5, height: 1.6, tessellation: 8 }, scene);
      trunk.position.set(wx(x), 0.8, wz(y)); trunk.material = mat('trunk', 0.45, 0.31, 0.18);
      const crown = BABYLON.MeshBuilder.CreateCylinder('crn', { diameterTop: 0, diameterBottom: 2.6 + rnd() * 1.4, height: 3.2 + rnd() * 1.6, tessellation: 8 }, scene);
      crown.position.set(wx(x), 3, wz(y)); crown.material = mat(rnd() < 0.5 ? 'pine1' : 'pine2', 0.2 + rnd() * 0.08, 0.55 + rnd() * 0.12, 0.25);
      trunk.isPickable = crown.isPickable = false;
      shadowGen && shadowGen.addShadowCaster(crown);
    } else if (pick < 0.58) {             // round leafy tree (two-puff crown)
      const trunk = BABYLON.MeshBuilder.CreateCylinder('trk2', { diameter: 0.55, height: 2, tessellation: 8 }, scene);
      trunk.position.set(wx(x), 1, wz(y)); trunk.material = mat('trunk', 0.45, 0.31, 0.18); trunk.isPickable = false;
      const c1 = BABYLON.MeshBuilder.CreateSphere('lf1', { diameter: 2.6 + rnd(), segments: 7 }, scene);
      c1.position.set(wx(x), 3 + rnd() * 0.4, wz(y)); c1.material = mat('leaf1', 0.34, 0.68, 0.3);
      const c2 = BABYLON.MeshBuilder.CreateSphere('lf2', { diameter: 1.7 + rnd() * 0.7, segments: 7 }, scene);
      c2.position.set(wx(x) + 0.8, 3.9 + rnd() * 0.3, wz(y) + 0.4); c2.material = mat('leaf2', 0.42, 0.76, 0.36);
      c1.isPickable = c2.isPickable = false;
      shadowGen && shadowGen.addShadowCaster(c1);
    } else if (pick < 0.76) {             // rock cluster
      for (let k = 0; k < 2 + (rnd() * 2 | 0); k++) {
        const rk = BABYLON.MeshBuilder.CreatePolyhedron('rk', { type: 2, size: 0.4 + rnd() * 0.55 }, scene);
        rk.position.set(wx(x) + rnd() * 1.6 - 0.8, 0.35, wz(y) + rnd() * 1.4 - 0.7);
        rk.rotation.y = rnd() * 3; rk.material = mat(rnd() < 0.5 ? 'rock1' : 'rock2', 0.6, 0.62, 0.66);
        rk.isPickable = false;
      }
    } else if (pick < 0.9) {              // bush + flowers
      const bush = BABYLON.MeshBuilder.CreateSphere('bsh', { diameter: 1.4 + rnd(), segments: 6 }, scene);
      bush.position.set(wx(x), 0.5, wz(y)); bush.material = mat('bush', 0.32, 0.62, 0.3); bush.isPickable = false;
      for (let k = 0; k < 3; k++) {
        const fl = BABYLON.MeshBuilder.CreateSphere('fl', { diameter: 0.22, segments: 5 }, scene);
        fl.position.set(wx(x) + rnd() * 1.6 - 0.8, 0.9 + rnd() * 0.2, wz(y) + rnd() * 1.4 - 0.7);
        fl.material = mat(['flP', 'flY', 'flW'][k % 3], ...[[1, 0.6, 0.8], [1, 0.9, 0.4], [1, 1, 1]][k % 3], { e: 0.5 });
        fl.isPickable = false;
      }
    } else {                              // mushrooms!
      const stem = BABYLON.MeshBuilder.CreateCylinder('ms', { diameter: 0.3, height: 0.6, tessellation: 6 }, scene);
      stem.position.set(wx(x), 0.3, wz(y)); stem.material = mat('mushStem', 0.95, 0.92, 0.85); stem.isPickable = false;
      const cap = BABYLON.MeshBuilder.CreateSphere('mc', { diameter: 0.9, segments: 7, slice: 0.55 }, scene);
      cap.position.set(wx(x), 0.55, wz(y)); cap.material = mat('mushCap', 0.9, 0.28, 0.25); cap.isPickable = false;
    }
  }
}

// ---- procedural low-poly troops & towers ----
function makeTroopMesh(tr) {
  const root = new BABYLON.TransformNode('troop', scene);
  let body;
  if (tr.kind === 'runner') {
    body = BABYLON.MeshBuilder.CreateSphere('b', { diameter: 1.5, segments: 8 }, scene);
    body.position.y = 0.85; body.material = mat('bunny', 0.96, 0.93, 0.88);
    for (const s of [-1, 1]) {
      const ear = BABYLON.MeshBuilder.CreateCapsule('e', { radius: 0.16, height: 1.1 }, scene);
      ear.position.set(s * 0.3, 1.9, 0); ear.parent = root; ear.material = mat('bunnyEar', 0.98, 0.72, 0.82);
    }
  } else if (tr.kind === 'speedy') {
    body = BABYLON.MeshBuilder.CreateCylinder('b', { diameterTop: 0.15, diameterBottom: 1.2, height: 1.8, tessellation: 8 }, scene);
    body.rotation.x = Math.PI / 2.4; body.position.y = 0.9; body.material = mat('bird', 0.29, 0.62, 0.85);
    for (const s of [-1, 1]) {
      const wing = BABYLON.MeshBuilder.CreatePlane('w', { width: 1.3, height: 0.6 }, scene);
      wing.position.set(s * 0.75, 1.05, 0); wing.rotation.z = s * 0.5; wing.parent = root;
      wing.material = mat('wing', 0.75, 0.88, 0.98, { alpha: 0.95 }); wing.material.backFaceCulling = false;
    }
  } else if (tr.kind === 'brute') {
    body = BABYLON.MeshBuilder.CreateSphere('b', { diameter: 2.2, segments: 8 }, scene);
    body.scaling.y = 0.85; body.position.y = 1.0; body.material = mat('boar', 0.5, 0.33, 0.2);
    for (const s of [-1, 1]) {
      const tusk = BABYLON.MeshBuilder.CreateCylinder('t', { diameterTop: 0, diameterBottom: 0.22, height: 0.7, tessellation: 6 }, scene);
      tusk.position.set(s * 0.45, 0.75, 1.0); tusk.rotation.x = -0.7; tusk.parent = root; tusk.material = mat('tusk', 0.95, 0.92, 0.8);
    }
    // armour plate so "armored" is readable at a glance
    const plate = BABYLON.MeshBuilder.CreateSphere('pl', { diameter: 2.35, segments: 8, slice: 0.5 }, scene);
    plate.position.y = 1.15; plate.parent = root; plate.material = mat('plate', 0.55, 0.58, 0.65);
  } else if (tr.kind === 'balloon') {
    body = BABYLON.MeshBuilder.CreateSphere('b', { diameter: 2.1, segments: 10 }, scene);
    body.scaling.y = 1.15; body.position.y = 2.2; body.material = mat('balloonR', 0.95, 0.3, 0.35, { e: 0.15 });
    const basket = BABYLON.MeshBuilder.CreateBox('bk', { width: 0.8, height: 0.6, depth: 0.8 }, scene);
    basket.position.y = 0.5; basket.parent = root; basket.material = mat('basket', 0.62, 0.45, 0.28);
    const rope = BABYLON.MeshBuilder.CreateCylinder('rp', { diameter: 0.06, height: 1.4 }, scene);
    rope.position.y = 1.3; rope.parent = root; rope.material = mat('rope', 0.85, 0.8, 0.7);
  } else { // mice
    body = BABYLON.MeshBuilder.CreateSphere('b', { diameter: 1.0, segments: 8 }, scene);
    body.scaling.z = 1.25; body.position.y = 0.5; body.material = mat('mouse', 0.62, 0.63, 0.68);
    for (const s of [-1, 1]) {
      const ear = BABYLON.MeshBuilder.CreateSphere('me', { diameter: 0.42, segments: 6 }, scene);
      ear.position.set(s * 0.26, 0.95, 0.25); ear.parent = root; ear.material = mat('mouseEar', 0.9, 0.66, 0.72);
    }
    const tail = BABYLON.MeshBuilder.CreateCylinder('mt', { diameter: 0.08, height: 0.9 }, scene);
    tail.rotation.x = Math.PI / 2.4; tail.position.set(0, 0.4, -0.75); tail.parent = root; tail.material = mat('mouseTail', 0.85, 0.6, 0.66);
  }
  body.parent = root;
  // eyes for charm (the balloon's basket doesn't need any)
  if (tr.kind !== 'balloon') {
    const eyeY = { brute: 1.35, speedy: 1.15, runner: 1.15, mice: 0.66 }[tr.kind] || 1.15;
    const eyeS = tr.kind === 'mice' ? 0.13 : 0.2;
    for (const s of [-1, 1]) {
      const eye = BABYLON.MeshBuilder.CreateSphere('eye', { diameter: eyeS, segments: 6 }, scene);
      eye.position.set(s * (tr.kind === 'mice' ? 0.18 : 0.3), eyeY, tr.kind === 'speedy' ? 0.55 : tr.kind === 'mice' ? 0.55 : 0.62);
      eye.parent = root; eye.material = mat('eyeK', 0.08, 0.08, 0.1);
    }
  }
  // hp bar: dark back + green front, camera-facing
  const barB = BABYLON.MeshBuilder.CreatePlane('hb', { width: 1.8, height: 0.26 }, scene);
  barB.position.y = 2.6; barB.parent = root; barB.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  barB.material = mat('hpBack', 0.12, 0.13, 0.16, { e: 0.9 });
  const barF = BABYLON.MeshBuilder.CreatePlane('hf', { width: 1.72, height: 0.16 }, scene);
  barF.position.z = -0.01; barF.parent = barB;
  barF.material = mat('hpGreen', 0.25, 0.85, 0.45, { e: 0.9 });
  root._bar = barF;
  // soft blob shadow that stays glued to the ground (see syncScene)
  const shadow = BABYLON.MeshBuilder.CreateDisc('tsh', { radius: tr.kind === 'brute' ? 1.35 : tr.kind === 'mice' ? 0.55 : tr.kind === 'balloon' ? 1.0 : 0.9, tessellation: 14 }, scene);
  shadow.rotation.x = Math.PI / 2; shadow.position.y = 0.05; shadow.parent = root;
  shadow.material = mat('blobShadow', 0, 0, 0, { alpha: 0.22 });
  root._shadow = shadow;
  root.getChildMeshes().forEach((m) => { m.isPickable = false; });
  if (shadowGen && body) shadowGen.addShadowCaster(body);
  root.scaling.setAll(1.3);          // readable from the high view
  return root;
}
function makeTowerMesh(tw) {
  const root = new BABYLON.TransformNode('tower', scene);
  const stoneM = mat('stoneT', 0.66, 0.68, 0.74), stoneD = mat('stoneD', 0.5, 0.52, 0.58);
  const woodM = mat('woodT', 0.6, 0.43, 0.26), woodD = mat('woodTD', 0.45, 0.32, 0.2);
  if (tw.kind === 'archer') {
    // stone base → wooden lookout → red peaked roof with a pennant
    const base = BABYLON.MeshBuilder.CreateCylinder('a0', { diameterTop: 2.0, diameterBottom: 2.7, height: 1.5, tessellation: 10 }, scene);
    base.position.y = 0.75; base.parent = root; base.material = stoneM;
    const post = BABYLON.MeshBuilder.CreateCylinder('a1', { diameter: 1.3, height: 2.2, tessellation: 8 }, scene);
    post.position.y = 2.5; post.parent = root; post.material = woodM;
    const deck = BABYLON.MeshBuilder.CreateCylinder('a2', { diameter: 2.6, height: 0.4, tessellation: 8 }, scene);
    deck.position.y = 3.6; deck.parent = root; deck.material = woodD;
    for (let k = 0; k < 4; k++) {
      const rail = BABYLON.MeshBuilder.CreateBox('a3', { width: 0.16, height: 0.7, depth: 0.16 }, scene);
      rail.position.set(Math.cos(k * 1.57) * 1.1, 4.1, Math.sin(k * 1.57) * 1.1); rail.parent = root; rail.material = woodD;
    }
    const roof = BABYLON.MeshBuilder.CreateCylinder('a4', { diameterTop: 0, diameterBottom: 3.1, height: 1.9, tessellation: 10 }, scene);
    roof.position.y = 5.3; roof.parent = root; roof.material = mat('roofRed', 0.85, 0.25, 0.25);
    const pen = BABYLON.MeshBuilder.CreatePlane('a5', { width: 0.9, height: 0.5 }, scene);
    pen.position.set(0.45, 6.5, 0); pen.parent = root; pen.material = mat('penY', 1, 0.83, 0.25, { e: 0.5 }); pen.material.backFaceCulling = false;
    const bow = BABYLON.MeshBuilder.CreateTorus('a6', { diameter: 1.1, thickness: 0.09, tessellation: 18 }, scene);
    bow.position.set(0, 4.15, 1.15); bow.rotation.y = Math.PI / 2; bow.parent = root; bow.material = woodD;
  } else if (tw.kind === 'ice') {
    // frost rock with a crystal cluster
    const rock = BABYLON.MeshBuilder.CreatePolyhedron('i0', { type: 2, size: 1.15 }, scene);
    rock.position.y = 0.7; rock.scaling.y = 0.6; rock.parent = root; rock.material = mat('frostRock', 0.75, 0.82, 0.9);
    const snow = BABYLON.MeshBuilder.CreateCylinder('i1', { diameter: 3.0, height: 0.3, tessellation: 12 }, scene);
    snow.position.y = 0.15; snow.parent = root; snow.material = mat('snow', 0.94, 0.97, 1);
    const big = BABYLON.MeshBuilder.CreatePolyhedron('i2', { type: 1, size: 1.0 }, scene);
    big.position.y = 2.6; big.scaling.set(0.9, 1.9, 0.9); big.parent = root;
    big.material = mat('crystal', 0.55, 0.85, 1, { e: 0.6, alpha: 0.92 });
    root._spin = big;
    for (const [ox, oz, s] of [[0.85, 0.3, 0.55], [-0.7, -0.4, 0.45]]) {
      const c = BABYLON.MeshBuilder.CreatePolyhedron('i3', { type: 1, size: s }, scene);
      c.position.set(ox, 1.2, oz); c.scaling.set(0.8, 1.6, 0.8); c.parent = root;
      c.material = big.material;
    }
  } else if (tw.kind === 'cannon') {
    // squat stone turret, banded barrel, side wheels
    const drum = BABYLON.MeshBuilder.CreateCylinder('c0', { diameterTop: 2.6, diameterBottom: 3.1, height: 1.7, tessellation: 12 }, scene);
    drum.position.y = 0.85; drum.parent = root; drum.material = stoneD;
    const rim = BABYLON.MeshBuilder.CreateTorus('c1', { diameter: 2.7, thickness: 0.22, tessellation: 16 }, scene);
    rim.position.y = 1.7; rim.parent = root; rim.material = stoneM;
    const barrel = BABYLON.MeshBuilder.CreateCylinder('c2', { diameterTop: 0.95, diameterBottom: 1.15, height: 2.9, tessellation: 12 }, scene);
    barrel.rotation.x = Math.PI / 2.7; barrel.position.set(0, 2.2, 0.55); barrel.parent = root;
    barrel.material = mat('iron', 0.16, 0.17, 0.2); root._barrel = barrel;
    for (const h of [0.5, -0.5]) {
      const band = BABYLON.MeshBuilder.CreateTorus('c3', { diameter: 1.12, thickness: 0.09, tessellation: 12 }, scene);
      band.position.y = h; band.parent = barrel; band.material = mat('ironL', 0.3, 0.32, 0.36);
    }
    const muzzle = BABYLON.MeshBuilder.CreateTorus('c4', { diameter: 0.95, thickness: 0.14, tessellation: 12 }, scene);
    muzzle.position.y = 1.45; muzzle.parent = barrel; muzzle.material = mat('ironL', 0.3, 0.32, 0.36);
    for (const s of [-1, 1]) {
      const wheel = BABYLON.MeshBuilder.CreateCylinder('c5', { diameter: 1.5, height: 0.3, tessellation: 12 }, scene);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 1.55, 0.75, 0); wheel.parent = root; wheel.material = woodD;
    }
  } else if (tw.kind === 'sniper') {
    // tall watchtower: angled legs, cabin, slit window, long scoped barrel
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const leg = BABYLON.MeshBuilder.CreateCylinder('s0', { diameter: 0.32, height: 4.8, tessellation: 6 }, scene);
      leg.position.set(lx, 2.4, lz); leg.rotation.z = -lx * 0.12; leg.rotation.x = lz * 0.12; leg.parent = root; leg.material = woodD;
    }
    for (const y of [1.4, 2.8]) {
      const brace = BABYLON.MeshBuilder.CreateBox('s1', { width: 2.3, height: 0.14, depth: 2.3 }, scene);
      brace.position.y = y; brace.parent = root; brace.material = woodM;
    }
    const cabin = BABYLON.MeshBuilder.CreateBox('s2', { width: 2.5, height: 1.6, depth: 2.5 }, scene);
    cabin.position.y = 5.4; cabin.parent = root; cabin.material = woodM;
    const slit = BABYLON.MeshBuilder.CreateBox('s3', { width: 1.7, height: 0.35, depth: 0.1 }, scene);
    slit.position.set(0, 5.6, 1.28); slit.parent = root; slit.material = mat('slitK', 0.08, 0.09, 0.12);
    const roof = BABYLON.MeshBuilder.CreateCylinder('s4', { diameterTop: 0, diameterBottom: 3.4, height: 1.4, tessellation: 4 }, scene);
    roof.position.y = 6.9; roof.rotation.y = Math.PI / 4; roof.parent = root; roof.material = mat('roofG', 0.25, 0.5, 0.35);
    const barrel = BABYLON.MeshBuilder.CreateCylinder('s5', { diameter: 0.22, height: 2.8, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2.05; barrel.position.set(0, 5.55, 2.2); barrel.parent = root; barrel.material = mat('iron', 0.16, 0.17, 0.2);
    const lens = BABYLON.MeshBuilder.CreateSphere('s6', { diameter: 0.34, segments: 8 }, scene);
    lens.position.set(0, 5.62, 3.55); lens.parent = root; lens.material = mat('lens', 0.95, 0.35, 0.3, { e: 0.85 });
  } else {
    // tesla: iron base, ceramic rings, copper coil, crackling orb
    const base = BABYLON.MeshBuilder.CreateCylinder('z0', { diameterTop: 1.9, diameterBottom: 2.6, height: 1.1, tessellation: 10 }, scene);
    base.position.y = 0.55; base.parent = root; base.material = mat('ironB', 0.24, 0.26, 0.3);
    for (let k = 0; k < 3; k++) {
      const ring = BABYLON.MeshBuilder.CreateCylinder('z1', { diameter: 1.6 - k * 0.28, height: 0.3, tessellation: 10 }, scene);
      ring.position.y = 1.35 + k * 0.42; ring.parent = root; ring.material = k % 2 ? mat('ceram', 0.88, 0.86, 0.8) : mat('copper', 0.78, 0.48, 0.26);
    }
    const coil = BABYLON.MeshBuilder.CreateCylinder('z2', { diameter: 0.7, height: 1.3, tessellation: 10 }, scene);
    coil.position.y = 2.8; coil.parent = root; coil.material = mat('copper', 0.78, 0.48, 0.26);
    const orb = BABYLON.MeshBuilder.CreateSphere('z3', { diameter: 1.35, segments: 10 }, scene);
    orb.position.y = 3.9; orb.parent = root; orb.material = mat('zapOrb', 0.65, 0.9, 1, { e: 0.9 });
    root._spin = orb; root._orb = orb;
    const halo = BABYLON.MeshBuilder.CreateSphere('z4', { diameter: 1.9, segments: 8 }, scene);
    halo.position.y = 3.9; halo.parent = root; halo.material = mat('zapHalo', 0.6, 0.9, 1, { e: 0.5, alpha: 0.22 });
  }
  root.getChildMeshes().forEach((m) => { m.isPickable = false; shadowGen && shadowGen.addShadowCaster(m); });
  root.scaling.setAll(1.15);
  return root;
}

function createScene() {
  canvas = $('td-canvas');
  try { engine3d = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true); }
  catch { engine3d = null; return; }
  scene = new BABYLON.Scene(engine3d);
  scene.clearColor = new BABYLON.Color4(0.55, 0.78, 0.98, 1);
  // high vertical view framed tightly on the battlefield (no empty green waste)
  camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, 0.52, 67, new BABYLON.Vector3(wx(472), 0, wz(258)), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 42; camera.upperRadiusLimit = 82;
  camera.lowerBetaLimit = 0.25; camera.upperBetaLimit = 0.95;
  camera.wheelPrecision = 12; camera.pinchPrecision = 40; camera.panningSensibility = 0;
  const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85; hemi.groundColor = new BABYLON.Color3(0.35, 0.45, 0.3);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.45, -1, -0.35), scene);
  sun.intensity = 0.85; sun.position = new BABYLON.Vector3(70, 60, 50);
  shadowGen = new BABYLON.ShadowGenerator(1024, sun);
  shadowGen.useBlurExponentialShadowMap = true; shadowGen.blurKernel = 16;
  // gentle vignette focuses the eye on the battlefield (kart-style polish)
  scene.imageProcessingConfiguration.vignetteEnabled = true;
  scene.imageProcessingConfiguration.vignetteWeight = 2.2;
  scene.imageProcessingConfiguration.vignetteColor = new BABYLON.Color4(0.05, 0.1, 0.04, 0);
  scene.imageProcessingConfiguration.vignetteCameraFov = 0.9;
  buildWorld();
  // translucent RANGE RING previews the selected tower's reach over a pad
  rangeRing = BABYLON.MeshBuilder.CreateTorus('rangeRing', { diameter: 2, thickness: 0.14, tessellation: 48 }, scene);
  rangeRing.position.y = 0.3; rangeRing.isPickable = false; rangeRing.setEnabled(false);
  rangeRing.material = new BABYLON.StandardMaterial('rangeM', scene);
  rangeRing.material.emissiveColor = new BABYLON.Color3(0.45, 0.75, 1);
  rangeRing.material.alpha = 0.85; rangeRing.material.disableLighting = true;
  const rangeFill = BABYLON.MeshBuilder.CreateDisc('rangeFill', { radius: 1, tessellation: 48 }, scene);
  rangeFill.rotation.x = Math.PI / 2; rangeFill.position.y = 0.22; rangeFill.isPickable = false;
  rangeFill.material = new BABYLON.StandardMaterial('rangeFM', scene);
  rangeFill.material.emissiveColor = new BABYLON.Color3(0.45, 0.75, 1);
  rangeFill.material.alpha = 0.12; rangeFill.material.disableLighting = true;
  rangeRing._fill = rangeFill; rangeFill.setEnabled(false);
  scene.onPointerObservable.add((pi) => {
    const st = TD.state;
    if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      // hover a pad while placing → show the tower's range there
      if (!st || st.status !== 'playing' || mySide() !== 'defend' || !st.selBuild) { rangeRing.setEnabled(false); rangeRing._fill.setEnabled(false); return; }
      const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m.metadata && m.metadata.slot != null);
      if (hit && hit.hit && !st.towers.some((x) => x.slot === hit.pickedMesh.metadata.slot)) {
        const r = CONFIG.TOWERS[st.selBuild].range / WU;
        rangeRing.position.x = hit.pickedMesh.position.x; rangeRing.position.z = hit.pickedMesh.position.z;
        rangeRing.scaling.set(r, 1, r);
        rangeRing._fill.position.x = rangeRing.position.x; rangeRing._fill.position.z = rangeRing.position.z;
        rangeRing._fill.scaling.setAll(r);
        rangeRing.setEnabled(true); rangeRing._fill.setEnabled(true);
      } else { rangeRing.setEnabled(false); rangeRing._fill.setEnabled(false); }
      return;
    }
    if (pi.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
    if (!st || st.status !== 'playing' || mySide() !== 'defend' || !st.selBuild) return;
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m.metadata && m.metadata.slot != null);
    if (hit && hit.hit) { placeTower(st.selBuild, hit.pickedMesh.metadata.slot); rangeRing.setEnabled(false); rangeRing._fill.setEnabled(false); }
  });
  window.addEventListener('resize', () => { if (engine3d) { engine3d.resize(); frameField(); } });
}

// Fit the whole island to the canvas, whatever shape it is. The view is tilted,
// so there is no clean formula for how much ground the lens covers — instead
// the four corners are projected to pixels and the lens is nudged until the
// worst of them sits just inside the edge. Four passes is plenty to settle.
const FIELD = { w: 112, d: 66, cx: 47.0, cz: 25.8 };   // island size + centre, world units
function frameField() {
  if (!camera || !engine3d || !scene) return;
  const wpx = engine3d.getRenderWidth(), hpx = engine3d.getRenderHeight();
  if (!wpx || !hpx) return;
  const hw = FIELD.w / 2, hd = FIELD.d / 2;
  const corners = [
    new BABYLON.Vector3(FIELD.cx - hw, 0, FIELD.cz - hd), new BABYLON.Vector3(FIELD.cx + hw, 0, FIELD.cz - hd),
    new BABYLON.Vector3(FIELD.cx - hw, 0, FIELD.cz + hd), new BABYLON.Vector3(FIELD.cx + hw, 0, FIELD.cz + hd),
  ];
  const fill = 0.97;                                   // how much of the canvas the field should span
  // Pull the camera back rather than widening the lens. A wide lens runs into
  // its own limit on a tall window and distorts the towers on the way; moving
  // the camera is an honest zoom that always has room left.
  camera.lowerRadiusLimit = 20; camera.upperRadiusLimit = 400;
  const project = () => {
    scene.updateTransformMatrix();
    const vp = camera.viewport.toGlobal(wpx, hpx);
    const m = scene.getTransformMatrix();
    return corners.map((c) => BABYLON.Vector3.Project(c, BABYLON.Matrix.Identity(), m, vp));
  };
  const fitRadius = () => {
    for (let pass = 0; pass < 6; pass++) {
      const pts = project();
      let worst = 0;
      for (const v of pts) {
        if (!isFinite(v.x) || !isFinite(v.y)) return false;
        worst = Math.max(worst, Math.abs((v.x / wpx) * 2 - 1), Math.abs((v.y / hpx) * 2 - 1));
      }
      if (worst <= 0) return false;
      if (Math.abs(worst - fill) < 0.01) break;
      camera.radius = Math.max(20, Math.min(400, camera.radius * (worst / fill)));
    }
    return true;
  };
  // How much screen the field actually covers at this angle (corners are
  // TL, TR, BL, BR, so walk them TL→TR→BR→BL to get the outline).
  const area = () => {
    const q = project(), o = [q[0], q[1], q[3], q[2]];
    let a = 0;
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += o[i].x * o[j].y - o[j].x * o[i].y; }
    return Math.abs(a) / 2;
  };
  // A fixed tilt wastes the sides of a wide, short canvas and the top of a tall
  // one. Try a few angles and keep whichever one puts the most field on screen;
  // a flatter angle reads wider, a steeper one taller.
  let best = null;
  for (const beta of [0.28, 0.36, 0.44, 0.52, 0.62, 0.74, 0.88]) {
    camera.beta = beta;
    if (!fitRadius()) continue;
    const a = area();
    if (!best || a > best.a) best = { a, beta, radius: camera.radius };
  }
  if (best) { camera.beta = best.beta; camera.radius = best.radius; }
  // let the player still zoom and tilt a little around wherever we landed
  camera.lowerRadiusLimit = camera.radius * 0.62;
  camera.upperRadiusLimit = camera.radius * 1.35;
  camera.lowerBetaLimit = Math.max(0.16, camera.beta - 0.25);
  camera.upperBetaLimit = Math.min(1.3, camera.beta + 0.25);
}

function setupCanvas() {
  if (!scene) createScene();
  if (engine3d) { engine3d.resize(); frameField(); requestAnimationFrame(() => { engine3d.resize(); frameField(); }); }
  floatLayer = $('float-layer');
  // clear any meshes from a previous round
  for (const [, m] of meshOf) m.dispose();
  meshOf.clear();
}

// mirror TD.state → the 3D scene (mark-and-sweep per entity list)
function syncScene() {
  const st = TD.state; if (!scene || !st) return;
  const seen = new Set();
  const t = performance.now() / 1000;

  for (const tr of st.troops) {
    let m = meshOf.get(tr);
    if (!m) { m = makeTroopMesh(tr); meshOf.set(tr, m); }
    seen.add(tr);
    const p = pathPos(tr.s), q = pathPos(Math.min(PATH_LEN, tr.s + 6));
    const bob = tr.kind === 'brute' ? Math.abs(Math.sin(t * 6)) * 0.12 : Math.abs(Math.sin(t * (tr.kind === 'speedy' ? 14 : 10))) * 0.3;
    const fly = tr.air ? 3.6 + Math.sin(t * 2.2) * 0.35 : 0;   // air troops float over everything
    m.position.set(wx(p.x), bob + fly, wz(p.y));
    m.rotation.y = Math.atan2(q.x - p.x, q.y - p.y);
    if (m._shadow) { m._shadow.position.y = 0.05 - (bob + fly) / 1.3; m._shadow.scaling.setAll(tr.air ? 0.75 : 1); }
    m._bar.scaling.x = Math.max(0.02, tr.hp / tr.max);
    m._bar.material = tr.hp / tr.max > 0.4 ? matCache.hpGreen : mat('hpRed', 0.95, 0.35, 0.3, { e: 0.9 });
    const frost = tr.slow > 0;
    if (frost && !m._frost) { m._frost = BABYLON.MeshBuilder.CreateSphere('fr', { diameter: 2.6, segments: 6 }, scene); m._frost.material = mat('frost', 0.6, 0.85, 1, { alpha: 0.3, e: 0.4 }); m._frost.parent = m; m._frost.position.y = 1; m._frost.isPickable = false; }
    if (!frost && m._frost) { m._frost.dispose(); m._frost = null; }
  }
  for (const tw of st.towers) {
    let m = meshOf.get(tw);
    if (!m) { m = makeTowerMesh(tw); m.position.set(wx(tw.x), 0.3, wz(tw.y)); meshOf.set(tw, m); }
    seen.add(tw);
    if (m._spin) m._spin.rotation.y = t * 1.4;
    if (m._orb) m._orb.material.emissiveColor.set(0.5 + Math.random() * 0.3, 0.85, 1); // crackle
  }
  // clouds drift lazily across the island
  for (const cl of clouds) { cl.position.x = cl._x0 + ((t * cl._spd) % 90) - 45; }
  for (const s of st.shots) {
    let m = meshOf.get(s);
    if (!m) {
      // REAL projectiles that FLY from tower to target (arrows, shells, shards)
      const fromY = s.kind === 'sniper' ? 6.4 : s.kind === 'tesla' ? 4.4 : s.kind === 'cannon' ? 2.6 : 4.6;
      const from = new BABYLON.Vector3(wx(s.x1), fromY, wz(s.y1)), to = new BABYLON.Vector3(wx(s.x2), s.air ? 4.2 : 0.9, wz(s.y2));
      const mkMat = (r, g, b, e = 1) => { const mm = new BABYLON.StandardMaterial('pm', scene); mm.emissiveColor = new BABYLON.Color3(r * e, g * e, b * e); mm.diffuseColor = new BABYLON.Color3(r, g, b); mm.disableLighting = e >= 1; return mm; };
      if (s.kind === 'tesla') {
        // lightning: a jagged bright bolt that flickers in place
        m = BABYLON.MeshBuilder.CreateBox('bolt', { width: 0.16, height: 0.16, depth: 1 }, scene);
        m.material = mkMat(0.75, 0.95, 1);
        m.position = BABYLON.Vector3.Center(from, to); m.lookAt(to);
        m.scaling.set(2.2 + Math.random() * 1.6, 2.2 + Math.random() * 1.6, BABYLON.Vector3.Distance(from, to));
      } else if (s.kind === 'cannon') {
        m = BABYLON.MeshBuilder.CreateSphere('shell', { diameter: 0.55, segments: 8 }, scene);
        m.material = mkMat(0.15, 0.16, 0.19, 0.35);
      } else if (s.kind === 'ice') {
        m = BABYLON.MeshBuilder.CreatePolyhedron('shard', { type: 1, size: 0.28 }, scene);
        m.material = mkMat(0.62, 0.9, 1);
      } else {
        // archer/sniper arrow: shaft + bright head
        m = BABYLON.MeshBuilder.CreateCylinder('arrow', { diameter: 0.12, height: s.kind === 'sniper' ? 1.5 : 1.0, tessellation: 6 }, scene);
        m.rotation.x = Math.PI / 2; // align along look direction after lookAt via bake
        m.bakeCurrentTransformIntoVertices();
        m.material = mkMat(...(s.kind === 'sniper' ? [1, 0.5, 0.4] : [0.95, 0.88, 0.7]));
      }
      m.isPickable = false; m._from = from; m._to = to;
      meshOf.set(s, m);
    }
    seen.add(s);
    const u = 1 - Math.max(0, s.t / 0.14);
    if (s.kind !== 'tesla') {
      const pos = BABYLON.Vector3.Lerp(m._from, m._to, u);
      if (s.kind === 'cannon') pos.y += Math.sin(u * Math.PI) * 2.6;   // shells arc
      m.position = pos;
      if (s.kind === 'ice') m.rotation.y += 0.5; else m.lookAt(m._to);
    } else {
      m.material.alpha = Math.max(0, s.t / 0.14) * (0.6 + Math.random() * 0.4);
    }
  }
  for (const bm of st.booms) {
    let m = meshOf.get(bm);
    if (!m) {
      // flash + expanding ground ring + drifting smoke puffs
      m = new BABYLON.TransformNode('boom', scene);
      m.position.set(wx(bm.x), 0, wz(bm.y));
      const flash = BABYLON.MeshBuilder.CreateSphere('bf', { diameter: 1, segments: 8 }, scene);
      flash.position.y = 1; flash.parent = m; flash.isPickable = false;
      flash.material = new BABYLON.StandardMaterial('bfm', scene);
      flash.material.emissiveColor = new BABYLON.Color3(1, 0.72, 0.25); flash.material.disableLighting = true;
      const ring = BABYLON.MeshBuilder.CreateTorus('br', { diameter: 1, thickness: 0.16, tessellation: 20 }, scene);
      ring.position.y = 0.25; ring.parent = m; ring.isPickable = false;
      ring.material = new BABYLON.StandardMaterial('brm', scene);
      ring.material.emissiveColor = new BABYLON.Color3(1, 0.85, 0.5); ring.material.disableLighting = true;
      m._flash = flash; m._ring = ring; m._smoke = [];
      for (let k = 0; k < 3; k++) {
        const p = BABYLON.MeshBuilder.CreateSphere('bs', { diameter: 0.7 + k * 0.2, segments: 6 }, scene);
        p.parent = m; p.isPickable = false;
        p.material = new BABYLON.StandardMaterial('bsm', scene);
        p.material.diffuseColor = new BABYLON.Color3(0.55, 0.55, 0.58);
        p.material.emissiveColor = new BABYLON.Color3(0.28, 0.28, 0.3);
        p._dx = Math.cos(k * 2.1) * 0.7; p._dz = Math.sin(k * 2.1) * 0.7;
        m._smoke.push(p);
      }
      meshOf.set(bm, m);
    }
    seen.add(bm);
    const u = 1 - Math.max(0, bm.t / 0.5);
    m._flash.scaling.setAll(0.5 + u * 2.6);
    m._flash.material.alpha = Math.max(0, 1 - u * 1.6);
    m._ring.scaling.setAll(0.5 + u * 4.2);
    m._ring.material.alpha = Math.max(0, 0.9 - u);
    m._smoke.forEach((p, k) => {
      p.position.set(p._dx * (0.4 + u * 1.6), 0.8 + u * 2.2 + k * 0.3, p._dz * (0.4 + u * 1.6));
      p.scaling.setAll(0.7 + u * 1.4);
      p.material.alpha = Math.max(0, 0.75 - u * 0.75);
    });
  }
  // sweep meshes whose owner is gone
  for (const [k, m] of meshOf) if (!seen.has(k)) { m.dispose(); meshOf.delete(k); }

  // base HP bar tracks the castle's health
  if (TD._baseBar) {
    TD._baseBar.scaling.x = Math.max(0.02, st.baseHP / st.baseMax);
    TD._baseBar.material = st.baseHP / st.baseMax > 0.4 ? matCache.hpGreen : mat('hpRed', 0.95, 0.35, 0.3, { e: 0.9 });
  }
  // pads glow while placing
  const placing = mySide() === 'defend' && st.selBuild;
  padMeshes.forEach((pad, i) => {
    const used = st.towers.some((x) => x.slot === i);
    pad.material.emissiveColor = placing && !used
      ? new BABYLON.Color3(0.35 + 0.25 * Math.sin(t * 6), 0.3, 0.05)
      : BABYLON.Color3.Black();
  });
}

// crisp DOM floats (+14 🪙 …) projected from world space
function renderFloats() {
  const st = TD.state; if (!floatLayer || !scene || !st) return;
  let html = '';
  for (const f of st.floats) {
    const v = BABYLON.Vector3.Project(
      new BABYLON.Vector3(wx(f.x), 2.5, wz(f.y)),
      BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine3d.getRenderWidth(), engine3d.getRenderHeight()));
    html += `<span style="left:${(v.x / engine3d.getRenderWidth() * 100).toFixed(1)}%;top:${(v.y / engine3d.getRenderHeight() * 100).toFixed(1)}%;opacity:${Math.max(0, f.t).toFixed(2)};transform:translate(-50%,-${(70 + (1.2 - f.t) * 40) | 0}%)">${f.txt}</span>`;
  }
  floatLayer.innerHTML = html;
}

function render() {
  if (!scene) return;
  syncScene();
  renderFloats();
  scene.render();
}

// ---------- main loop ----------
let _last = 0, _raf = null;
function loop(t) {
  const dt = Math.min(0.05, (t - _last) / 1000 || 0.016);
  _last = t;
  if (TD.state && TD.state.status === 'playing') { tick(dt); updateHud(); render(); }
  _raf = requestAnimationFrame(loop);
}
// fast-forward without rendering — used by tests and balance sims
function turbo(seconds, dt = 0.05) { const st = TD.state; let t = 0; while (st.status === 'playing' && t < seconds) { tick(dt); t += dt; } }

// ---------- input ----------
// (tower placement is a 3D pick on the pad meshes — wired in createScene)

// ---------- screens ----------
function startGame() {
  TD.state = newState();
  // 'flex', not 'block': an inline style beats the stylesheet, and the
  // full-window column layout below depends on #game being a flex container.
  $('setup').style.display = 'none'; $('game').style.display = 'flex';
  document.body.classList.add('playing');           // battlefield takes over the window
  $('end-overlay').classList.remove('show');
  setupCanvas();
  refreshShop(); updateHud(); showQuestion();
  setQDiff(TD.state.qDiff);
  if (_raf == null) _raf = requestAnimationFrame(loop);
}
function toMenu() { TD.state = null; Sound.stopMusic(); document.body.classList.remove('playing'); $('game').style.display = 'none'; $('setup').style.display = 'block'; }

function setOpt(group, attr, val) { document.querySelectorAll(`#${group} .opt`).forEach((o) => o.classList.toggle('on', o.dataset[attr] === String(val))); }
$('opt-role').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; TD.opts.role = o.dataset.role; setOpt('opt-role', 'role', o.dataset.role); });
$('opt-ai').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; TD.opts.ai = o.dataset.ai; setOpt('opt-ai', 'ai', o.dataset.ai); });
$('opt-mins').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; TD.opts.mins = +o.dataset.mins; setOpt('opt-mins', 'mins', o.dataset.mins); });
$('start-btn').addEventListener('click', () => { if (TD.ready) { Sound.init(); startGame(); Sound.startMusic(); } });
$('quit-btn').addEventListener('click', toMenu);
$('end-again').addEventListener('click', startGame);
$('end-menu').addEventListener('click', toMenu);
document.querySelectorAll('.dtab').forEach((t) => t.addEventListener('click', () => setQDiff(+t.dataset.d)));
// rewards shown in the tabs come straight from config
window.addEventListener('DOMContentLoaded', () => { $('rw1').textContent = CONFIG.REWARDS[1]; $('rw2').textContent = CONFIG.REWARDS[2]; $('rw3').textContent = CONFIG.REWARDS[3]; });

// expose for tests
TD.frameField = frameField;
TD.tick = tick; TD.turbo = turbo; TD.answer = answer; TD.buyUnit = buyUnit; TD.placeTower = placeTower;
TD.buyUpgrade = buyUpgrade; TD.spawnTroop = spawnTroop; TD.start = startGame; TD.PATH_LEN = PATH_LEN;
TD.SLOTS = SLOTS; TD.pathPos = pathPos; TD.showQuestion = showQuestion; TD.setQDiff = setQDiff; TD.nextQuestion = nextQuestion;

loadQuestions();

if ($('sound-btn')) $('sound-btn').addEventListener('click', () => Sound.toggle());
window._soundForTest = Sound;   // headless checks inspect the music bed
