// ============================================================
// Pair Match — a card matching game that uses the quiz project's questions.
//   Easy   : all cards face up, tap two that go together.
//   Memory : all cards face down, flip two and remember positions.
// Pairs come from the server's /quiz/pairs endpoint (native `match` questions
// and question↔answer pairs from multiple choice / short answer).
// ============================================================

const state = {
  sets: [],
  subjects: [],
  mode: 'easy',           // 'easy' | 'memory'
  subject: null,          // null = all subjects
  set: null,              // the current pair-set being played
  cards: [],              // {pairId, side, content, el, matched}
  selected: [],           // currently flipped/selected cards (max 2)
  matched: 0,
  moves: 0,
  busy: false,            // true during the mismatch flip-back delay
  recent: [],             // ids of recently played sets (avoid immediate repeats)
};

const $ = (id) => document.getElementById(id);

// ---------- sound (reuses the kart game's Pixabay SFX + music) ----------
const Sound = {
  on: true,
  pools: {},        // key → array of <audio> channels for overlap
  idx: {},
  music: null,
  tracks: [],
  KEYS: { flip: 'click', match: 'coin', wrong: 'hit', win: 'win' },
  init() {
    try { this.on = localStorage.getItem('pm-sound') !== '0'; } catch { /* no storage */ }
    for (const key of new Set(Object.values(this.KEYS))) {
      const pool = [];
      for (let i = 0; i < 4; i++) { const a = new Audio(`assets/audio/sfx/${key}.mp3`); a.preload = 'auto'; pool.push(a); }
      this.pools[key] = pool; this.idx[key] = 0;
    }
    fetch('assets/audio/music/tracks.json').then((r) => r.json()).then((l) => { this.tracks = l || []; }).catch(() => {});
    this.updateBtn();
  },
  play(name, vol = 1) {
    if (!this.on) return;
    const key = this.KEYS[name]; const pool = this.pools[key]; if (!pool) return;
    this.idx[key] = (this.idx[key] + 1) % pool.length;
    const a = pool[this.idx[key]];
    try { a.currentTime = 0; a.volume = vol; a.play().catch(() => {}); } catch { /* ignore */ }
  },
  startMusic() {
    if (!this.on || !this.tracks.length) return;
    if (!this.music) {
      const t = this.tracks[Math.floor(Math.random() * this.tracks.length)];
      this.music = new Audio(`assets/audio/music/${t.file}`);
      this.music.loop = true; this.music.volume = 0.2; // gentle background bed
    }
    this.music.play().catch(() => {});
  },
  stopMusic() { if (this.music) { try { this.music.pause(); } catch { /* ignore */ } } },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('pm-sound', this.on ? '1' : '0'); } catch { /* ignore */ }
    if (this.on) this.startMusic(); else this.stopMusic();
    this.updateBtn();
  },
  updateBtn() {
    const b = $('sound-btn'); if (!b) return;
    b.textContent = this.on ? '🔊' : '🔈';
    b.classList.toggle('off', !this.on);
  },
};

// Choose a column count so the cards form a neat rectangle (2×2, 3×2, 4×2, 4×3…),
// narrower on phones.
function chooseCols(n) {
  const narrow = window.innerWidth < 520;
  if (narrow) return n <= 4 ? 2 : 3;
  if (n <= 4) return 2;   // 4 cards → 2×2
  if (n <= 6) return 3;   // 6 cards → 3×2
  return 4;               // 8 → 4×2, 10 → 4×3-ish, 12 → 4×3
}

// ---------- content rendering (text + inline KaTeX + image) ----------
function renderMath(el, tex, displayMode) {
  if (window.katex) {
    try { window.katex.render(tex, el, { throwOnError: false, displayMode }); return; }
    catch { /* fall through */ }
  }
  el.textContent = tex;
}
function renderRichText(parent, text) {
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const span = document.createElement('span');
    renderMath(span, m[1] ?? m[2], m[1] != null);
    parent.appendChild(span);
    last = re.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}
