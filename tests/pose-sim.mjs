// 以簡單幾何生成模擬關鍵點（33 點，MediaPipe 編號），供邏輯測試及瀏覽器 ?sim 測試使用。
const rad = (d) => (d * Math.PI) / 180;
const blank = (v) => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: v }));
const set = (pts, i, x, y) => { pts[i].x = x; pts[i].y = y; };

// 企立人形。bend = 屈膝（小腿前傾角，0 = 企直；膝角 = 180 − 2×bend）；arm = 手臂離身角度（0 垂低，180 舉高）；
// spread = 兩腿夾角；liftL/liftR = 提膝幅度（1 = 膝頭到髖高）；cx = 橫向中心；s = 身形比例；lean = 上身前傾角
export function standing({ bend = 0, arm = 12, spread = 8, liftL = 0, liftR = 0, cx = 0.5, s = 1, lean = 0, visibility = 0.99, floor = 0.92 } = {}) {
  const pts = blank(visibility);
  const L = 0.2 * s, torso = 0.25 * s, armLen = 0.24 * s, hw = 0.045 * s, sw = 0.07 * s;
  const hipY = floor - 2 * L * Math.cos(rad(bend));
  const shY = hipY - torso * Math.cos(rad(lean)), shDx = torso * Math.sin(rad(lean));
  for (const [side, sign, lift] of [['l', 1, liftL], ['r', -1, liftR]]) {
    const idx = side === 'l' ? { s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 } : { s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 };
    const hx = cx + sign * hw;
    set(pts, idx.h, hx, hipY);
    if (lift > 0) {
      const ky = hipY + L * (1 - lift);
      set(pts, idx.k, hx, ky);
      set(pts, idx.a, hx, Math.min(floor, ky + L));
    } else {
      const sp = rad(spread / 2);
      // 以髖中心為軸打開雙腿
      const ax = cx + sign * (hw + 2 * L * Math.sin(sp)) * (spread > 8 ? 1 : 1);
      const ay = hipY + 2 * L * Math.cos(rad(bend)) * Math.cos(sp);
      set(pts, idx.a, cx + sign * 2 * L * Math.sin(sp), ay);
      set(pts, idx.k, (hx + pts[idx.a].x) / 2 + L * Math.sin(rad(bend)), (hipY + ay) / 2);
      void ax;
    }
    const sx = cx + sign * sw + shDx;
    set(pts, idx.s, sx, shY);
    const a = rad(arm);
    set(pts, idx.w, sx + sign * armLen * Math.sin(a), shY + armLen * Math.cos(a));
    set(pts, idx.e, sx + sign * (armLen / 2) * Math.sin(a), shY + (armLen / 2) * Math.cos(a));
  }
  set(pts, 0, cx + shDx, shY - 0.09 * s);
  return pts;
}

// 側面掌上壓／平板支撐。elbow = 手踭角（180 撐直）；sag = 髖部偏離直線（正 = 塌腰，負 = 翹臀；佔身長比例）；
// forearm = true 時為前臂平板支撐；flat = true 趴在地上
export function prone({ elbow = 175, sag = 0, cx = 0.5, s = 1, forearm = false, flat = false, visibility = 0.99, floor = 0.85, kneeDown = false } = {}) {
  const pts = blank(visibility);
  const B = 0.5 * s, seg = 0.1 * s;
  const ax = cx + B / 2, ay = floor;
  let h = forearm ? seg : 2 * seg * Math.sin(rad(elbow / 2));
  if (flat) h = 0.02 * s;
  const sx = ax - Math.sqrt(B * B - h * h), sy = floor - h;
  const ux = (ax - sx) / B, uy = (ay - sy) / B;         // 膊→踝方向
  const hx = sx + ux * B * 0.45 + -uy * sag * B * -1, hy = sy + uy * B * 0.45 + sag * B;
  const kx = (hx + ax) / 2, ky = kneeDown ? floor : (hy + ay) / 2;
  for (const [idx, off] of [[{ s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 }, 0], [{ s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 }, 0.004]]) {
    set(pts, idx.s, sx + off, sy); set(pts, idx.h, hx + off, hy); set(pts, idx.k, kx + off, ky); set(pts, idx.a, ax + off, ay);
    if (forearm) { set(pts, idx.e, sx + off, floor); set(pts, idx.w, sx - seg + off, floor); }
    else {
      set(pts, idx.w, sx + off, floor);
      set(pts, idx.e, sx + seg * Math.cos(rad(elbow / 2)) + off, sy + h / 2);
    }
  }
  set(pts, 0, sx - 0.08 * s, sy - 0.02 * s);
  return pts;
}

