// ============================================================
// Globe Quiz — a 3D Earth (Babylon.js, reusing lib/babylon.js) you spin & zoom;
// the game names a place (Hong Kong, Japan, New York…) and you tap where it is.
// Scored by great-circle distance to the real spot. Solo or hotseat multiplayer.
//
// The globe texture is baked from the public-domain Natural Earth world map
// (assets/geo/world.json). The sphere's UVs are recomputed from vertex positions
// via vecToLonLat, so a tap on the surface maps to exactly the lon/lat shown — no
// dependence on Babylon's internal UV convention.
// Test hooks live on window.GLOBE.
// ============================================================

const $ = (id) => document.getElementById(id);
const GLOBE = { opts: { players: 1, rounds: 5, diff: 'medium', clue: 'name' }, state: null, ready: false };
window.GLOBE = GLOBE;

// ---------- sound (reuses the kart game's Pixabay SFX + music) ----------
const Sound = {
  on: true, pools: {}, idx: {}, music: null, tracks: [],
  KEYS: { pin: 'click', good: 'coin', great: 'win', meh: 'hit', next: 'pickup' },
  init() {
    try { this.on = localStorage.getItem('pm-sound') !== '0'; } catch { /* */ }
    for (const key of new Set(Object.values(this.KEYS))) { const pool = []; for (let i = 0; i < 3; i++) { const a = new Audio(`assets/audio/sfx/${key}.mp3`); a.preload = 'auto'; pool.push(a); } this.pools[key] = pool; this.idx[key] = 0; }
    fetch('assets/audio/music/tracks.json').then((r) => r.json()).then((l) => { this.tracks = l || []; }).catch(() => {});
    this.updateBtn();
  },
  play(name, vol = 1) { if (!this.on) return; const key = this.KEYS[name]; const pool = this.pools[key]; if (!pool) return; this.idx[key] = (this.idx[key] + 1) % pool.length; const a = pool[this.idx[key]]; try { a.currentTime = 0; a.volume = vol; a.play().catch(() => {}); } catch { /* */ } },
  startMusic() { if (!this.on || !this.tracks.length) return; if (!this.music) { const t = this.tracks[Math.floor(Math.random() * this.tracks.length)]; this.music = new Audio(`assets/audio/music/${t.file}`); this.music.loop = true; this.music.volume = 0.16; } this.music.play().catch(() => {}); },
  stopMusic() { if (this.music) { try { this.music.pause(); } catch { /* */ } } },
  toggle() { this.on = !this.on; try { localStorage.setItem('pm-sound', this.on ? '1' : '0'); } catch { /* */ } if (this.on) this.startMusic(); else this.stopMusic(); this.updateBtn(); },
  updateBtn() { const b = $('sound-btn'); if (b) { b.textContent = this.on ? '🔊' : '🔈'; b.classList.toggle('off', !this.on); } },
};

// ---------- geo math ----------
const DEG = Math.PI / 180, R = 2;
function lonLatToVec(lon, lat, radius = R) {
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  // -z winding so east appears to the right when viewed from outside (Babylon is left-handed)
  return new BABYLON.Vector3(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), -radius * Math.sin(phi) * Math.sin(theta));
}
function vecToLonLat(v) {
  const n = v.length() ? v.scale(1 / v.length()) : v;
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, n.y))) / DEG;
  let lon = Math.atan2(-n.z, -n.x) / DEG - 180;
  while (lon < -180) lon += 360; while (lon > 180) lon -= 360;
  return { lon, lat };
}
function haversine(a, b) { // km between {lon,lat}
  const r = 6371, dLat = (b.lat - a.lat) * DEG, dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}
function scoreFor(distKm) { return Math.round(1000 * Math.exp(-distKm / 1400)); }
function ratingFor(d) { return d < 150 ? '🎯 Bullseye!' : d < 600 ? '🌟 Great!' : d < 1500 ? '👍 Good' : d < 4000 ? '😅 Close-ish' : '🌍 Way off'; }

