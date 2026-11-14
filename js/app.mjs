import {
  CONFIG, DIFFICULTIES, STORAGE_PREFIX, MODEL_LOCAL, MODEL_CDN, VISION_LOCAL, VISION_CDN, WASM_LOCAL, WASM_CDN,
} from './config.mjs';
import {
  checkFraming, createCounter, createSmoother, createTracker, makeBaseline, measure, rawMeasure,
} from './squat-logic.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');

// ---------- 儲存 ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback }; } catch { return { ...fallback }; }
  },
  set(key, value) { try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* 私隱模式等 */ } },
  remove(key) { try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* ignore */ } },
};
const settings = store.get('settings', { difficulty: 'standard', sound: true, skeleton: false, camera: '' });
let records = store.get('records', {});

// ---------- 狀態 ----------
let phase = 'home';
let stream = null;
let landmarker = null;
let rafId = 0;
let lastVideoTime = -1;
let simPoses = null;
let lastPose = null;
const smoother = createSmoother();
const counter = createCounter();
const tracker = createTracker();
let lastPoses = null;
let lastPeople = [];
let calib = { samples: [], since: 0 };
let baseline = null;
let game = null;
let toastTimer = 0;
let toastLock = '';
let lastLeanToast = 0;
let lastSeenPose = 0;
let dark = false;
let wakeLock = null;
let countdownTimer = 0;
let detectMs = 0;

const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

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
  rep: () => { beep(988, 0.09); beep(1319, 0.14, 0.08); },
  tick: () => beep(660, 0.12),
  go: () => beep(1047, 0.3, 0, 'triangle', 0.22),
  end: () => { beep(784, 0.15); beep(988, 0.15, 0.15); beep(1319, 0.35, 0.3); },
  warn: () => beep(330, 0.12, 0, 'square', 0.06),
};

// ---------- 畫面切換 ----------
function show(id) {
  for (const s of ['home', 'message', 'game', 'result']) $(s).classList.toggle('hidden', s !== id);
}
function message(title, text = '', actions = [], spinner = false) {
  phase = 'message';
  show('message');
  $('msgTitle').textContent = title;
  $('msgText').innerHTML = text;
  $('msgSpinner').classList.toggle('hidden', !spinner);
  const box = $('msgActions');
  box.innerHTML = '';
  for (const [label, fn, primary] of actions) {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.onclick = fn;
    box.append(b);
  }
  box.querySelector('button')?.focus();
}
function toast(text, kind = '', ms = 0, lock = '') {
  if (toastLock && lock !== toastLock && !ms) return;
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  if (ms) {
    toastTimer = setTimeout(() => { if (el.textContent === text) { el.textContent = ''; } }, ms);
  }
}

// ---------- 首頁 ----------
const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${r.toFixed(1)} 秒`;
};
const recordKey = (mode, target) => (mode === 'target' ? `target${target}` : mode);
function recordText(key) {
  const v = records[key];
  if (key.startsWith('target')) return v ? fmtTime(v) : '–';
  return v ? `${v} 下` : '–';
}
function renderRecords() {
  const items = [['free', '自由模式'], ['timed', '60 秒挑戰'], ['target10', '目標 10 下'], ['target20', '目標 20 下'], ['target30', '目標 30 下']];
  $('records').innerHTML = items.map(([k, l]) => `<div><small>${l}</small><b>${recordText(k)}</b></div>`).join('');
}
function selectedMode() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  const target = Number(document.querySelector('input[name=target]:checked').value);
  return { mode, target };
}
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
  $('targets').classList.toggle('hidden', selectedMode().mode !== 'target');
}));

function goHome() {
  clearTimeout(countdownTimer);
  stopLoop();
  stopCamera();
  releaseWakeLock();
  game = null;
  phase = 'home';
  renderRecords();
  show('home');
  $('startBtn').focus();
}

// ---------- 設定 ----------
const dlg = $('settings');
function openSettings() {
  const f = dlg.querySelector('form');
  f.difficulty.value = settings.difficulty;
  f.sound.checked = settings.sound;
  f.skeleton.checked = settings.skeleton;
  if (game) game.pausedBySettings = !game.paused && phase === 'play' && setPaused(true);
  dlg.showModal();
}
dlg.addEventListener('close', async () => {
  const f = dlg.querySelector('form');
  const prevCam = settings.camera;
  settings.difficulty = f.difficulty.value || 'standard';
  settings.sound = f.sound.checked;
  settings.skeleton = f.skeleton.checked;
  if (!$('cameraField').classList.contains('hidden')) settings.camera = f.camera.value;
  store.set('settings', settings);
  if (stream && settings.camera !== prevCam) { await startCamera().catch(cameraError); if (phase !== 'message') restartSetup(); }
  if (game?.pausedBySettings) { game.pausedBySettings = false; setPaused(false); }
});
async function listCameras() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('cameraField').classList.toggle('hidden', cams.length < 2);
    const cur = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    $('cameraSelect').innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || '鏡頭 ' + (i + 1)}</option>`).join('');
    $('cameraSelect').value = settings.camera || cur || '';
  } catch { /* ignore */ }
}

