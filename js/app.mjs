import { CONFIG, LEVELS, MODELS, STORAGE_PREFIX, THRESHOLDS, VISION_CDN, VISION_LOCAL, WASM_CDN, WASM_LOCAL } from './config.mjs';
import { EXERCISES, EXERCISE_ORDER } from './exercises.mjs';
import { personBox } from './geometry.mjs';
import { createPlayer } from './player.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 儲存 ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback }; } catch { return { ...fallback }; }
  },
  set(key, value) { try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* 私隱模式等 */ } },
};
const settings = store.get('settings', { sound: true, debug: false, model: 'full', camera: '' });
const setup = store.get('setup', { players: 1, ex: 'squat', mode: 'timed', timed: 60, target: 20, level: 'standard', names: ['', ''] });
if (!EXERCISES[setup.ex]) setup.ex = 'squat';
let board = store.get('board', {});

const LIMITS = { timed: [30, 60, 90, 120], target: [10, 20, 30, 50], holdTarget: [30, 60, 90, 120] };
const DEFAULT_NAMES = ['藍方', '橙方'];
const COLORS = ['#35d6ff', '#ff9a3d'];
const SOLO_COLOR = '#b6ff3b';

// ---------- 狀態 ----------
let phase = 'home';           // home | message | ready | countdown | play | ending | result
let stream = null;
let landmarker = null, landmarkerKey = '';
let rafId = 0, lastVideoTime = -1, detectMs = 0;
let simPoses = null;
let players = [];
let game = null;              // { ex, mode, limit, level, names, elapsed, lastTick, paused, ended }
let lastPoses = [];
let wakeLock = null;
let timers = [];
let dark = false;
const ui = [0, 1].map((i) => ({ pp: $(`pp${i}`), meter: $(`meter${i}`), ready: $(`ready${i}`), toast: $(`toast${i}`), toastTimer: 0, sticky: '', lastTip: 0 }));

const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

// ---------- 音效 ----------
let audio = null;
function ensureAudio() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } }
  if (audio && audio.state === 'suspended') audio.resume();
}
function beep(freq = 880, dur = 0.12, delay = 0, type = 'sine', vol = 0.18) {
  if (!settings.sound || !audio) return;
  const t = audio.currentTime + delay;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  rep: (i) => { const f = i ? 740 : 988; beep(f, 0.08); beep(f * 1.335, 0.12, 0.07); },
  tick: () => beep(660, 0.12),
  go: () => beep(1047, 0.35, 0, 'triangle', 0.24),
  end: () => { beep(784, 0.15); beep(988, 0.15, 0.15); beep(1319, 0.4, 0.3); },
  warn: () => beep(300, 0.12, 0, 'square', 0.05),
  ready: () => beep(880, 0.1, 0, 'triangle'),
};