// ---------- places (lon, lat, tier 1=easy 2=med 3=hard) ----------
const PLACES = [
  { name: 'New York', lat: 40.71, lon: -74.01, tier: 1 }, { name: 'London', lat: 51.51, lon: -0.13, tier: 1 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, tier: 1 }, { name: 'Paris', lat: 48.86, lon: 2.35, tier: 1 },
  { name: 'Sydney', lat: -33.87, lon: 151.21, tier: 1 }, { name: 'Beijing', lat: 39.9, lon: 116.4, tier: 1 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, tier: 1 }, { name: 'Cairo', lat: 30.04, lon: 31.24, tier: 1 },
  { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17, tier: 1 }, { name: 'Moscow', lat: 55.76, lon: 37.62, tier: 1 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17, tier: 2 }, { name: 'Dubai', lat: 25.2, lon: 55.27, tier: 2 },
  { name: 'Singapore', lat: 1.35, lon: 103.82, tier: 2 }, { name: 'Mumbai', lat: 19.08, lon: 72.88, tier: 2 },
  { name: 'Cape Town', lat: -33.92, lon: 18.42, tier: 2 }, { name: 'Toronto', lat: 43.65, lon: -79.38, tier: 2 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, tier: 2 }, { name: 'Berlin', lat: 52.52, lon: 13.4, tier: 2 },
  { name: 'Rome', lat: 41.9, lon: 12.5, tier: 2 }, { name: 'Istanbul', lat: 41.01, lon: 28.98, tier: 2 },
  { name: 'Bangkok', lat: 13.76, lon: 100.5, tier: 2 }, { name: 'Buenos Aires', lat: -34.6, lon: -58.38, tier: 2 },
  { name: 'Seoul', lat: 37.57, lon: 126.98, tier: 2 }, { name: 'Athens', lat: 37.98, lon: 23.73, tier: 2 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82, tier: 3 }, { name: 'Reykjavik', lat: 64.15, lon: -21.94, tier: 3 },
  { name: 'Honolulu', lat: 21.31, lon: -157.86, tier: 3 }, { name: 'Jakarta', lat: -6.21, lon: 106.85, tier: 3 },
  { name: 'Lima', lat: -12.05, lon: -77.04, tier: 3 }, { name: 'Vancouver', lat: 49.28, lon: -123.12, tier: 3 },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, tier: 3 }, { name: 'Wellington', lat: -41.29, lon: 174.78, tier: 3 },
  { name: 'Anchorage', lat: 61.22, lon: -149.9, tier: 3 }, { name: 'Casablanca', lat: 33.57, lon: -7.59, tier: 3 },
];
// Countries for FLAG mode (name matches the world map for "inside the country"
// scoring; lon/lat = capital, for the camera + a distance fallback). cc = flag file.
const COUNTRIES = [
  { name: 'United States of America', cc: 'us', lat: 38.9, lon: -77.0, tier: 1 }, { name: 'United Kingdom', cc: 'gb', lat: 51.5, lon: -0.13, tier: 1 },
  { name: 'Japan', cc: 'jp', lat: 35.68, lon: 139.69, tier: 1 }, { name: 'France', cc: 'fr', lat: 48.86, lon: 2.35, tier: 1 },
  { name: 'Australia', cc: 'au', lat: -35.28, lon: 149.13, tier: 1 }, { name: 'China', cc: 'cn', lat: 39.9, lon: 116.4, tier: 1 },
  { name: 'Brazil', cc: 'br', lat: -15.79, lon: -47.88, tier: 1 }, { name: 'Canada', cc: 'ca', lat: 45.42, lon: -75.7, tier: 1 },
  { name: 'India', cc: 'in', lat: 28.61, lon: 77.21, tier: 1 }, { name: 'Germany', cc: 'de', lat: 52.52, lon: 13.4, tier: 1 },
  { name: 'Italy', cc: 'it', lat: 41.9, lon: 12.5, tier: 2 }, { name: 'Russia', cc: 'ru', lat: 55.76, lon: 37.62, tier: 2 },
  { name: 'Egypt', cc: 'eg', lat: 30.04, lon: 31.24, tier: 2 }, { name: 'South Africa', cc: 'za', lat: -25.74, lon: 28.19, tier: 2 },
  { name: 'Mexico', cc: 'mx', lat: 19.43, lon: -99.13, tier: 2 }, { name: 'Spain', cc: 'es', lat: 40.42, lon: -3.7, tier: 2 },
  { name: 'Turkey', cc: 'tr', lat: 39.93, lon: 32.86, tier: 2 }, { name: 'Argentina', cc: 'ar', lat: -34.6, lon: -58.38, tier: 2 },
  { name: 'South Korea', cc: 'kr', lat: 37.57, lon: 126.98, tier: 2 }, { name: 'Greece', cc: 'gr', lat: 37.98, lon: 23.73, tier: 2 },
  { name: 'Thailand', cc: 'th', lat: 13.76, lon: 100.5, tier: 2 }, { name: 'Saudi Arabia', cc: 'sa', lat: 24.71, lon: 46.68, tier: 2 },
  { name: 'Sweden', cc: 'se', lat: 59.33, lon: 18.07, tier: 2 }, { name: 'Portugal', cc: 'pt', lat: 38.72, lon: -9.13, tier: 2 },
  { name: 'Indonesia', cc: 'id', lat: -6.21, lon: 106.85, tier: 3 }, { name: 'Kenya', cc: 'ke', lat: -1.29, lon: 36.82, tier: 3 },
  { name: 'Nigeria', cc: 'ng', lat: 9.07, lon: 7.49, tier: 3 }, { name: 'Peru', cc: 'pe', lat: -12.05, lon: -77.04, tier: 3 },
  { name: 'Norway', cc: 'no', lat: 59.91, lon: 10.75, tier: 3 }, { name: 'Iceland', cc: 'is', lat: 64.15, lon: -21.94, tier: 3 },
  { name: 'New Zealand', cc: 'nz', lat: -41.29, lon: 174.78, tier: 3 }, { name: 'Vietnam', cc: 'vn', lat: 21.03, lon: 105.85, tier: 3 },
];
// point-in-polygon (even-odd) against the world map, so a tap anywhere inside the
// right country counts as a bullseye in flag mode.
function pointInRings(lon, lat, rings) { let inside = false; for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
function featureContains(f, lon, lat) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const poly of polys) if (pointInRings(lon, lat, poly)) return true; return false; }
function pointInCountry(lon, lat, name) { const f = GLOBE.geoByName && GLOBE.geoByName[name]; return f ? featureContains(f, lon, lat) : false; }
// which country the tap actually landed in (or null = open sea) — for clear feedback
function countryAt(lon, lat) { for (const f of (GLOBE.geo ? GLOBE.geo.features : [])) { const n = f.properties && f.properties.name; if (n && featureContains(f, lon, lat)) return n; } return null; }
const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];