// ---------- 鏡頭 ----------
async function startCamera() {
  stopCamera();
  const base = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  if (settings.camera) base.deviceId = { exact: settings.camera };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  } catch (e) {
    if (e.name === 'OverconstrainedError' && settings.camera) {
      settings.camera = '';
      store.set('settings', settings);
      return startCamera();
    }
    if (e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    else throw e;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  lastVideoTime = -1;
  listCameras();
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}
function cameraError(e) {
  console.error(e);
  const retry = ['再試', () => begin(), true];
  const home = ['返回首頁', goHome];
  const n = e?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    message('鏡頭權限被拒絕', '遊戲要用鏡頭先數到深蹲。<br>請撳網址列左邊嘅<strong>鎖頭／鏡頭圖示</strong>，將「鏡頭」改做<strong>允許</strong>，然後撳「再試」。<br>影像只在你部電腦處理，唔會上傳。', [retry, home]);
  } else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') {
    message('搵唔到鏡頭', '請確認電腦有鏡頭並已接好，然後撳「再試」。', [retry, home]);
  } else if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') {
    message('鏡頭被其他程式佔用', '請關閉 Zoom、Teams、相機等正在用鏡頭嘅程式或分頁，然後撳「再試」。', [retry, home]);
  } else {
    message('開唔到鏡頭', `出現問題：${(e && (e.message || e.name)) || '未知錯誤'}。請重新整理網頁再試。`, [retry, home]);
  }
}

// ---------- 模型 ----------
async function loadVision() {
  try { return { mod: await import(new URL(VISION_LOCAL, document.baseURI).href), wasm: WASM_LOCAL }; } catch (e) {
    console.warn('本地 tasks-vision 載入失敗，改用 CDN', e);
    return { mod: await import(VISION_CDN), wasm: WASM_CDN };
  }
}
async function createLandmarker() {
  if (landmarker) return landmarker;
  const { mod, wasm } = await loadVision();
  const fileset = { wasmLoaderPath: `${wasm}/vision_wasm_internal.js`, wasmBinaryPath: `${wasm}/vision_wasm_internal.wasm` };
  const opts = (model, delegate) => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numPoses: CONFIG.maxPoses,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  const delegates = params.has('cpu') ? ['CPU'] : ['GPU', 'CPU'];
  const attempts = [MODEL_LOCAL, MODEL_CDN].flatMap((m) => delegates.map((d) => [m, d]));
  let lastErr;
  for (const [model, delegate] of attempts) {
    try {
      landmarker = await mod.PoseLandmarker.createFromOptions(fileset, opts(model, delegate));
      console.info('PoseLandmarker ready:', model, delegate);
      return landmarker;
    } catch (e) { lastErr = e; console.warn('PoseLandmarker 失敗', model, delegate, e); }
  }
  throw lastErr;
}