// ---------- 小工具 ----------
const ex = () => EXERCISES[game ? game.ex : setup.ex];
const isHold = (e = ex()) => e.kind === 'hold';
const fmtScore = (v, e = ex()) => (isHold(e) ? (Math.floor(v * 10) / 10).toFixed(1) : String(v));
const fmtClock = (s) => { const m = Math.floor(s / 60), r = Math.floor(s - m * 60); return `${m}:${String(r).padStart(2, '0')}`; };
const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)} 分 ${(s % 60).toFixed(1)} 秒` : `${s.toFixed(1)} 秒`);
const playerName = (i) => (setup.names[i] || '').trim() || (setup.players === 1 ? '玩家' : DEFAULT_NAMES[i]);
const limitOf = (s = setup) => (s.mode === 'timed' ? s.timed : s.mode === 'target' ? s.target : 0);
function modeText(s = setup) {
  const e = EXERCISES[s.ex];
  if (s.mode === 'timed') return `計時賽 ${s.timed} 秒`;
  if (s.mode === 'target') return `目標賽 ${s.target} ${e.unit}`;
  return isHold(e) ? '鬥耐力' : '自由練習';
}
const boardKey = (s = setup) => `${s.ex}|${s.mode}${limitOf(s)}|${s.level}`;
const boardTitle = (s = setup) => `${EXERCISES[s.ex].name}・${modeText(s)}・${LEVELS[s.level]}`;
// 目標賽比用時（少者勝），其餘比成績（多者勝）
const lowerWins = (s = setup) => s.mode === 'target';

// 每個級別的判定標準（由門檻自動生成，改 config.mjs 後會自動更新）
function levelNote(id, level) {
  const t = THRESHOLDS[id][level], pc = (v) => Math.round(v * 100);
  switch (id) {
    case 'squat': return `膝頭屈到約 ${t.knee}° 或以下，髖部下降最少 ${pc(t.hipDrop)}%；彎腰唔屈膝唔計。`;
    case 'pushup': return `手踭屈到 ${t.elbow}° 或以下，膊頭下降最少 ${pc(t.drop)}%，身體直線最少 ${t.line}°；${t.allowKnee ? '可以跪膝做。' : '膝頭唔可以落地。'}`;
    case 'situp': return `上身升到離地 ${t.up}° 或以上，再瞓返到 ${t.down}° 或以下。`;
    case 'jack': return `手臂舉到 ${t.arm}° 或以上，同時兩腿打開 ${t.leg}° 或以上。`;
    case 'knees': return `膝頭升到髖部高度嘅 ${pc(t.lift)}% 或以上。`;
    case 'plank': return `身體直線最少 ${t.line}°，上身要撐離地面。`;
    default: return '';
  }
}

// ---------- 畫面切換 ----------
function show(id) {
  for (const s of ['home', 'message', 'game', 'result']) $(s).classList.toggle('hidden', s !== id);
}
function message(title, html = '', actions = [], spinner = false) {
  phase = 'message';
  show('message');
  $('msgTitle').textContent = title;
  $('msgText').innerHTML = html;
  $('msgSpinner').classList.toggle('hidden', !spinner);
  const box = $('msgActions');
  box.innerHTML = '';
  for (const [label, fn, primary] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.onclick = fn;
    box.append(b);
  }
  box.querySelector('button')?.focus();
}
// 每位玩家自己的提示。ms = 0 代表常駐（sticky），直到 clearSticky
function toast(i, text, kind = '', ms = 1500) {
  const u = ui[i];
  if (!u) return;
  clearTimeout(u.toastTimer);
  if (!ms) u.sticky = text;
  u.toast.textContent = text;
  u.toast.className = `toast lane${i}${kind ? ' ' + kind : ''}`;
  if (ms) u.toastTimer = setTimeout(() => { u.toast.textContent = u.sticky; u.toast.className = `toast lane${i}${u.sticky ? ' warn' : ''}`; }, ms);
}
function clearSticky(i) {
  const u = ui[i];
  if (u.sticky && u.toast.textContent === u.sticky) u.toast.textContent = '';
  u.sticky = '';
}
function banner(text, small = false) {
  const b = $('banner');
  b.textContent = text;
  b.className = (small ? 'small ' : '') + (text ? 'pop' : '');
}

// ---------- 首頁 ----------
function renderHome() {
  $('exGrid').innerHTML = EXERCISE_ORDER.map((id) => {
    const e = EXERCISES[id];
    return `<label><input type="radio" name="ex" value="${id}"${id === setup.ex ? ' checked' : ''}><div class="ex"><span class="icon" aria-hidden="true">${e.icon}</span><b>${e.name}</b><small>${e.view}</small></div></label>`;
  }).join('');
  for (const [name, value] of [['players', setup.players], ['mode', setup.mode], ['level', setup.level]]) {
    const el = document.querySelector(`input[name=${name}][value="${value}"]`);
    if (el) el.checked = true;
  }
  $('name0').value = setup.names[0] || '';
  $('name1').value = setup.names[1] || '';
  refreshHome();
}
function refreshHome() {
  const e = EXERCISES[setup.ex];
  const hold = isHold(e);
  document.querySelector('.name.p1').classList.toggle('hidden', setup.players === 1);
  document.querySelector('.name.p0 span').textContent = setup.players === 1 ? '玩家名（龍虎榜用）' : '左邊玩家';
  $('name0').placeholder = setup.players === 1 ? '玩家' : DEFAULT_NAMES[0];
  $('exInfo').innerHTML = `<div><b>擺位：</b>${e.setup}${setup.players === 2 ? '兩位玩家分別喺畫面左、右兩邊，唔好越過中線。' : ''}</div><div><b>點樣先計：</b>${e.rule}</div><div><b>${LEVELS[setup.level]}級標準：</b>${levelNote(setup.ex, setup.level)}</div>`;
  $('freeLabel').textContent = hold ? '🏔 鬥耐力' : '♾️ 自由練習';
  const opts = setup.mode === 'timed' ? LIMITS.timed : setup.mode === 'target' ? (hold ? LIMITS.holdTarget : LIMITS.target) : [];
  if (setup.mode === 'target' && !opts.includes(setup.target)) setup.target = opts[1];
  const cur = limitOf();
  $('limits').innerHTML = opts.map((v) => `<label><input type="radio" name="limit" value="${v}"${v === cur ? ' checked' : ''}><span>${v} ${setup.mode === 'timed' ? '秒' : e.unit}</span></label>`).join('');
  const two = setup.players === 2;
  $('modeDesc').textContent = setup.mode === 'timed'
    ? (hold ? `${setup.timed} 秒內，正確支撐嘅時間越長越好。` : `${setup.timed} 秒內做得越多越好${two ? '，多者勝' : ''}。`)
    : setup.mode === 'target'
      ? (hold ? `累積支撐夠 ${setup.target} 秒就完成${two ? '，先完成者勝' : ''}。` : `做夠 ${setup.target} 下就完成，鬥快${two ? '，先完成者勝' : ''}。`)
      : (hold ? `一直撐，跌低超過 3 秒就完${two ? '，撐得耐者勝' : ''}。` : '唔限時間，撳「完成」結束。');
  const top = (board[boardKey()] || [])[0];
  $('bestLine').textContent = top ? `🏆 ${boardTitle()} 最高紀錄：${top.name} ${lowerWins() ? fmtSecs(top.score) : `${fmtScore(top.score, e)} ${e.unit}`}` : '';
  store.set('setup', setup);
}
$('home').addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'players') setup.players = Number(t.value);
  else if (t.name === 'ex') setup.ex = t.value;
  else if (t.name === 'mode') setup.mode = t.value;
  else if (t.name === 'level') setup.level = t.value;
  else if (t.name === 'limit') setup[setup.mode] = Number(t.value);
  refreshHome();
});
for (const i of [0, 1]) $(`name${i}`).addEventListener('input', (ev) => { setup.names[i] = ev.target.value.slice(0, 10); store.set('setup', setup); });

function goHome() {
  clearTimers();
  stopLoop();
  stopCamera();
  releaseWakeLock();
  game = null; players = [];
  phase = 'home';
  $('confetti').innerHTML = '';
  refreshHome();
  show('home');
  $('startBtn').focus();
}

// ---------- 龍虎榜 ----------
function addToBoard(name, score) {
  const key = boardKey(game);
  const list = board[key] || [];
  const entry = { name, score: Math.round(score * 10) / 10, date: new Date().toISOString().slice(0, 10) };
  list.push(entry);
  list.sort((a, b) => (lowerWins(game) ? a.score - b.score : b.score - a.score));
  board[key] = list.slice(0, 10);
  store.set('board', board);
  const rank = board[key].indexOf(entry);
  return rank < 0 ? null : rank + 1;
}
function openBoard(s = game || setup) {
  const e = EXERCISES[s.ex];
  const list = board[boardKey(s)] || [];
  $('boardKey').textContent = boardTitle(s);
  $('boardList').innerHTML = list.length
    ? list.map((r, i) => `<li><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span><span>${esc(r.name)}</span><b>${lowerWins(s) ? fmtSecs(r.score) : `${fmtScore(r.score, e)} ${e.unit}`}</b><small>${esc(r.date)}</small></li>`).join('')
    : '<li class="empty">未有紀錄。完成一局就會上榜。</li>';
  $('boardClear').onclick = () => { delete board[boardKey(s)]; store.set('board', board); openBoard(s); refreshHome(); };
  $('boardClearAll').onclick = () => { board = {}; store.set('board', board); openBoard(s); refreshHome(); };
  if (!$('board').open) $('board').showModal();
}

// ---------- 設定 ----------
const dlg = $('settings');
function openSettings() {
  const f = dlg.querySelector('form');
  f.model.value = settings.model;
  f.sound.checked = settings.sound;
  f.debug.checked = settings.debug;
  listCameras();
  dlg.showModal();
}
dlg.addEventListener('close', () => {
  const f = dlg.querySelector('form');
  settings.model = f.model.value || 'full';
  settings.sound = f.sound.checked;
  settings.debug = f.debug.checked;
  if (!$('cameraField').classList.contains('hidden')) settings.camera = f.camera.value;
  store.set('settings', settings);
});
async function listCameras() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    $('cameraField').classList.toggle('hidden', cams.length < 2);
    $('cameraSelect').innerHTML = cams.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || '鏡頭 ' + (i + 1))}</option>`).join('');
    if (settings.camera) $('cameraSelect').value = settings.camera;
  } catch { /* ignore */ }
}