function renderContent(el, content) {
  el.textContent = '';
  if (content == null) return;
  if (typeof content === 'string') { renderRichText(el, content); return; }
  if (content.text) renderRichText(el, content.text);
  if (content.math) { const d = document.createElement('div'); renderMath(d, content.math, true); el.appendChild(d); }
  if (content.image) {
    const img = document.createElement('img');
    img.src = content.image.src; img.alt = content.image.alt || '';
    img.style.maxWidth = '100%'; img.style.maxHeight = '80px';
    el.appendChild(img);
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- setup screen ----------
async function loadSets() {
  try {
    const res = await fetch('quiz/pairs');
    const data = await res.json();
    state.sets = data.sets || [];
    state.subjects = data.subjects || [];
  } catch {
    state.sets = []; state.subjects = [];
  }
  renderSubjectChips();
  if (!state.sets.length) {
    $('subject-chips').innerHTML = '<span class="empty" style="padding:6px">No questions found. Is the quiz project next to this one?</span>';
    $('start-btn').disabled = true;
    $('start-btn').style.opacity = '0.5';
  }
}

function renderSubjectChips() {
  const wrap = $('subject-chips');
  wrap.innerHTML = '';
  const mk = (label, value) => {
    const c = document.createElement('div');
    c.className = 'chip' + ((state.subject === value) ? ' on' : '');
    c.textContent = label;
    c.onclick = () => { state.subject = value; renderSubjectChips(); };
    wrap.appendChild(c);
  };
  mk('🎲 All', null);
  state.subjects.forEach((s) => mk(s, s));
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode').forEach((m) => m.classList.toggle('on', m.dataset.mode === mode));
}

// ---------- a round ----------
function pickSet() {
  let pool = state.sets.filter((s) => !state.subject || s.subject === state.subject);
  if (!pool.length) pool = state.sets;
  // Avoid replaying the last few sets if we can.
  const fresh = pool.filter((s) => !state.recent.includes(s.id));
  const choose = (fresh.length ? fresh : pool);
  const set = choose[Math.floor(Math.random() * choose.length)];
  state.recent.push(set.id);
  if (state.recent.length > 6) state.recent.shift();
  return set;
}

function startRound() {
  const set = pickSet();
  state.set = set;
  state.selected = [];
  state.matched = 0;
  state.moves = 0;
  state.busy = false;

  // Build the deck: each pair → a left card and a right card.
  const cards = [];
  set.pairs.forEach((p, i) => {
    cards.push({ pairId: i, side: 'left', content: p.left, matched: false });
    cards.push({ pairId: i, side: 'right', content: p.right, matched: false });
  });
  shuffle(cards);
  state.cards = cards;

  $('prompt').textContent = set.prompt || 'Match the pairs';
  $('stat-total').textContent = set.pairs.length;
  $('stat-matched').textContent = '0';
  $('stat-moves').textContent = '0';
  $('explain').style.display = 'none';
  $('next-btn').style.display = 'none';

  renderBoard();
}

function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  board.style.setProperty('--cols', chooseCols(state.cards.length));
  state.cards.forEach((card) => {
    const tile = document.createElement('div');
    const faceUp = state.mode === 'easy';
    tile.className = 'tile ' + (faceUp ? 'up' : 'down') + ' side-' + card.side;
    const content = document.createElement('div');
    content.className = 'content';
    renderContent(content, card.content);
    tile.appendChild(content);
    if (faceUp) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      tile.appendChild(badge);
    }
    tile.onclick = () => onTileClick(card);
    card.el = tile;
    card.faceUp = faceUp;
    board.appendChild(tile);
  });
}

function flipUp(card) {
  card.faceUp = true;
  card.el.classList.remove('down');
  card.el.classList.add('up');
}
function flipDown(card) {
  card.faceUp = false;
  card.el.classList.remove('up', 'sel');
  card.el.classList.add('down');
}

function onTileClick(card) {
  if (state.busy || card.matched) return;
  // Deselect the single currently-selected card by tapping it again.
  if (state.selected.length === 1 && state.selected[0] === card) {
    card.el.classList.remove('sel');
    if (state.mode === 'memory') flipDown(card);
    state.selected = [];
    return;
  }
  if (state.selected.includes(card)) return;

  if (state.mode === 'memory') flipUp(card);
  card.el.classList.add('sel');
  state.selected.push(card);
  Sound.play('flip', 0.55);

  if (state.selected.length === 2) checkPair();
}

function checkPair() {
  state.busy = true;
  state.moves++;
  $('stat-moves').textContent = state.moves;
  const [a, b] = state.selected;
  const isPair = (a.pairId === b.pairId) && (a.side !== b.side);

  if (isPair) {
    Sound.play('match', 0.85);
    setTimeout(() => {
      [a, b].forEach((c) => { c.matched = true; c.el.classList.remove('sel'); c.el.classList.add('match'); });
      state.matched++;
      $('stat-matched').textContent = state.matched;
      state.selected = [];
      state.busy = false;
      if (state.matched === state.set.pairs.length) winRound();
    }, 220);
  } else {
    Sound.play('wrong', 0.5);
    a.el.classList.add('wrong'); b.el.classList.add('wrong');
    setTimeout(() => {
      [a, b].forEach((c) => {
        c.el.classList.remove('wrong', 'sel');
        if (state.mode === 'memory') flipDown(c);
      });
      state.selected = [];
      state.busy = false;
    }, state.mode === 'memory' ? 1050 : 650);
  }
}

function winRound() {
  Sound.play('win', 0.8);
  // A little reward: stars scale with efficiency (fewer tries = better).
  const perfect = state.set.pairs.length;
  const stars = state.moves <= perfect ? '⭐⭐⭐' : state.moves <= perfect + 2 ? '⭐⭐' : '⭐';
  const ex = $('explain');
  ex.innerHTML = '';
  const head = document.createElement('div');
  head.innerHTML = `<b>🎉 Matched them all!</b> ${stars} &nbsp; (${state.moves} tries)`;
  ex.appendChild(head);
  if (state.set.explain) {
    const p = document.createElement('div');
    p.style.marginTop = '6px';
    p.textContent = state.set.explain;
    ex.appendChild(p);
  }
  ex.style.display = 'block';
  $('next-btn').style.display = 'inline-block';
}

function showSetup() {
  $('setup').style.display = 'block';
  $('game').style.display = 'none';
}
function showGame() {
  $('setup').style.display = 'none';
  $('game').style.display = 'block';
}

// ---------- wire up ----------
document.querySelectorAll('.mode').forEach((m) => m.addEventListener('click', () => setMode(m.dataset.mode)));
// Start is a user gesture, so it's where music can begin (autoplay policy).
$('start-btn').addEventListener('click', () => { showGame(); startRound(); Sound.startMusic(); });
$('next-btn').addEventListener('click', startRound);
$('quit-btn').addEventListener('click', showSetup);
$('sound-btn').addEventListener('click', () => Sound.toggle());

// Keep the rectangle tidy when the window is resized/rotated mid-game.
let _resizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(() => {
    if ($('game').style.display === 'block' && state.cards.length) {
      $('board').style.setProperty('--cols', chooseCols(state.cards.length));
    }
  }, 150);
});

Sound.init();
loadSets();