// ---------- 開始流程 ----------
async function begin() {
  ensureAudio();
  const sel = selectedMode();
  game = { mode: sel.mode, target: sel.target, paused: false };
  if (!SIM) {
    if (!window.isSecureContext) {
      message('要用 HTTPS 先開到鏡頭', '瀏覽器只容許 HTTPS 網址或本機 localhost 使用鏡頭。<br>請用 https:// 網址開啟，或喺本機用 <code>npm start</code> 再開 http://127.0.0.1:4190/', [['返回首頁', goHome, true]]);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      message('呢個瀏覽器唔支援鏡頭', '請改用最新版 Chrome、Edge 或 Safari。', [['返回首頁', goHome, true]]);
      return;
    }
    message('準備緊……', '請允許瀏覽器使用鏡頭。第一次載入姿勢模型需時約 10–30 秒。', [['返回首頁', goHome]], true);
    const modelP = createLandmarker();
    modelP.catch(() => {});
    try { if (!stream) await startCamera(); } catch (e) { cameraError(e); return; }
    if (phase !== 'message') return;
    try { await modelP; } catch (e) {
      console.error(e);
      message('載入失敗，請檢查網絡', '姿勢模型下載唔到。請檢查網絡（學校或公司網絡可能封鎖），然後撳「重試」。', [['重試', () => begin(), true], ['返回首頁', goHome]]);
      return;
    }
    if (phase !== 'message') return;
  }
  restartSetup();
  startLoop();
}

function restartSetup() {
  clearTimeout(countdownTimer);
  phase = 'setup';
  show('game');
  baseline = null;
  calib = { samples: [], since: 0 };
  smoother.reset();
  counter.reset();
  tracker.reset();
  $('hud').classList.add('hidden');
  $('guide').classList.remove('hidden', 'ok');
  $('calibBar').classList.add('hidden');
  $('countdown').textContent = '';
  $('pausedLayer').classList.add('hidden');
  $('pauseBtn').classList.add('hidden');
  $('finishBtn').classList.add('hidden');
  $('status').textContent = '站位檢查：全身入鏡後保持站直 2 秒';
  toastLock = '';
  toast('睇唔到你，請站到鏡頭前');
}

function startCountdown() {
  phase = 'countdown';
  $('guide').classList.add('hidden');
  $('calibBar').classList.add('hidden');
  toast('');
  $('status').textContent = '準備開始';
  let n = 3;
  const step = () => {
    if (phase !== 'countdown') return;
    if (n > 0) { $('countdown').textContent = n; sfx.tick(); n--; countdownTimer = setTimeout(step, 1000); }
    else { $('countdown').textContent = '開始！'; sfx.go(); countdownTimer = setTimeout(() => { $('countdown').textContent = ''; }, 700); startPlay(); }
  };
  step();
}

function startPlay() {
  phase = 'play';
  counter.reset();
  Object.assign(game, { elapsed: 0, lastTick: performance.now() / 1000, paused: false, ended: false, lostShown: false });
  $('hud').classList.remove('hidden');
  $('pauseBtn').classList.remove('hidden');
  $('finishBtn').classList.toggle('hidden', game.mode !== 'free');
  const d = DIFFICULTIES[settings.difficulty] || DIFFICULTIES.standard;
  $('status').textContent = `${game.mode === 'free' ? '自由模式' : game.mode === 'timed' ? '60 秒挑戰' : `目標 ${game.target} 下`}・難度：${d.label}`;
  $('passLine').style.bottom = `${(1 / 1.3) * 100}%`;
  updateHud();
  requestWakeLock();
}

function setPaused(p) {
  if (!game || phase !== 'play') return false;
  if (p === game.paused) return false;
  game.paused = p;
  game.lastTick = performance.now() / 1000;
  $('pausedLayer').classList.toggle('hidden', !p);
  $('pauseBtn').innerHTML = p ? '▶️ 繼續 <small>(空白鍵)</small>' : '⏸ 暫停 <small>(空白鍵)</small>';
  if (!p) { counter.reset(); toast('先企直，再開始', 'warn', 1500); }
  return true;
}

function endGame(save = true) {
  if (!game || game.ended) return;
  game.ended = true;
  phase = 'result';
  releaseWakeLock();
  sfx.end();
  const reps = counter.reps, attempts = counter.attempts, time = game.elapsed;
  const key = recordKey(game.mode, game.target);
  let isRecord = false;
  if (save) {
    if (game.mode === 'target') {
      if (reps >= game.target && (records[key] == null || time < records[key])) { records[key] = Math.round(time * 10) / 10; isRecord = true; }
    } else if (reps > 0 && reps > (records[key] || 0)) { records[key] = reps; isRecord = true; }
    store.set('records', records);
  }
  $('resultMode').textContent = game.mode === 'free' ? '自由模式' : game.mode === 'timed' ? '60 秒挑戰' : `目標 ${game.target} 下`;
  $('resultCount').textContent = reps;
  $('resultRate').textContent = attempts ? `${Math.round((reps / attempts) * 100)}%` : '–';
  $('resultTime').textContent = fmtTime(time);
  $('resultBest').textContent = recordText(key);
  const rec = $('resultRecord');
  rec.classList.toggle('hidden', !isRecord);
  rec.classList.remove('celebrate');
  if (isRecord) { void rec.offsetWidth; rec.classList.add('celebrate'); }
  show('result');
  $('againBtn').focus();
}