// ---------- Babylon scene + globe ----------
let engine, scene, camera, sphere;
const markers = [];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }
// land colour shifts from lush green at the equator to pale tundra near the poles,
// with a small deterministic per-country jitter so neighbours are distinguishable.
function landColor(latC, h) {
  const a = Math.min(1, Math.abs(latC) / 78), j = (h - 0.5);
  const r = Math.round(86 + a * 70 + j * 16), g = Math.round(158 - a * 30 + j * 14), b = Math.round(74 + a * 58 + j * 10);
  const cl = (v) => Math.max(0, Math.min(255, v));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}
async function buildEarthTexture() {
  const geo = await fetch('assets/geo/world.json').then((r) => r.json());
  GLOBE.geo = geo;
  GLOBE.geoByName = {}; for (const f of geo.features) GLOBE.geoByName[f.properties.name] = f;
  const W = 4096, H = 2048;
  const dt = new BABYLON.DynamicTexture('earth', { width: W, height: H }, scene, true), ctx = dt.getContext();
  // deep-ocean gradient (darker at the poles)
  const og = ctx.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0, '#0c2742'); og.addColorStop(0.2, '#143f6b'); og.addColorStop(0.5, '#1d5d96'); og.addColorStop(0.8, '#143f6b'); og.addColorStop(1, '#0c2742');
  ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
  // very faint graticule
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1.2;
  for (let lon = -150; lon <= 150; lon += 30) { const x = (lon + 180) / 360 * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = (90 - lat) / 180 * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const proj = (lon, lat) => [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
  const centLat = (f) => { let s = 0, n = 0; const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const poly of polys) for (const pt of poly[0]) { s += pt[1]; n++; } return n ? s / n : 0; };
  const path = (c, f) => { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; c.beginPath(); for (const poly of polys) for (const ring of poly) { ring.forEach((pt, i) => { const [x, y] = proj(pt[0], pt[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); } };

  ctx.lineJoin = 'round';
  for (const f of geo.features) {
    const name = f.properties.name, latC = centLat(f);
    const icy = name === 'Antarctica' || name === 'Greenland';
    ctx.fillStyle = icy ? '#e8eef3' : landColor(latC, hashStr(name));
    ctx.strokeStyle = 'rgba(20,45,32,0.4)'; ctx.lineWidth = 1.5;
    // soft shallow-water glow around coastlines for depth
    ctx.save(); ctx.shadowColor = 'rgba(95,175,225,0.5)'; ctx.shadowBlur = W / 560;
    path(ctx, f); ctx.fill('evenodd'); ctx.restore();
    path(ctx, f); ctx.stroke(); // crisp coastline
  }
  dt.update();
  return dt;
}

async function createScene() {
  const canvas = $('globe-canvas');
  // adaptToDeviceRatio (last arg) → crisp on retina; we still must resize() once the
  // game screen is shown, since the canvas is display:none (0×0) at creation time.
  engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.04, 0.07, 0.18, 1);

  camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, 1.25, 6, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 3.0; camera.upperRadiusLimit = 11; camera.minZ = 0.05;
  camera.wheelPrecision = 24; camera.pinchPrecision = 60; camera.panningSensibility = 0; // no pan
  camera.inertia = 0.7;

  const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.5; hemi.diffuse = new BABYLON.Color3(0.92, 0.96, 1); hemi.groundColor = new BABYLON.Color3(0.2, 0.26, 0.36);
  // a "sun" headlight kept on the side we're looking at (no dark side for a quiz) —
  // gives soft shading + an ocean glint; updated each frame to follow the camera.
  const sun = new BABYLON.DirectionalLight('s', new BABYLON.Vector3(0, 0, -1), scene);
  sun.intensity = 1.1; sun.specular = BABYLON.Color3.Black(); // soft shading only, no highlight
  scene.onBeforeRenderObservable.add(() => { const c = scene.activeCamera; if (c) sun.direction = c.target.subtract(c.position).add(new BABYLON.Vector3(0.4, 0.55, 0)).normalize(); });

  sphere = BABYLON.MeshBuilder.CreateSphere('earth', { diameter: R * 2, segments: 96 }, scene);
  // recompute UVs from positions so a tap maps to the lon/lat actually shown
  const pos = sphere.getVerticesData(BABYLON.VertexBuffer.PositionKind), uv = [];
  for (let i = 0; i < pos.length; i += 3) {
    const ll = vecToLonLat(new BABYLON.Vector3(pos[i], pos[i + 1], pos[i + 2]));
    uv.push((ll.lon + 180) / 360, (90 - ll.lat) / 180);
  }
  sphere.setVerticesData(BABYLON.VertexBuffer.UVKind, uv);

  const tex = await buildEarthTexture();
  const mat = new BABYLON.StandardMaterial('earthMat', scene);
  tex.vScale = -1; tex.vOffset = 1; tex.anisotropicFilteringLevel = 8; // Babylon samples V bottom-up
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex; mat.emissiveColor = new BABYLON.Color3(0.34, 0.36, 0.4); // keep the far side readable
  mat.specularColor = BABYLON.Color3.Black(); // matte — no glint / "light inside the globe"
  sphere.material = mat;

  // atmosphere halo: a slightly larger sphere with INSIDE faces + ADDITIVE blend.
  // Behind the globe it's depth-occluded, so it only shows as a soft glow ring just
  // beyond the silhouette — never covering the map.
  const atmo = BABYLON.MeshBuilder.CreateSphere('atmo', { diameter: R * 2.28, segments: 48 }, scene);
  atmo.flipFaces(true); atmo.isPickable = false;
  const am = new BABYLON.StandardMaterial('am', scene);
  am.disableLighting = true; am.diffuseColor = BABYLON.Color3.Black(); am.specularColor = BABYLON.Color3.Black();
  am.emissiveColor = new BABYLON.Color3(0.28, 0.55, 1);
  am.alpha = 0.55; am.alphaMode = BABYLON.Engine.ALPHA_ADD;
  atmo.material = am;

  // starfield: a big inside-out sphere with baked random stars, so spinning the
  // globe feels like space instead of a flat navy void
  {
    const SW = 2048, SH = 1024;
    const stex = new BABYLON.DynamicTexture('stars', { width: SW, height: SH }, scene, true);
    const c = stex.getContext();
    c.fillStyle = '#070d1f'; c.fillRect(0, 0, SW, SH);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * SW, y = Math.random() * SH;
      const r = Math.random() < 0.88 ? (0.5 + Math.random() * 0.9) : (1.3 + Math.random() * 1.3);
      const warm = Math.random() < 0.14;
      c.fillStyle = warm ? `rgba(255,225,180,${0.5 + Math.random() * 0.5})` : `rgba(${200 + (Math.random() * 55 | 0)},${210 + (Math.random() * 45 | 0)},255,${0.4 + Math.random() * 0.6})`;
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    stex.update();
    const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 80, segments: 24 }, scene);
    sky.flipFaces(true); sky.isPickable = false;
    const sm = new BABYLON.StandardMaterial('skyM', scene);
    sm.emissiveTexture = stex; sm.disableLighting = true;
    sm.diffuseColor = BABYLON.Color3.Black(); sm.specularColor = BABYLON.Color3.Black();
    sky.material = sm; sky.freezeWorldMatrix();
  }

  // tap (not drag) to drop a pin
  scene.onPointerObservable.add((pi) => {
    if (pi.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => m === sphere);
    if (hit && hit.hit && hit.pickedPoint) onPick(vecToLonLat(hit.pickedPoint));
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  GLOBE.ready = true;
  GLOBE.scene = scene; GLOBE.camera = camera; GLOBE.sphere = sphere; GLOBE.placeMarker = placeMarker; GLOBE.face = faceLonLat; GLOBE.clearMarkers = clearMarkers;
  const sb = $('start-btn'); sb.disabled = false; sb.textContent = 'Start Quiz ▶';
}

function placeMarker(lon, lat, color, big) {
  const m = BABYLON.MeshBuilder.CreateSphere('pin', { diameter: big ? 0.16 : 0.11, segments: 10 }, scene);
  m.position = lonLatToVec(lon, lat, R * 1.012);
  const mm = new BABYLON.StandardMaterial('pm', scene);
  mm.emissiveColor = BABYLON.Color3.FromHexString(color); mm.diffuseColor = mm.emissiveColor; mm.specularColor = BABYLON.Color3.Black();
  m.material = mm; m.isPickable = false; markers.push(m);
  return m;
}
// A floating, camera-facing label at a location — used at reveal to clearly point
// out the correct answer ON the globe (name, + flag in flag mode).
function placeLabel(lon, lat, text) {
  const W = 680, H = 168, dt = new BABYLON.DynamicTexture('lbl', { width: W, height: H }, scene, true);
  dt.hasAlpha = true; const c = dt.getContext(); c.clearRect(0, 0, W, H);
  let fs = 66; c.font = `bold ${fs}px 'Segoe UI', system-ui, Arial`;
  while (c.measureText(text).width > W - 70 && fs > 22) { fs -= 4; c.font = `bold ${fs}px 'Segoe UI', system-ui, Arial`; }
  const bw = Math.min(W - 8, c.measureText(text).width + 64), bx = (W - bw) / 2, by = 34, bh = H - 68, r = 28;
  c.fillStyle = 'rgba(16,24,46,0.92)'; c.strokeStyle = '#ffd93b'; c.lineWidth = 6;
  c.beginPath(); c.moveTo(bx + r, by); c.arcTo(bx + bw, by, bx + bw, by + bh, r); c.arcTo(bx + bw, by + bh, bx, by + bh, r); c.arcTo(bx, by + bh, bx, by, r); c.arcTo(bx, by, bx + bw, by, r); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#ffe57a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, W / 2, H / 2);
  dt.update();
  const plane = BABYLON.MeshBuilder.CreatePlane('answerLabel', { width: 2.1, height: 2.1 * H / W }, scene);
  const m = new BABYLON.StandardMaterial('lblm', scene);
  m.diffuseTexture = dt; m.opacityTexture = dt; m.emissiveColor = BABYLON.Color3.White(); m.disableLighting = true; m.backFaceCulling = false; m.specularColor = BABYLON.Color3.Black();
  plane.material = m; plane.position = lonLatToVec(lon, lat, R * 1.24); plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; plane.isPickable = false; plane.renderingGroupId = 1;
  markers.push(plane); return plane;
}
function clearMarkers() { while (markers.length) markers.pop().dispose(false, true); }
function resetCamera() { if (camera) { camera.alpha = -Math.PI / 2; camera.beta = 1.25; camera.radius = 6; } }
// orbit the camera so (lon,lat) faces the viewer (ArcRotate dir = (cosα·sinβ, cosβ, sinα·sinβ))
function faceLonLat(lon, lat) { if (!camera) return; const d = lonLatToVec(lon, lat).normalize(); camera.alpha = Math.atan2(d.z, d.x); camera.beta = Math.acos(Math.max(-1, Math.min(1, d.y))); camera.radius = 5.2; }

// ---------- game flow ----------
function pickPlaces(n) {
  const maxTier = GLOBE.opts.diff === 'easy' ? 1 : GLOBE.opts.diff === 'medium' ? 2 : 3;
  const src = GLOBE.opts.clue === 'flag' ? COUNTRIES : PLACES; // flag mode finds whole countries
  const pool = shuffle(src.filter((p) => p.tier <= maxTier));
  const out = []; for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  return out;
}
// score a guess. FLAG mode is a country-identification task → binary: inside the
// correct country = full marks, any other country (or the sea) = wrong, 0 points
// (so a close-but-wrong country never reads as "correct"). NAME mode (find the
// city) keeps distance-based scoring.
function scoreGuess(guess, target) {
  if (GLOBE.opts.clue === 'flag') {
    if (pointInCountry(guess.lon, guess.lat, target.name)) return { dist: 0, pts: 1000, inside: true, clicked: target.name };
    return { dist: Math.round(haversine(guess, target)), pts: 0, inside: false, clicked: countryAt(guess.lon, guess.lat) };
  }
  const dist = Math.round(haversine(guess, target));
  return { dist, pts: scoreFor(dist), inside: false };
}
function setPrompt(target) {
  const flag = $('place-flag');
  if (GLOBE.opts.clue === 'flag') { flag.src = `assets/flags/${target.cc}.png`; flag.style.display = 'inline-block'; $('place-name').textContent = 'this country'; }
  else { flag.style.display = 'none'; $('place-name').textContent = target.name; }
}
function startGame() {
  GLOBE.online = false;
  const o = GLOBE.opts;
  GLOBE.state = { places: pickPlaces(o.rounds), round: 0, turn: 0, players: o.players, scores: new Array(o.players).fill(0), roundPicks: [], pending: null, phase: 'guess' };
  $('setup').style.display = 'none'; $('game').style.display = 'block';
  // the canvas was hidden (0×0) at engine creation — now it's visible, match the
  // render buffer to its real size so it's sharp AND taps map to the right spot.
  if (engine) { engine.resize(); requestAnimationFrame(() => engine.resize()); }
  Sound.startMusic();
  beginRound();
}
function beginRound() {
  const st = GLOBE.state; st.turn = 0; st.roundPicks = [];
  beginTurn();
}
function beginTurn() {
  const st = GLOBE.state; st.phase = 'guess'; st.pending = null;
  clearMarkers(); resetCamera();
  hideOverlays();
  const place = st.places[st.round];
  setPrompt(place);
  $('turn-who').textContent = st.players > 1 ? `Round ${st.round + 1}/${st.places.length} · Player ${st.turn + 1}` : `Round ${st.round + 1}/${st.places.length}`;
  $('scoreline').textContent = '';
  $('lock-btn').disabled = true;
  // hand the device over between players (not before the very first turn)
  if (st.players > 1) { showHandoff(st.turn + 1); }
}
function showHandoff(playerNum) {
  $('handoff-title').textContent = `Player ${playerNum}'s turn`;
  $('handoff-title').style.color = COLORS[playerNum - 1];
  $('handoff').classList.add('show');
}
function onPick(ll) {
  if (GLOBE.online) { netPick(ll); return; }
  const st = GLOBE.state; if (!st || st.phase !== 'guess') return;
  if ($('handoff').classList.contains('show')) return; // still on the handoff screen
  st.pending = ll;
  clearMarkers();
  placeMarker(ll.lon, ll.lat, COLORS[st.turn], false);
  $('lock-btn').disabled = false;
  $('scoreline').textContent = '📍 Pin dropped — adjust it or Lock In';
  Sound.play('pin', 0.6);
}
function lockIn() {
  if (GLOBE.online) { netLock(); return; }
  const st = GLOBE.state; if (!st || st.phase !== 'guess' || !st.pending) return;
  const place = st.places[st.round];
  const { dist, pts, inside, clicked } = scoreGuess(st.pending, place);
  st.scores[st.turn] += pts;
  st.roundPicks[st.turn] = { lon: st.pending.lon, lat: st.pending.lat, dist, pts, inside, clicked };
  st.pending = null; $('lock-btn').disabled = true;
  if (st.turn < st.players - 1) { st.turn++; beginTurn(); }
  else revealRound();
}
function revealRound() {
  const st = GLOBE.state; st.phase = 'reveal';
  const place = st.places[st.round];
  clearMarkers();
  st.roundPicks.forEach((p, i) => { if (p) placeMarker(p.lon, p.lat, COLORS[i], false); });
  placeMarker(place.lon, place.lat, '#ffd93b', true); // correct spot
  placeLabel(place.lon, place.lat, place.name);        // ...with its name, on the globe
  faceLonLat(place.lon, place.lat); // point the camera at the correct place
  const flagMode = GLOBE.opts.clue === 'flag';
  const best = Math.max(...st.roundPicks.map((p) => (p ? p.pts : -1)));
  const flagImg = flagMode ? `<img src="assets/flags/${place.cc}.png" style="height:26px;vertical-align:middle;border-radius:3px;margin-right:6px;box-shadow:0 1px 3px rgba(0,0,0,.4)">` : '';
  const solo = st.players === 1 ? st.roundPicks[0] : null;
  $('reveal-title').innerHTML = (solo && flagMode)
    ? (solo.inside ? `${flagImg}✅ Correct — ${place.name}!` : `${flagImg}❌ It was ${place.name}`)
    : `${flagImg}📍 It was ${place.name}`;
  const rows = $('reveal-rows'); rows.innerHTML = '';
  st.roundPicks.forEach((p, i) => {
    if (!p) return;
    const row = document.createElement('div'); row.className = 'rev-row' + (p.pts === best && p.pts > 0 ? ' best' : '');
    const detail = flagMode ? (p.inside ? '✅ correct!' : `❌ tapped ${p.clicked || 'the sea'}`) : `${p.dist.toLocaleString()} km`;
    row.innerHTML = `<span class="dot" style="background:${COLORS[i]}"></span><span class="nm">${st.players > 1 ? 'Player ' + (i + 1) : 'You'} — ${detail}</span><span class="pts">+${p.pts}</span>`;
    rows.appendChild(row);
  });
  if (solo) {
    Sound.play(solo.inside ? 'great' : (flagMode ? 'meh' : (solo.pts >= 700 ? 'great' : solo.pts >= 350 ? 'good' : 'meh')), 0.8);
    $('scoreline').textContent = flagMode
      ? (solo.inside ? `🎯 Correct — that's ${place.name}!` : `❌ That's ${solo.clicked || 'the open sea'} — the correct answer is ${place.name}`)
      : (solo.dist < 150 ? `🎯 Spot on — that's ${place.name}!` : `📍 The answer is ${place.name} — your pin was ${solo.dist.toLocaleString()} km away`);
  } else Sound.play('great', 0.7);
  $('reveal-next').textContent = st.round < st.places.length - 1 ? 'Next Round ▶' : 'See Results 🏆';
  $('reveal').classList.add('show');
}
function nextRound() {
  const st = GLOBE.state; st.round++;
  if (st.round < st.places.length) beginRound(); else showResults();
}
function showResults() {
  const st = GLOBE.state; st.phase = 'done'; hideOverlays();
  const order = st.scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s);
  const rows = $('results-rows'); rows.innerHTML = '';
  order.forEach((e, rank) => {
    const row = document.createElement('div'); row.className = 'lead-row' + (rank === 0 ? ' lead' : '');
    row.innerHTML = `<span class="pos">${rank + 1}</span><span class="nm" style="color:${COLORS[e.i]}">${st.players > 1 ? 'Player ' + (e.i + 1) : 'You'}</span><span class="pts">${e.s.toLocaleString()} pts</span>`;
    rows.appendChild(row);
  });
  $('results-title').textContent = st.players > 1 ? `🏆 Player ${order[0].i + 1} wins!` : `Final score: ${st.scores[0].toLocaleString()}`;
  Sound.play('great', 0.85);
  $('results').classList.add('show');
}
function hideOverlays() { ['handoff', 'reveal', 'results'].forEach((id) => $(id).classList.remove('show')); }

// ---------- UI wiring ----------
function setOpt(group, attr, val) { document.querySelectorAll(`#${group} .opt`).forEach((o) => o.classList.toggle('on', o.dataset[attr] === String(val))); }
$('opt-players').addEventListener('click', (e) => {
  const o = e.target.closest('.opt'); if (!o) return; const v = o.dataset.players;
  setOpt('opt-players', 'players', v);
  const online = v === 'online';
  GLOBE.opts.online = online; if (!online) GLOBE.opts.players = +v;
  $('online-setup').style.display = online ? 'block' : 'none';
  $('start-btn').style.display = online ? 'none' : '';
});
$('opt-rounds').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; GLOBE.opts.rounds = +o.dataset.rounds; setOpt('opt-rounds', 'rounds', o.dataset.rounds); });
$('opt-diff').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; GLOBE.opts.diff = o.dataset.diff; setOpt('opt-diff', 'diff', o.dataset.diff); });
$('opt-clue').addEventListener('click', (e) => { const o = e.target.closest('.opt'); if (!o) return; GLOBE.opts.clue = o.dataset.clue; setOpt('opt-clue', 'clue', o.dataset.clue); });
$('start-btn').addEventListener('click', () => { if (GLOBE.ready) startGame(); });
$('lock-btn').addEventListener('click', lockIn);
$('reveal-next').addEventListener('click', nextRound);
$('handoff-start').addEventListener('click', () => { $('handoff').classList.remove('show'); });
$('results-again').addEventListener('click', () => { startGame(); });
$('results-menu').addEventListener('click', () => { $('game').style.display = 'none'; $('setup').style.display = 'block'; });
$('quit-btn').addEventListener('click', () => { $('game').style.display = 'none'; $('setup').style.display = 'block'; });
$('sound-btn').addEventListener('click', () => Sound.toggle());