// ---------- 鏡頭 ----------
async function startCamera() {
  stopCamera();
  const base = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  if (settings.camera) base.deviceId = { exact: settings.camera };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  } catch (e) {
    if (e.name === 'OverconstrainedError' && settings.camera) { settings.camera = ''; store.set('settings', settings); return startCamera(); }
    if (e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    else throw e;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  lastVideoTime = -1;
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}
function cameraError(e) {
  console.error(e);
  const retry = ['再試', () => begin(), true];
  const home = ['返回', goHome];
  const n = e?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    message('鏡頭權限被拒絕', '遊戲要用鏡頭先計到數。<br>請撳網址列左邊嘅<strong>鎖頭／鏡頭圖示</strong>，將「鏡頭」改做<strong>允許</strong>，然後撳「再試」。<br>影像只在你部電腦處理，唔會上傳。', [retry, home]);
  } else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') {
    message('搵唔到鏡頭', '請確認電腦有鏡頭並已接好，然後撳「再試」。', [retry, home]);
  } else if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') {
    message('鏡頭被其他程式佔用', '請關閉 Zoom、Teams、相機等正在用鏡頭嘅程式或分頁，然後撳「再試」。', [retry, home]);
  } else {
    message('開唔到鏡頭', `出現問題：${esc((e && (e.message || e.name)) || '未知錯誤')}。請重新整理網頁再試。`, [retry, home]);
  }
}

// ---------- 模型 ----------
// MediaPipe 程式庫會自行向 Google 發送使用統計；一律擋住，確保遊戲唔會連去其他網站
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  return /(^|\/\/)odml\.pa\.googleapis\.com/.test(url) ? Promise.reject(new TypeError('blocked')) : realFetch(input, init);
};