// ---------- 主迴圈 ----------
function startLoop() {
  cancelAnimationFrame(rafId);
  const tick = () => { rafId = requestAnimationFrame(tick); frame(); };
  rafId = requestAnimationFrame(tick);
}
function stopLoop() { cancelAnimationFrame(rafId); rafId = 0; }

function getPoses(now) {
  if (SIM) return { poses: simPoses, aspect: 1, fresh: true };
  if (!landmarker || video.readyState < 2) return { poses: null, aspect: 1, fresh: false };
  if (video.currentTime === lastVideoTime) return { poses: undefined, aspect: video.videoWidth / video.videoHeight, fresh: false };
  lastVideoTime = video.currentTime;
  const t0 = performance.now();
  const res = landmarker.detectForVideo(video, now);
  detectMs = detectMs * 0.9 + (performance.now() - t0) * 0.1;
  return { poses: res.landmarks, aspect: video.videoWidth / video.videoHeight, fresh: true };
}

function frame() {
  if (!['setup', 'countdown', 'play'].includes(phase)) return;
  const now = performance.now();
  const t = now / 1000;
  if (phase === 'play' && !game.paused) {
    game.elapsed += t - game.lastTick;
    game.lastTick = t;
    if (game.mode === 'timed' && game.elapsed >= 60) { game.elapsed = 60; updateHud(); endGame(); return; }
  }
  let r;
  try { r = getPoses(now); } catch (e) { console.error(e); return; }
  if (!r.fresh) { if (phase === 'play') updateHud(); return; }

  lastPoses = r.poses;
  // 站位未開始校準前，每幀重新揀最中間的人；開始校準後鎖定同一人
  const autoLock = phase !== 'setup' || calib.samples.length > 0;
  const tr = tracker.update(r.poses, t, autoLock);
  if (tr.switched) onPersonSwitch();
  const pose = tr.pose;
  const framing = checkFraming(pose);
  const lms = framing.ok || (pose && phase === 'play') ? smoother.push(pose) : (smoother.reset(), null);
  if (pose) lastSeenPose = t;
  lastPose = lms;
  lastPeople = tr.people;
  draw(lms, framing.ok, tr.people, tr.multiple);

  if (phase === 'setup') return setupFrame(lms, framing, t, r.aspect);
  if (phase === 'play' && !game.paused) playFrame(lms, framing, t, r.aspect);
}

function setupFrame(lms, framing, t, aspect) {
  $('guide').classList.toggle('ok', framing.ok);
  if (!framing.ok) {
    calib = { samples: [], since: 0 };
    $('calibBar').classList.add('hidden');
    if (dark && t - lastSeenPose > 2) toast('光線可能不足，請開燈或面向光源', 'warn');
    else toast(framing.hint, 'warn');
    return;
  }
  const m = rawMeasure(lms, aspect);
  const first = calib.samples[0];
  if (m.kneeAngle < CONFIG.standKneeMin || (first && Math.abs(m.hipY - first.hipY) > CONFIG.calibrateMaxMove)) {
    calib = { samples: [], since: 0 };
    toast('請企直唔好郁', 'warn');
    $('calibBar').classList.add('hidden');
    return;
  }
  if (!calib.samples.length) calib.since = t;
  calib.samples.push(m);
  const p = Math.min(1, (t - calib.since) / CONFIG.calibrateSeconds);
  $('calibBar').classList.remove('hidden');
  $('calibBar').firstElementChild.style.width = `${p * 100}%`;
  toast('好！保持站直', 'ok');
  if (p >= 1) {
    baseline = makeBaseline(calib.samples);
    startCountdown();
  }
}

