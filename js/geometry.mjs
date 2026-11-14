import { CONFIG } from './config.mjs';

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};
export const SIDES = {
  l: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  r: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const deg = (r) => (r * 180) / Math.PI;
const visOf = (p) => (p ? (p.visibility ?? p.v ?? 1) : 0);

// 夾角 ∠abc（度）。點可以是 2D {x,y} 或 3D {x,y,z}。
export function angle(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)];
  const v2 = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  if (!n) return 180;
  return deg(Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / n, -1, 1)));
}
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// 線段 a→b 與水平線的夾角（0–90°）
export const incline = (a, b) => deg(Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)));

// 一幀姿勢：p = 2D 點（x 已乘畫面比例，單位 = 畫面高度；不含 z），w = 3D 世界座標（可能為 null）
export function makeFrame(lm, world = null, aspect = 1) {
  return {
    aspect,
    raw: lm,
    p: lm.map((q) => ({ x: q.x * aspect, y: q.y, v: visOf(q), in: q.x > -0.03 && q.x < 1.03 && q.y > -0.03 && q.y < 1.03 })),
    w: world,
  };
}
export const seen = (f, i, min = CONFIG.minVis) => f.p[i].v >= min && f.p[i].in;

// 左右兩邊按可信度加權平均（側面拍攝時，近鏡頭一邊比重自然較大）
export function sideAvg(f, fn, joints) {
  let sum = 0, wsum = 0;
  for (const s of [SIDES.l, SIDES.r]) {
    const v = Math.min(...joints.map((j) => f.p[s[j]].v));
    const w = v * v + 1e-6;
    sum += fn(s) * w; wsum += w;
  }
  return sum / wsum;
}
export const sideVis = (f, joints) => Math.max(...[SIDES.l, SIDES.r].map((s) => Math.min(...joints.map((j) => (f.p[s[j]].in ? f.p[s[j]].v : 0)))));

// One Euro 濾波：慢動作時平滑、快動作時跟手
function oneEuro({ minCutoff, beta, dCutoff }) {
  let x = null, dx = 0, lt = 0;
  const a = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
  return (v, t) => {
    if (x === null) { x = v; lt = t; return v; }
    const dt = Math.max(1e-3, t - lt); lt = t;
    const d = (v - x) / dt;
    dx += a(dCutoff, dt) * (d - dx);
    x += a(minCutoff + beta * Math.abs(dx), dt) * (v - x);
    return x;
  };
}
export function createSmoother(opts = CONFIG.filter) {
  let f2 = null, f3 = null;
  const mk = (n) => Array.from({ length: n }, () => [oneEuro(opts), oneEuro(opts), oneEuro(opts)]);
  return {
    reset() { f2 = f3 = null; },
    push(lm, world, t) {
      if (!f2 || f2.length !== lm.length) { f2 = mk(lm.length); f3 = mk(lm.length); }
      const out = lm.map((q, i) => ({ x: f2[i][0](q.x, t), y: f2[i][1](q.y, t), z: q.z ?? 0, visibility: visOf(q) }));
      const w = world ? world.map((q, i) => ({ x: f3[i][0](q.x, t), y: f3[i][1](q.y, t), z: f3[i][2](q.z, t) })) : null;
      return { lm: out, world: w };
    },
  };
}

// 一個人的範圍框及中心（未乘畫面比例的 0–1 座標）
export function personBox(lms, minVis = 0.3) {
  let pts = lms.filter((p) => visOf(p) >= minVis);
  if (pts.length < 4) pts = lms;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const core = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((i) => lms[i]);
  const coreVis = core.reduce((a, p) => a + visOf(p), 0) / core.length;
  const good = coreVis >= 0.5;
  const cx = good ? core.reduce((a, p) => a + p.x, 0) / core.length : (x0 + x1) / 2;
  const cy = good ? core.reduce((a, p) => a + p.y, 0) / core.length : (y0 + y1) / 2;
  return { x0, x1, y0, y1, cx, cy, w: x1 - x0, h: y1 - y0, size: Math.max(x1 - x0, y1 - y0), coreVis };
}