// ============================================================
// ONLINE multiplayer — join a room, then race to tap the right place fastest.
// The server runs the rounds, times each guess, and scores accuracy × speed.
// ============================================================
const clientId = 'g_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let socket = null;
const net = { roomId: null, pid: null, host: null, isHost: false, clue: 'name', phase: 'lobby', pending: false, answered: false, players: [], colorByPid: {}, timer: null };
GLOBE.net = net;

function connectSocket() {
  if (socket) return socket;
  socket = (typeof io === 'function') ? io() : null;
  if (!socket) { $('online-error').textContent = 'Online play needs the game server (start.sh).'; return null; }
  socket.on('globe-players', (d) => { net.players = d.players; net.host = d.host; net.isHost = (d.host === net.pid); d.players.forEach((p, i) => { if (net.colorByPid[p.id] == null) net.colorByPid[p.id] = Object.keys(net.colorByPid).length % COLORS.length; }); renderLobby(); });
  socket.on('globe-go', (d) => { net.clue = d.clue; GLOBE.opts.clue = d.clue; startOnlineGame(); });
  socket.on('globe-question', (q) => onNetQuestion(q));
  socket.on('globe-answered', (d) => { if (net.phase === 'guess' || net.phase === 'waiting') $('net-status').textContent = `🌐 ${d.count}/${d.total} answered` + (net.answered ? ' — waiting…' : ''); });
  socket.on('globe-round-result', (d) => onNetResult(d));
  socket.on('globe-final', (d) => onNetFinal(d));
  return socket;
}
function renderLobby() {
  const box = $('lobby-players'); if (!box) return; box.innerHTML = '';
  net.players.forEach((p) => {
    const row = document.createElement('div'); row.className = 'lead-row'; row.style.background = '#f4f8ff'; row.style.color = '#2c3653';
    row.innerHTML = `<span class="dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${COLORS[net.colorByPid[p.id] || 0]}"></span><span class="nm" style="flex:1;text-align:left;margin-left:8px">${escapeHtml(p.name)}${p.host ? ' 👑' : ''}</span>`;
    box.appendChild(row);
  });
  $('online-start').style.display = net.isHost ? 'inline-block' : 'none';
  $('online-wait').style.display = net.isHost ? 'none' : 'block';
  $('online-wait').textContent = net.players.length < 2 ? 'Waiting for friends to join…' : 'Waiting for the host to start…';
}
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function showLobby() { $('setup').style.display = 'none'; $('online-lobby').style.display = 'block'; $('lobby-code').textContent = net.roomId; renderLobby(); }