function playFrame(lms, framing, t, aspect) {
  const d = DIFFICULTIES[settings.difficulty] || DIFFICULTIES.standard;
  const usable = lms && baseline && !framing.missing.some((x) => ['全身', '髖部', '膝頭', '腳踝'].includes(x));
  const m = usable ? measure(lms, baseline, d, aspect) : null;
  const events = counter.update(m, t);
  if (m) setMeter(m.score);
  for (const e of events) {
    if (e === 'rep') {
      sfx.rep();
      bump();
      toast('好！', 'ok', 600);
      if (game.mode === 'target' && counter.reps >= game.target) { updateHud(); endGame(); return; }
    } else if (e === 'shallow') { sfx.warn(); toast('再蹲深少少', 'warn', 1500); }
    else if (e === 'tooFast') toast('太快喇，慢慢嚟', 'warn', 1500);
    else if (e === 'lean' && t - lastLeanToast > 3) { lastLeanToast = t; toast('挺直上身', 'warn', 1500); }
    else if (e === 'lost') { toastLock = 'lost'; toast(dark ? '睇唔到你，光線可能不足' : '睇唔到你，請返回畫面', 'warn', 0, 'lost'); }
    else if (e === 'back') { toastLock = ''; toast('返嚟喇！先企直', 'ok', 1500); }
  }
  if (!toastLock) {
    if (counter.state === 'idle' && !$('toast').textContent) toast('企直準備');
    else if (counter.state !== 'idle' && $('toast').textContent === '企直準備') toast('');
  }
  updateHud();
}