async function loadVision() {
  try { return { mod: await import(new URL(VISION_LOCAL, document.baseURI).href), wasm: new URL(WASM_LOCAL, document.baseURI).href }; } catch (e) {
    console.warn('本地 tasks-vision 載入失敗，改用 CDN', e);
    return { mod: await import(VISION_CDN), wasm: WASM_CDN };
  }
}
async function createLandmarker(numPoses) {
  const key = settings.model;
  if (landmarker && landmarkerKey === key) {
    await landmarker.setOptions({ numPoses });
    return landmarker;
  }
  if (landmarker) { try { landmarker.close(); } catch { /* ignore */ } landmarker = null; }
  const { mod, wasm } = await loadVision();
  const fileset = { wasmLoaderPath: `${wasm}/vision_wasm_internal.js`, wasmBinaryPath: `${wasm}/vision_wasm_internal.wasm` };
  const opts = (model, delegate) => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numPoses,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  const m = MODELS[key] || MODELS.full;
  const delegates = params.has('cpu') ? ['CPU'] : ['GPU', 'CPU'];
  const attempts = [new URL(m.local, document.baseURI).href, m.cdn].flatMap((u) => delegates.map((d) => [u, d]));
  let lastErr;
  for (const [model, delegate] of attempts) {
    try {
      landmarker = await mod.PoseLandmarker.createFromOptions(fileset, opts(model, delegate));
      landmarkerKey = key;
      console.info('PoseLandmarker ready:', model, delegate);
      return landmarker;
    } catch (e) { lastErr = e; console.warn('PoseLandmarker 失敗', model, delegate, e); }
  }
  throw lastErr;
}

// ---------- 開始流程 ----------
async function begin() {
  ensureAudio();
  if (!SIM) {
    if (!window.isSecureContext) {
      message('要用 HTTPS 先開到鏡頭', '瀏覽器只容許 HTTPS 網址或本機 localhost 使用鏡頭。<br>請用 https:// 網址開啟，或喺本機用 <code>npm start</code> 再開 http://127.0.0.1:4190/', [['返回', goHome, true]]);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      message('呢個瀏覽器唔支援鏡頭', '請改用最新版 Chrome 或 Edge。', [['返回', goHome, true]]);
      return;
    }
    message('準備緊……', '請允許瀏覽器使用鏡頭。第一次載入姿勢模型需時約 10–30 秒。', [['返回', goHome]], true);
    // 單人時多偵測兩個人，雙人時多偵測兩個人，用嚟分辨旁觀者
    const modelP = createLandmarker(setup.players === 2 ? 4 : 3);
    modelP.catch(() => {});
    try { if (!stream) await startCamera(); } catch (e) { cameraError(e); return; }
    if (phase !== 'message') return;
    try { await modelP; } catch (e) {
      console.error(e);
      message('載入失敗，請檢查網絡', '姿勢模型載入唔到。請檢查網絡，然後撳「重試」。', [['重試', () => begin(), true], ['返回', goHome]]);
      return;
    }
    if (phase !== 'message') return;
  }
  newGame();
  startLoop();
}

function newGame() {
  const two = setup.players === 2;
  game = { ex: setup.ex, mode: setup.mode, timed: setup.timed, target: setup.target, level: setup.level, players: setup.players, names: [playerName(0), playerName(1)], limit: limitOf(), elapsed: 0, paused: false, ended: false };
  // 畫面經鏡像：左邊玩家 = 未鏡像座標的右半
  players = two
    ? [createPlayer({ exercise: game.ex, level: game.level, zone: [0.5, 1.0001] }), createPlayer({ exercise: game.ex, level: game.level, zone: [0, 0.5] })]
    : [createPlayer({ exercise: game.ex, level: game.level, zone: [0, 1.0001] })];
  document.body.classList.toggle('solo', !two);
  const e = ex();
  $('exName').textContent = `${e.icon} ${e.name}・${modeText(game)}・${LEVELS[game.level]}`;
  players.forEach((_, i) => {
    const u = ui[i];
    u.pp.querySelector('.pname').textContent = game.names[i];
    u.pp.querySelector('.punit').textContent = e.unit;
    u.meter.classList.toggle('hidden', isHold(e));
  });
  restartReady();
}

function restartReady() {
  clearTimers();
  phase = 'ready';
  show('game');
  game.elapsed = 0; game.paused = false; game.ended = false;
  players.forEach((p, i) => {
    p.resetAll();
    const u = ui[i];
    u.sticky = ''; u.toast.textContent = '';
    u.ready.classList.remove('hidden', 'done');
    u.pp.classList.remove('lead');
    u.readyBeeped = false;
  });
  banner('');
  $('pausedLayer').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  $('finishBtn').classList.add('hidden');
  $('gameHint').textContent = `預備：${ex().readyText}，保持 ${CONFIG.readySeconds} 秒。追蹤錯人可以撳畫面上嘅人。`;
  $('timerLabel').textContent = '預備';
  $('lead').textContent = '';
  updateHud();
}

function startCountdown() {
  phase = 'countdown';
  players.forEach((_, i) => { ui[i].ready.classList.add('hidden'); toast(i, '', '', 1); });
  $('gameHint').textContent = '預備……';
  let n = 3;
  const step = () => {
    if (phase !== 'countdown') return;
    if (n > 0) { banner(String(n)); sfx.tick(); n--; later(step, 1000); }
    else { banner('開始！', true); sfx.go(); later(() => { if (phase === 'play') banner(''); }, 800); startPlay(); }
  };
  step();
}