// 側面仰臥起坐。torso = 上身與地面夾角（0 瞓平，90 坐直）；legsFlat = 伸直腳（不合規格）
export function supine({ torso = 8, cx = 0.5, s = 1, visibility = 0.99, floor = 0.85, legsFlat = false } = {}) {
  const pts = blank(visibility);
  const T = 0.22 * s;
  const hx = cx, hy = floor - 0.03 * s;
  const sx = hx - T * Math.cos(rad(torso)), sy = hy - T * Math.sin(rad(torso));
  const kx = hx + 0.13 * s, ky = legsFlat ? hy : hy - 0.13 * s;
  const ax = legsFlat ? hx + 0.4 * s : hx + 0.26 * s, ay = floor;
  for (const [idx, off] of [[{ s: 11, e: 13, w: 15, h: 23, k: 25, a: 27 }, 0], [{ s: 12, e: 14, w: 16, h: 24, k: 26, a: 28 }, 0.004]]) {
    set(pts, idx.s, sx + off, sy); set(pts, idx.h, hx + off, hy); set(pts, idx.k, kx + off, ky); set(pts, idx.a, ax + off, ay);
    set(pts, idx.e, sx + 0.05 * s + off, sy - 0.02 * s); set(pts, idx.w, sx + 0.02 * s + off, sy - 0.06 * s);
  }
  set(pts, 0, sx - 0.08 * s * Math.cos(rad(torso)), sy - 0.08 * s * Math.sin(rad(torso)) - 0.01);
  return pts;
}

// 每種動作的「起始姿勢」及「到位姿勢」參數，k = 0（起始）至 1（完全到位）之間插值
export const MOVES = {
  squat: (k, o = {}) => standing({ bend: 30 * k, ...o }),
  jack: (k, o = {}) => standing({ arm: 12 + 158 * k, spread: 8 + 40 * k, ...o }),
  kneeL: (k, o = {}) => standing({ liftL: k, ...o }),
  kneeR: (k, o = {}) => standing({ liftR: k, ...o }),
  pushup: (k, o = {}) => prone({ elbow: 175 - 105 * k, ...o }),
  situp: (k, o = {}) => supine({ torso: 8 + 77 * k, ...o }),
  plank: (k, o = {}) => prone({ forearm: true, sag: 0.12 * k, ...o }),
};

// 由 [目標 k, 秒數, move?] 片段生成逐幀序列（線性插值）。k = null 代表無人。
export function timeline(move, segments, { fps = 30, opts = {}, t0 = 0 } = {}) {
  const frames = [];
  let t = t0, cur = segments[0][0] ?? 0, mv = move;
  for (const [target, secs, m] of segments) {
    if (m) mv = m;
    const n = Math.max(1, Math.round(secs * fps));
    for (let i = 1; i <= n; i++) {
      t += 1 / fps;
      const k = target === null ? null : cur + ((target - cur) * i) / n;
      frames.push({ t, k, lm: k === null ? null : MOVES[mv](k, opts) });
    }
    if (target !== null) cur = target;
  }
  return frames;
}
export const reps = (n, down = 0.6, up = 0.6, k = 1, pause = 0.15) => Array.from({ length: n }, () => [[k, down], [k, pause], [0, up], [0, pause]]).flat();