function setMeter(score) {
  const s = Math.max(0, Math.min(1.3, score));
  $('meterFill').style.height = `${(s / 1.3) * 100}%`;
  $('meter').classList.toggle('hit', score >= CONFIG.bottomEnterScore);
  $('meter').setAttribute('aria-valuenow', String(Math.round(Math.min(score, 1) * 100)));
}
function bump() {
  const el = $('count');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
function updateHud() {
  if (!game) return;
  $('count').textContent = counter.reps;
  if (game.mode === 'timed') {
    const left = Math.max(0, 60 - game.elapsed);
    $('timer').textContent = `${Math.ceil(left)}`;
    $('timerLabel').textContent = '剩餘秒數';
    $('countLabel').textContent = '下';
  } else if (game.mode === 'target') {
    $('timer').textContent = fmtTime(game.elapsed);
    $('timerLabel').textContent = '用時';
    $('countLabel').textContent = `/ ${game.target} 下`;
  } else {
    $('timer').textContent = fmtTime(game.elapsed);
    $('timerLabel').textContent = '用時';
    $('countLabel').textContent = '下';
  }
}

function onPersonSwitch() {
  smoother.reset();
  if (phase === 'setup') { calib = { samples: [], since: 0 }; $('calibBar').classList.add('hidden'); }
  if (phase === 'play') counter.interrupt();
}

// 撳畫面上的人：改為追蹤佢
$('stage').addEventListener('click', (e) => {
  if (!['setup', 'countdown', 'play'].includes(phase) || !lastPoses?.length) return;
  if (e.target.closest('button')) return;
  const g = stageGeom();
  const x = (g.rect.right - e.clientX - g.ox) / g.w;   // 畫面經 CSS 鏡像
  const y = (e.clientY - g.rect.top - g.oy) / g.h;
  if (tracker.selectAt(x, y, lastPoses, performance.now() / 1000)) {
    onPersonSwitch();
    toast('已轉為追蹤呢個人', 'ok', 1500);
  }
});

// ---------- 繪圖 ----------
function stageGeom() {
  const rect = canvas.getBoundingClientRect();
  const va = SIM ? rect.width / rect.height : (video.videoWidth / video.videoHeight) || 16 / 9;
  let w = rect.width, h = rect.width / va;
  if (h > rect.height) { h = rect.height; w = h * va; }
  return { rect, va, w, h, ox: (rect.width - w) / 2, oy: (rect.height - h) / 2 };
}
function drawPeople(people, ok, multiple, g) {
  const pad = 0.02;
  for (const { box: b, tracked } of [...people].sort((a, c) => a.tracked - c.tracked)) {
    const x = g.ox + (b.x0 - pad) * g.w, y = g.oy + (b.y0 - pad * 2) * g.h;
    const bw = (b.w + pad * 2) * g.w, bh = (b.h + pad * 4) * g.h;
    ctx.save();
    if (tracked) {
      ctx.strokeStyle = ok ? '#b6ff3b' : '#ffb547';
      ctx.lineWidth = 4; ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    }
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, 14) : ctx.rect(x, y, bw, bh); ctx.stroke();
    // 標籤：畫布經 CSS 鏡像，文字要反轉；標籤貼框的畫面左上角
    const label = tracked ? (multiple ? '✓ 追蹤緊呢位' : '✓ 追蹤中') : '未追蹤（撳一下轉追佢）';
    ctx.scale(-1, 1);
    ctx.font = `bold ${tracked ? 18 : 14}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 16, th = tracked ? 28 : 24;
    const lx = -(x + bw), ly = Math.max(0, y - th - 4);
    ctx.fillStyle = tracked ? (ok ? '#b6ff3b' : '#ffb547') : 'rgba(0,0,0,.6)';
    ctx.fillRect(lx, ly, tw, th);
    ctx.fillStyle = tracked ? '#0b0f14' : 'rgba(255,255,255,.85)';
    ctx.fillText(label, lx + 8, ly + th - 8);
    ctx.restore();
  }
}

const BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]];
function draw(lms, ok, people = [], multiple = false) {
  const g = stageGeom();
  const rect = g.rect;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawPeople(people, ok, multiple, g);
  if (!settings.skeleton || !lms) return;
  const { va, w, h, ox, oy } = g;
  const P = (p) => [ox + p.x * w, oy + p.y * h];
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.strokeStyle = ok ? 'rgba(182,255,59,.9)' : 'rgba(255,181,71,.9)';
  for (const [a, b] of BONES) {
    if ((lms[a].visibility ?? 1) < 0.3 || (lms[b].visibility ?? 1) < 0.3) continue;
    ctx.beginPath(); ctx.moveTo(...P(lms[a])); ctx.lineTo(...P(lms[b])); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28]) { const [x, y] = P(lms[i]); ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); }
  if (baseline) {
    const m = measure(lms, baseline, DIFFICULTIES[settings.difficulty] || DIFFICULTIES.standard, SIM ? 1 : va);
    // 畫布經 CSS 鏡像，文字要反轉回來
    ctx.save(); ctx.scale(-1, 1);
    ctx.font = 'bold 20px system-ui'; ctx.fillStyle = '#fff';
    const lines = [`膝角 ${m.kneeAngle.toFixed(0)}°`, `髖降 ${(m.hipDrop * 100).toFixed(0)}%`, `深度 ${(m.score * 100).toFixed(0)}%`, `狀態 ${counter.state}`, `偵測 ${detectMs.toFixed(0)}ms`];
    lines.forEach((l, i) => ctx.fillText(l, -rect.width + 16, rect.height - 20 - (lines.length - 1 - i) * 26));
    ctx.restore();
  }
}

// ---------- 光線 ----------
const probe = document.createElement('canvas');
probe.width = 32; probe.height = 18;
setInterval(() => {
  if (SIM || !stream || video.readyState < 2 || !['setup', 'play'].includes(phase)) return;
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
$('homeBtn').onclick = goHome;
$('resultHomeBtn').onclick = goHome;
$('pauseBtn').onclick = () => setPaused(!game?.paused);
$('finishBtn').onclick = () => endGame(true);
$('againBtn').onclick = () => {
  ensureAudio();
  const keep = { mode: game.mode, target: game.target };
  game = { ...keep, paused: false };
  if (!SIM && !stream) { begin(); return; }
  restartSetup();
  startLoop();
};
$('clearBtn').onclick = () => {
  records = {};
  store.remove('records');
  $('resultBest').textContent = '–';
  $('resultRecord').classList.add('hidden');
  $('clearBtn').textContent = '已清除紀錄';
  setTimeout(() => { $('clearBtn').textContent = '清除紀錄'; }, 1500);
};
document.addEventListener('keydown', (e) => {
  if (dlg.open) return;
  if (e.key === 'Escape' && phase !== 'home') { e.preventDefault(); goHome(); }
  else if ((e.code === 'Space' || e.key === ' ') && phase === 'play' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); setPaused(!game.paused); }
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
    get reps() { return counter.reps; },
    get attempts() { return counter.attempts; },
    get state() { return counter.state; },
    get elapsed() { return game?.elapsed ?? 0; },
    get detectMs() { return detectMs; },
    get people() { return lastPeople.map((p) => ({ cx: p.box.cx, tracked: p.tracked })); },
    get trackedCx() { return lastPeople.find((p) => p.tracked)?.box.cx ?? null; },
  };
}

renderRecords();