function startPlay() {
  phase = 'play';
  players.forEach((p) => { p.counter.reset(); p.outSince = null; });
  Object.assign(game, { elapsed: 0, lastTick: performance.now() / 1000, paused: false, ended: false });
  $('pauseBtn').classList.remove('hidden');
  $('finishBtn').classList.toggle('hidden', game.mode !== 'free');
  $('gameHint').textContent = ex().rule;
  updateHud();
  requestWakeLock();
}

function setPaused(p) {
  if (!game || phase !== 'play' || p === game.paused) return;
  game.paused = p;
  game.lastTick = performance.now() / 1000;
  $('pausedLayer').classList.toggle('hidden', !p);
  $('pauseBtn').innerHTML = p ? '▶ 繼續 <small>(空白鍵)</small>' : '⏸ 暫停 <small>(空白鍵)</small>';
  if (!p) players.forEach((pl, i) => { pl.counter.interrupt(); if (!isHold()) toast(i, '由起始姿勢重新開始', 'warn'); });
}

function endGame(reason = '') {
  if (!game || game.ended) return;
  game.ended = true;
  phase = 'ending';
  releaseWakeLock();
  sfx.end();
  banner(reason || '完！', true);
  $('pauseBtn').classList.add('hidden');
  $('finishBtn').classList.add('hidden');
  later(showResult, 1300);
}