function onlineCreate() {
  if (!connectSocket()) return;
  const name = ($('online-name').value || 'Host').trim().slice(0, 14);
  socket.emit('globe-create', { name, clientId }, (r) => { if (!r || r.error) { $('online-error').textContent = (r && r.error) || 'Could not create'; return; } net.roomId = r.roomId; net.pid = r.playerId; net.isHost = true; showLobby(); });
}
function onlineJoin() {
  if (!connectSocket()) return;
  const code = ($('online-code').value || '').trim().toUpperCase();
  if (!code) { $('online-error').textContent = 'Enter a room code'; return; }
  const name = ($('online-name').value || 'Player').trim().slice(0, 14);
  socket.emit('globe-join', { roomId: code, name, clientId }, (r) => { if (!r || r.error) { $('online-error').textContent = (r && r.error) || 'Could not join'; return; } net.roomId = r.roomId; net.pid = r.playerId; net.host = r.host; net.isHost = (r.host === r.playerId); net.players = r.players || []; showLobby(); });
}
function onlineStart() {
  if (!net.isHost) return;
  const targets = pickPlaces(GLOBE.opts.rounds).map((t) => ({ name: t.name, lat: t.lat, lon: t.lon, cc: t.cc || null }));
  socket.emit('globe-start', { targets, clue: GLOBE.opts.clue });
}
function startOnlineGame() {
  GLOBE.online = true;
  $('online-lobby').style.display = 'none'; $('setup').style.display = 'none'; $('game').style.display = 'block';
  if (engine) { engine.resize(); requestAnimationFrame(() => engine.resize()); }
  hideOverlays(); $('handoff').classList.remove('show');
  Sound.startMusic();
}
function onNetQuestion(q) {
  net.q = q; net.phase = 'guess'; net.pending = null; net.answered = false;
  clearMarkers(); resetCamera(); hideOverlays();
  const flag = $('place-flag');
  if (q.clue === 'flag') { flag.src = `assets/flags/${q.cc}.png`; flag.style.display = 'inline-block'; $('place-name').textContent = 'this country'; }
  else { flag.style.display = 'none'; $('place-name').textContent = q.name; }
  $('turn-who').textContent = `Question ${q.index + 1} of ${q.total} · tap fast!`;
  $('scoreline').textContent = '';
  $('lock-btn').disabled = true; $('lock-btn').textContent = 'Lock In My Guess ✓';
  net.deadline = performance.now() + (q.windowMs || 15000);
  if (net.timer) clearInterval(net.timer);
  net.timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((net.deadline - performance.now()) / 1000));
    if (!net.answered) $('net-status').textContent = `⏱ ${left}s`;
    if (left <= 0) { clearInterval(net.timer); net.timer = null; if (!net.answered) { net.phase = 'waiting'; $('lock-btn').disabled = true; $('net-status').textContent = "⏱ Time's up!"; } }
  }, 200);
}
function netPick(ll) {
  if (net.phase !== 'guess' || net.answered) return;
  net.pending = ll; clearMarkers();
  placeMarker(ll.lon, ll.lat, COLORS[net.colorByPid[net.pid] || 0], false);
  $('lock-btn').disabled = false; $('scoreline').textContent = '📍 Lock In to send your guess!'; Sound.play('pin', 0.6);
}
function netLock() {
  if (!net.pending || net.answered) return;
  socket.emit('globe-guess', { lon: net.pending.lon, lat: net.pending.lat });
  net.answered = true; net.phase = 'waiting'; $('lock-btn').disabled = true;
  $('scoreline').textContent = '✅ Locked in! Waiting for the others…';
}
function onNetResult(d) {
  net.phase = 'reveal'; if (net.timer) { clearInterval(net.timer); net.timer = null; }
  $('net-status').textContent = '';
  clearMarkers();
  d.results.forEach((r) => { if (r.lon != null) placeMarker(r.lon, r.lat, COLORS[net.colorByPid[r.pid] || 0], false); });
  placeMarker(d.target.lon, d.target.lat, '#ffd93b', true);
  placeLabel(d.target.lon, d.target.lat, d.target.name); // show the correct answer on the globe
  faceLonLat(d.target.lon, d.target.lat);
  const flagImg = net.clue === 'flag' && d.target.cc ? `<img src="assets/flags/${d.target.cc}.png" style="height:24px;vertical-align:middle;border-radius:3px;margin-right:6px">` : '';
  $('reveal-title').innerHTML = `${flagImg}📍 ${escapeHtml(d.target.name)}`;
  const best = Math.max(...d.results.map((r) => r.pts));
  const rows = $('reveal-rows'); rows.innerHTML = '';
  d.results.slice().sort((a, b) => b.pts - a.pts).forEach((r) => {
    const detail = r.lon == null ? '—'
      : net.clue === 'flag' ? (r.inside ? '✅ correct!' : `❌ tapped ${r.clicked || 'the sea'}`)
        : `${r.dist.toLocaleString()} km${r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)}s` : ''}`;
    const row = document.createElement('div'); row.className = 'rev-row' + (r.pts === best && r.pts > 0 ? ' best' : '');
    row.innerHTML = `<span class="dot" style="background:${COLORS[net.colorByPid[r.pid] || 0]}"></span><span class="nm">${escapeHtml(r.name)}${r.pid === net.pid ? ' (you)' : ''} — ${detail}</span><span class="pts">+${r.pts}</span>`;
    rows.appendChild(row);
  });
  $('reveal-next').style.display = 'none';
  const mine = d.results.find((r) => r.pid === net.pid);
  const gotIt = mine && (net.clue === 'flag' ? mine.inside : (mine.dist != null && mine.dist < 600));
  $('scoreline').textContent = gotIt ? `🎯 ${d.target.name}! · next soon…` : `📍 The answer is ${d.target.name} · next soon…`;
  $('reveal').classList.add('show');
  Sound.play(mine && mine.pts >= 600 ? 'great' : 'meh', 0.7);
}
function onNetFinal(d) {
  net.phase = 'done'; hideOverlays();
  const rows = $('results-rows'); rows.innerHTML = '';
  d.standings.forEach((s, rank) => {
    const row = document.createElement('div'); row.className = 'lead-row' + (rank === 0 ? ' lead' : '');
    row.innerHTML = `<span class="pos">${rank + 1}</span><span class="nm" style="color:${COLORS[net.colorByPid[s.id] || 0]}">${escapeHtml(s.name)}${s.id === net.pid ? ' (you)' : ''}</span><span class="pts">${s.score.toLocaleString()} pts</span>`;
    rows.appendChild(row);
  });
  const win = d.standings[0];
  $('results-title').textContent = win ? `🏆 ${win.id === net.pid ? 'You win!' : escapeHtml(win.name) + ' wins!'}` : 'Game over';
  $('results-again').style.display = 'none';
  $('reveal-next').style.display = '';
  Sound.play('great', 0.85);
  $('results').classList.add('show');
}
function leaveOnline() { if (socket) { try { socket.disconnect(); } catch { /* */ } socket = null; } GLOBE.online = false; net.roomId = null; net.players = []; net.colorByPid = {}; if (net.timer) { clearInterval(net.timer); net.timer = null; } $('online-lobby').style.display = 'none'; $('game').style.display = 'none'; hideOverlays(); $('setup').style.display = 'block'; }

$('online-create').addEventListener('click', onlineCreate);
$('online-join').addEventListener('click', onlineJoin);
$('online-start').addEventListener('click', onlineStart);
$('online-leave').addEventListener('click', leaveOnline);

// expose for tests
GLOBE.lonLatToVec = lonLatToVec; GLOBE.vecToLonLat = vecToLonLat; GLOBE.haversine = haversine; GLOBE.scoreFor = scoreFor;
GLOBE.PLACES = PLACES; GLOBE.COUNTRIES = COUNTRIES; GLOBE.pointInCountry = pointInCountry; GLOBE.countryAt = countryAt; GLOBE.scoreGuess = scoreGuess; GLOBE.start = startGame; GLOBE.pick = onPick; GLOBE.lock = lockIn; GLOBE.next = nextRound;
GLOBE.netCreate = onlineCreate; GLOBE.netJoin = onlineJoin; GLOBE.netStart = onlineStart;

Sound.init();
createScene();