function showResult() {
  phase = 'result';
  stopLoop();
  const e = ex();
  const scores = players.map((p) => p.score);
  const reached = (i) => game.mode !== 'target' || scores[i] >= game.limit;
  let winner = -1;
  if (players.length === 2) {
    if (scores[0] !== scores[1]) winner = scores[0] > scores[1] ? 0 : 1;
  }
  $('resultMode').textContent = `${e.icon} ${boardTitle(game)}`;
  $('resultTitle').textContent = players.length === 1
    ? (game.mode === 'target' && reached(0) ? `完成！用時 ${fmtSecs(game.elapsed)}` : '完成！')
    : (winner < 0 ? '🤝 平手！' : `🏆 ${game.names[winner]} 勝出！`);
  const cards = players.map((p, i) => {
    const total = p.counter.attempts;
    const rate = !isHold(e) && total ? `有效率 ${Math.round((p.counter.reps / total) * 100)}%（${p.counter.reps}／${total}）` : isHold(e) ? `最長連續 ${p.counter.best.toFixed(1)} 秒` : '';
    // 上榜：計時／自由比成績；目標賽只記完成者的用時
    let rank = null;
    if (scores[i] > 0 && reached(i)) rank = addToBoard(game.names[i], lowerWins(game) ? game.elapsed : scores[i]);
    const tag = rank === 1 ? '🏆 新紀錄！' : rank ? `龍虎榜第 ${rank} 位` : '';
    return `<div class="rp ${players.length === 1 ? 'solo' : 'p' + i}${i === winner ? ' win' : ''}">
      <div class="n">${i === winner ? '👑 ' : ''}${esc(game.names[i])}</div>
      <div class="s">${fmtScore(scores[i], e)}<small>${e.unit}</small></div>
      <div class="d">${rate}</div>
      ${tag ? `<div class="tag">${tag}</div>` : ''}
    </div>`;
  });
  $('resultPlayers').innerHTML = cards.join('');
  $('resultNote').textContent = game.mode === 'target' ? `目標 ${game.limit} ${e.unit}・全場用時 ${fmtSecs(game.elapsed)}` : `全場用時 ${fmtSecs(game.elapsed)}`;
  show('result');
  confetti(winner >= 0 || players.length === 1);
  $('againBtn').focus();
}
function confetti(on) {
  const box = $('confetti');
  box.innerHTML = '';
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['#35d6ff', '#ff9a3d', '#b6ff3b', '#ffffff', '#ff5d8f'];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement('i');
    el.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-duration:${1.6 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.8}s`;
    box.append(el);
  }
  later(() => { box.innerHTML = ''; }, 4500);
}

// ---------- 主迴圈 ----------
function startLoop() {
  cancelAnimationFrame(rafId);
  const tick = () => { rafId = requestAnimationFrame(tick); try { frame(); } catch (e) { console.error(e); } };
  rafId = requestAnimationFrame(tick);
}
function stopLoop() { cancelAnimationFrame(rafId); rafId = 0; }

function getPoses(now) {
  if (SIM) return { poses: (simPoses || []).map((lm) => ({ lm, world: null })), aspect: 1, fresh: true };
  if (!landmarker || video.readyState < 2) return { poses: [], aspect: 1, fresh: false };
  const aspect = video.videoWidth / video.videoHeight || 16 / 9;
  if (video.currentTime === lastVideoTime) return { poses: lastPoses, aspect, fresh: false };
  lastVideoTime = video.currentTime;
  const t0 = performance.now();
  const res = landmarker.detectForVideo(video, now);
  detectMs = detectMs * 0.9 + (performance.now() - t0) * 0.1;
  return { poses: res.landmarks.map((lm, i) => ({ lm, world: res.worldLandmarks?.[i] ?? null })), aspect, fresh: true };
}

function frame() {
  if (!['ready', 'countdown', 'play', 'ending'].includes(phase)) return;
  const now = performance.now();
  const t = now / 1000;
  if (phase === 'play' && !game.paused) {
    game.elapsed += Math.min(0.5, t - game.lastTick);
    game.lastTick = t;
    if (game.mode === 'timed' && game.elapsed >= game.limit) { game.elapsed = game.limit; updateHud(); endGame('時間到！'); return; }
  }
  const r = getPoses(now);
  if (!r.fresh) { updateHud(); return; }
  lastPoses = r.poses;
  const mode = phase === 'ready' ? 'ready' : phase === 'play' && !game.paused ? 'play' : 'idle';
  const taken = [];
  const results = players.map((p) => {
    const res = p.update(r.poses, t, r.aspect, mode, taken);
    if (res.index >= 0) taken.push(res.index);
    return res;
  });
  draw(r.poses, results);
  if (phase === 'ready') readyFrame(results, t);
  else if (phase === 'play' && !game.paused) playFrame(results, t);
  updateHud();
}

const LOST_MSG = '鎖定嘅人走咗：返回原位，或撳畫面上嘅人重新鎖定';
function readyFrame(results, t) {
  const e = ex();
  players.forEach((p, i) => {
    const u = ui[i], res = results[i];
    const prog = p.readyProgress;
    u.ready.querySelector('.ring').style.setProperty('--p', prog.toFixed(3));
    u.ready.querySelector('b').textContent = p.isReady ? '✓' : e.icon;
    u.ready.classList.toggle('done', p.isReady);
    let text;
    if (p.isReady) text = players.length > 1 && !players.every((x) => x.isReady) ? '準備好！等埋對手' : '準備好！';
    else if (res.lost) text = LOST_MSG;
    else if (!res.m) text = dark ? '睇唔到你，光線可能不足' : (players.length > 1 ? `請企入${i ? '右' : '左'}邊範圍` : '請企入鏡頭範圍');
    else if (!res.m.ok) text = res.m.hint;
    else if (res.m.ready) text = '好！保持唔好郁';
    else text = res.m.hint || e.readyText;
    u.ready.querySelector('p').textContent = `${e.readyText}｜${text}`;
    if (p.isReady && !u.readyBeeped) { u.readyBeeped = true; sfx.ready(); }
    if (!p.isReady) u.readyBeeped = false;
  });
  if (!SIM && detectMs > 110 && settings.model === 'full') $('gameHint').textContent = `部電腦運算較慢（每幀 ${detectMs.toFixed(0)} 毫秒），計數可能跟唔切：可以返回首頁，喺「設定」改用「高速」模型。`;
  if (players.every((p) => p.isReady)) startCountdown();
  void t;
}

function playFrame(results, t) {
  const e = ex();
  const hold = isHold(e);
  players.forEach((p, i) => {
    const u = ui[i], res = results[i];
    if (!hold && res.m?.ok) setMeter(i, Math.max(...res.m.ch.map((c) => c.p)));
    for (const ev of res.events) {
      if (ev.type === 'rep') { sfx.rep(i); bump(i); toast(i, '好！', 'ok', 500); }
      else if (ev.type === 'shallow') { sfx.warn(); toast(i, `唔計：${e.shallow}`, 'warn'); }
      else if (ev.type === 'fault') { sfx.warn(); toast(i, `唔計：${ev.msg}`, 'warn', 2200); }
      else if (ev.type === 'tooFast') toast(i, '太快喇，做足全程先計', 'warn');
      else if (ev.type === 'lost') toast(i, res.lost ? LOST_MSG : (res.m && !res.m.ok ? res.m.hint : (dark ? '睇唔到你，光線可能不足' : '睇唔到你，請返回畫面')), 'warn', 0);
      else if (ev.type === 'back') { clearSticky(i); toast(i, hold ? '返嚟喇！' : '返嚟喇！由起始姿勢開始', 'ok'); }
      else if (ev.type === 'holdStart') { clearSticky(i); toast(i, '計時中，撐住！', 'ok', 1200); }
      else if (ev.type === 'holdBreak') { sfx.warn(); toast(i, ev.msg || '姿勢唔啱，停止計時', 'warn', 0); }
    }
    if (res.lost && u.sticky !== LOST_MSG) toast(i, LOST_MSG, 'warn', 0);
    else if (!res.lost && u.sticky === LOST_MSG) clearSticky(i);
    // 追蹤緊但未返到起始姿勢（例如行開咗位置再返嚟）
    if (p.counter.lost && res.m && !res.m.ok && u.sticky !== res.m.hint && !res.lost) toast(i, res.m.hint, 'warn', 0);
    if (res.m?.ok && res.m.tip && !u.sticky && t - u.lastTip > 2.5 && !u.toast.textContent) { u.lastTip = t; toast(i, res.m.tip, 'warn', 1400); }
    if (hold) {
      u.holding = p.counter.holding;
      if (p.counter.holding) p.outSince = null;
      else if (p.counter.seconds > 1 && p.outSince == null) p.outSince = t;
      if (p.counter.seconds <= 1) p.outSince = null;
    }
  });
  // 完結條件
  if (game.mode === 'target' && players.some((p) => p.score >= game.limit)) { updateHud(); endGame(players.length > 1 ? '完成！' : '達標！'); return; }
  if (hold && game.mode === 'free' && players.every((p) => p.outSince != null && t - p.outSince > 3)) endGame('完！');
}

function setMeter(i, score) {
  const m = ui[i].meter;
  const s = Math.max(0, Math.min(1.3, score));
  m.querySelector('.fill').style.height = `${(s / 1.3) * 100}%`;
  m.classList.toggle('hit', score >= 1);
  m.setAttribute('aria-valuenow', String(Math.round(Math.min(score, 1) * 100)));
}
function bump(i) {
  const el = ui[i].pp.querySelector('.pcount');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
function updateHud() {
  if (!game) return;
  const e = ex();
  const scores = players.map((p) => p.score);
  players.forEach((p, i) => {
    const u = ui[i];
    u.pp.querySelector('.pcount').textContent = fmtScore(scores[i], e);
    const bar = u.pp.querySelector('.pbar');
    bar.classList.toggle('hidden', game.mode !== 'target');
    if (game.mode === 'target') bar.firstElementChild.style.width = `${Math.min(100, (scores[i] / game.limit) * 100)}%`;
    let st = '';
    if (phase === 'play') {
      if (game.mode === 'target') st = `目標 ${game.limit} ${e.unit}`;
      if (isHold(e)) st = p.counter.holding ? '● 計時中' : '○ 未計時';
    }
    u.pp.querySelector('.pstatus').textContent = st;
    if (players.length === 2) u.pp.classList.toggle('lead', phase !== 'ready' && scores[i] > scores[1 - i]);
  });
  const timer = $('timer');
  if (phase === 'ready' || phase === 'countdown') {
    timer.textContent = game.mode === 'timed' ? String(game.limit) : '0:00';
    timer.classList.remove('urgent');
    $('timerLabel').textContent = phase === 'ready' ? '預備中' : '準備開始';
  } else if (game.mode === 'timed') {
    const left = Math.max(0, game.limit - game.elapsed);
    const shown = Math.ceil(left);
    if (phase === 'play' && shown <= 5 && shown > 0 && shown !== game.lastShown) sfx.tick();
    game.lastShown = shown;
    timer.textContent = String(shown);
    timer.classList.toggle('urgent', left <= 10);
    $('timerLabel').textContent = '剩餘秒數';
  } else {
    timer.textContent = fmtClock(game.elapsed);
    timer.classList.remove('urgent');
    $('timerLabel').textContent = '用時';
  }
  if (players.length === 2 && phase !== 'ready') {
    const d = scores[0] - scores[1];
    const lead = $('lead');
    if (Math.abs(d) < (isHold(e) ? 0.3 : 1)) { lead.textContent = '勢均力敵'; lead.style.color = ''; }
    else { const w = d > 0 ? 0 : 1; lead.textContent = `${game.names[w]} 領先 ${fmtScore(Math.abs(d), e)} ${e.unit}`; lead.style.color = COLORS[w]; }
  }
}

// 撳畫面上的人：該範圍的玩家改為鎖定佢
$('overlay').addEventListener('click', (ev) => {
  if (!['ready', 'countdown', 'play'].includes(phase) || !lastPoses.length) return;
  const g = stageGeom();
  const x = (g.rect.right - ev.clientX - g.ox) / g.w;   // 畫面經 CSS 鏡像
  const y = (ev.clientY - g.rect.top - g.oy) / g.h;
  const t = performance.now() / 1000;
  players.forEach((p, i) => {
    if (p.tracker.selectAt(x, y, lastPoses, t)) {
      p.switched();
      clearSticky(i);
      toast(i, '已鎖定呢個人', 'ok');
    }
  });
});

// ---------- 繪圖 ----------
function stageGeom() {
  const rect = canvas.getBoundingClientRect();
  const va = SIM ? rect.width / rect.height : (video.videoWidth / video.videoHeight) || 16 / 9;
  let w = rect.width, h = rect.width / va;
  if (h > rect.height) { h = rect.height; w = h * va; }
  return { rect, va, w, h, ox: (rect.width - w) / 2, oy: (rect.height - h) / 2 };
}
const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
function label(text, xRight, yTop, bg, fg, size = 18) {
  // 畫布經 CSS 鏡像，文字要反轉；xRight = 未鏡像畫布座標中框的右邊（即畫面上的左邊）
  ctx.save();
  ctx.scale(-1, 1);
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width + 16, th = size + 12;
  const lx = -xRight, ly = Math.max(0, yTop - th - 4);
  ctx.fillStyle = bg;
  ctx.fillRect(lx, ly, tw, th);
  ctx.fillStyle = fg;
  ctx.fillText(text, lx + 8, ly + th - 8);
  ctx.restore();
}
function draw(poses, results) {
  const g = stageGeom();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(g.rect.width * dpr) || canvas.height !== Math.round(g.rect.height * dpr)) {
    canvas.width = Math.round(g.rect.width * dpr); canvas.height = Math.round(g.rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, g.rect.width, g.rect.height);
  const P = (p) => [g.ox + p.x * g.w, g.oy + p.y * g.h];
  const pad = 0.02;
  const boxRect = (b) => [g.ox + (b.x0 - pad) * g.w, g.oy + (b.y0 - pad * 2) * g.h, (b.w + pad * 2) * g.w, (b.h + pad * 4) * g.h];
  const anyLost = results.some((r) => r.lost);
  // 未被追蹤的人：白色虛線框
  poses.forEach((p, idx) => {
    if (results.some((r) => r.index === idx)) return;
    const [x, y, w, h] = boxRect(personBox(p.lm));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.stroke();
    ctx.restore();
    label(anyLost ? '撳一下鎖定佢' : '旁觀（唔計）', x + w, y, 'rgba(0,0,0,.65)', 'rgba(255,255,255,.9)', 14);
  });
  // 追蹤中的玩家：顏色框＋骨架
  results.forEach((r, i) => {
    if (!r.lm) return;
    const col = players.length === 1 ? SOLO_COLOR : COLORS[i];
    const good = r.m?.ok;
    const [x, y, w, h] = boxRect(personBox(r.lm));
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = col; ctx.globalAlpha = 0.9;
    for (const [a, b] of BONES) {
      if ((r.lm[a].visibility ?? 1) < 0.3 || (r.lm[b].visibility ?? 1) < 0.3) continue;
      ctx.beginPath(); ctx.moveTo(...P(r.lm[a])); ctx.lineTo(...P(r.lm[b])); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const j of JOINTS) { if ((r.lm[j].visibility ?? 1) < 0.3) continue; const [jx, jy] = P(r.lm[j]); ctx.beginPath(); ctx.arc(jx, jy, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = good ? col : '#ffb547';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.stroke();
    ctx.restore();
    label(`✓ ${game.names[i]}`, x + w, y, good ? col : '#ffb547', '#0b0f14');
    if (settings.debug && r.m?.dbg) {
      const lines = [...Object.entries(r.m.dbg).map(([k, v]) => `${k} ${v.toFixed(0)}`), `狀態 ${players[i].counter.state}`, `偵測 ${detectMs.toFixed(0)}ms`];
      ctx.save(); ctx.scale(-1, 1); ctx.font = '700 16px system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      lines.forEach((l, k) => { const lx = -(x + w), ly = y + h + 20 + k * 20; ctx.strokeText(l, lx, ly); ctx.fillText(l, lx, ly); });
      ctx.restore();
    }
  });
}

// ---------- 光線 ----------
const probe = document.createElement('canvas');
probe.width = 32; probe.height = 18;
setInterval(() => {
  if (SIM || !stream || video.readyState < 2 || !['ready', 'play'].includes(phase)) return;
  try {
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(video, 0, 0, 32, 18);
    const d = p.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    dark = sum / (d.length / 4) < 45;
  } catch { /* ignore */ }
}, 1000);

// ---------- 螢幕常亮 ----------
async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; } }
function releaseWakeLock() { try { wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }

// ---------- 事件 ----------
$('startBtn').onclick = begin;
$('settingsBtn').onclick = openSettings;
$('boardBtn').onclick = () => openBoard(setup);
$('resultBoardBtn').onclick = () => openBoard(game);
$('homeBtn').onclick = goHome;
$('resultHomeBtn').onclick = goHome;
$('redoBtn').onclick = () => { if (game) restartReady(); };
const toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
$('fsBtn').onclick = toggleFullscreen;
$('pauseBtn').onclick = () => setPaused(!game?.paused);
$('finishBtn').onclick = () => endGame('完成！');
$('againBtn').onclick = () => {
  ensureAudio();
  $('confetti').innerHTML = '';
  if (!SIM && !stream) { begin(); return; }
  restartReady();
  startLoop();
};
document.addEventListener('keydown', (e) => {
  if (dlg.open || $('board').open) return;
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape' && phase !== 'home') { e.preventDefault(); goHome(); }
  else if (typing) return;
  else if ((e.code === 'Space' || e.key === ' ') && phase === 'play') { e.preventDefault(); setPaused(!game.paused); }
  else if (e.key === 'Enter' && phase === 'play' && game.mode === 'free' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); endGame('完成！'); }
  else if ((e.key === 'r' || e.key === 'R') && ['ready', 'countdown', 'play'].includes(phase)) { e.preventDefault(); restartReady(); }
  else if ((e.key === 'f' || e.key === 'F') && phase !== 'home') { e.preventDefault(); toggleFullscreen(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (phase === 'play') setPaused(true); }
  else if (phase === 'play' && wakeLock === null) requestWakeLock();
});
window.addEventListener('pagehide', stopCamera);

// ---------- 測試介面（只在 ?sim 時開放） ----------
if (SIM) {
  window.__sport = {
    inject(poses) { simPoses = poses; },
    get phase() { return phase; },
    get scores() { return players.map((p) => p.score); },
    get attempts() { return players.map((p) => p.counter.attempts); },
    get states() { return players.map((p) => p.counter.state); },
    get ready() { return players.map((p) => p.isReady); },
    get tracked() { return players.map((p) => p.last.index); },
    get lost() { return players.map((p) => p.tracker.lost); },
    get elapsed() { return game?.elapsed ?? 0; },
    get board() { return board; },
  };
}

renderHome();
