// 六種動作的量度（純函數，不涉及畫面）。
// measure(f, base, level) 回傳：
//   ok        姿勢／入鏡是否足以判定；false 時 hint 說明原因
//   ch        [{ p, rest }]：每個計數通道的進度（1 = 到位）及是否處於起始姿勢
//   holding   （只限計時類）是否正確保持中
//   ready     是否處於預備姿勢（開始前校準用）
//   fault     本幀的犯規訊息（犯規太多該下不計）
//   tip       本幀的提示（不影響計數）
//   dbg       調試數值
import { THRESHOLDS as T, CONFIG } from './config.mjs';
import { LM, SIDES, angle, incline, mid, makeFrame, seen, sideAvg, sideVis, clamp } from './geometry.mjs';

const ema = (prev, v, a = 0.2) => (prev == null ? v : prev + a * (v - prev));
const no = (hint, extra = {}) => ({ ok: false, hint, ch: [], ready: false, ...extra });

function centers(f) {
  return { sh: sidePt(f, 'shoulder'), hip: sidePt(f, 'hip'), knee: sidePt(f, 'knee'), ankle: sidePt(f, 'ankle') };
}
// 企立類動作：全身要入鏡。both = 左右兩邊都要清楚（正面動作）；否則最少一邊清楚（容許側身）
function standingFraming(f, { both = false, arms = false } = {}) {
  const ok = (l, r) => (both ? seen(f, l) && seen(f, r) : seen(f, l) || seen(f, r));
  const missing = [];
  if (!seen(f, LM.nose) && !ok(LM.lShoulder, LM.rShoulder)) missing.push('頭');
  if (!ok(LM.lShoulder, LM.rShoulder)) missing.push('膊頭');
  // 手舉高時可能短暫出鏡，只檢查可信度
  if (arms && !(f.p[LM.lWrist].v >= 0.3 && f.p[LM.rWrist].v >= 0.3)) missing.push('雙手');
  if (!ok(LM.lHip, LM.rHip)) missing.push('髖部');
  if (!ok(LM.lKnee, LM.rKnee)) missing.push('膝頭');
  if (!ok(LM.lAnkle, LM.rAnkle)) missing.push('腳踝');
  if (missing.length >= 4) return '睇唔到你，請企入鏡頭範圍';
  if (missing.includes('腳踝') || missing.includes('膝頭')) return `睇唔到${missing.join('、')}，請行後少少`;
  if (missing.includes('頭')) return '睇唔到頭，請行後少少';
  if (missing.length) return `睇唔到${missing.join('、')}`;
  return null;
}
function standingSize(f) {
  const h = sidePt(f, 'ankle').y - Math.min(f.p[LM.nose].y, sidePt(f, 'shoulder').y);
  if (h > 0.97) return '太近，請後退';
  if (h < 0.28) return '太遠，請行近少少';
  return null;
}
const kneeAngle2 = (f) => sideAvg(f, (s) => angle(f.p[s.hip], f.p[s.knee], f.p[s.ankle]), ['hip', 'knee', 'ankle']);
const kneeAngle3 = (f) => (f.w ? sideAvg(f, (s) => angle(f.w[s.hip], f.w[s.knee], f.w[s.ankle]), ['hip', 'knee', 'ankle']) : null);
// 上身與垂直線的夾角（0 = 挺直）
const lean = (c) => 90 - incline(c.hip, c.sh);
const upright = (f, c) => c.sh.y < c.hip.y && c.hip.y < c.ankle.y && lean(c) < 25;

// 側面（地上）動作：最少一邊的指定關節要清楚
function sideFraming(f, joints, names) {
  if (sideVis(f, joints) >= CONFIG.minVis) return null;
  const lost = joints.filter((j) => sideVis(f, [j]) < CONFIG.minVis).map((j) => names[j]);
  if (lost.length >= joints.length - 1) return '睇唔到你，請入返鏡頭範圍';
  return `睇唔到${lost.join('、') || '全身'}，請側身對住鏡頭、全身入鏡`;
}
const NAMES = { shoulder: '膊頭', elbow: '手踭', wrist: '手腕', hip: '髖部', knee: '膝頭', ankle: '腳踝' };
function sidePt(f, j) {
  const l = f.p[SIDES.l[j]], r = f.p[SIDES.r[j]];
  const wl = l.v * l.v + 1e-6, wr = r.v * r.v + 1e-6;
  return { x: (l.x * wl + r.x * wr) / (wl + wr), y: (l.y * wl + r.y * wr) / (wl + wr) };
}

export const EXERCISES = {
  squat: {
    id: 'squat', name: '深蹲', en: 'Squat', icon: '🏋️', kind: 'reps', unit: '下', view: '正面或側面企立', floor: false, channels: 1,
    readyText: '企直，全身入鏡',
    setup: '面向鏡頭企直，由頭到腳都要入鏡。',
    rule: '蹲到大腿接近水平，再完全企直，先計一下。',
    shallow: '再蹲低啲',
    measure(f, base, level) {
      const th = T.squat[level], g = T.squat;
      const miss = standingFraming(f);
      if (miss) return no(miss);
      const c = centers(f);
      const k2 = kneeAngle2(f), k3 = kneeAngle3(f);
      const leg = c.ankle.y - c.hip.y;
      const straight = k2 >= g.straightKnee && upright(f, c);
      if (straight) base.leg = ema(base.leg, leg);
      const drop = base.leg ? 1 - leg / base.leg : 0;
      const s1 = Math.max(0, drop) / th.hipDrop;
      const s2 = Math.max(0, 170 - k2) / (170 - th.knee2);
      const s3 = k3 == null ? 0 : Math.max(0, 165 - k3) / (165 - th.knee3);
      // 3D 膝角只作輔助：要 2D 亦見到明顯屈膝先採用，避免 3D 估算雜訊造成誤計
      const p = Math.max(s1, s2, s2 >= 0.5 || s1 >= 0.5 ? s3 : 0);
      const rest = k2 >= g.restKnee && drop <= g.restDrop;
      const ln = lean(c);
      return {
        ok: true, ch: [{ p, rest }], ready: straight && !standingSize(f), hint: standingSize(f) || (straight ? null : '請企直'),
        tip: ln > g.leanWarn && !rest ? '挺直上身' : null,
        dbg: { 膝角2D: k2, 膝角3D: k3 ?? 0, '髖降%': drop * 100 },
      };
    },
  },

  jack: {
    id: 'jack', name: '開合跳', en: 'Jumping Jack', icon: '⭐', kind: 'reps', unit: '下', view: '正面企立', floor: false, channels: 1,
    readyText: '企直，雙手垂低、雙腳合埋',
    setup: '面向鏡頭企直，雙手舉高時指尖都要入鏡。',
    rule: '雙手過頭、雙腳打開，再雙手垂低、雙腳合埋，先計一下。',
    shallow: '手要舉高過頭、腳要打開',
    measure(f, base, level) {
      const th = T.jack[level], g = T.jack;
      const miss = standingFraming(f, { both: true, arms: true });
      if (miss) return no(miss);
      const c = centers(f), P = f.p;
      const arm = (angle(P[LM.lHip], P[LM.lShoulder], P[LM.lWrist]) + angle(P[LM.rHip], P[LM.rShoulder], P[LM.rWrist])) / 2;
      const leg = angle(P[LM.lAnkle], c.hip, P[LM.rAnkle]);
      const sa = (arm - g.armZero) / (th.arm - g.armZero), sl = (leg - g.legZero) / (th.leg - g.legZero);
      const p = Math.max(0, Math.min(sa, sl));
      const rest = arm <= g.restArm && leg <= g.restLeg;
      let tip = null;
      if (sa >= 1 && sl < 0.6) tip = '雙腳要打開';
      else if (sl >= 1 && sa < 0.6) tip = '雙手要舉高過頭';
      const stand = rest && upright(f, c) && kneeAngle2(f) >= 160;
      return {
        ok: true, ch: [{ p, rest }], ready: stand && !standingSize(f), hint: standingSize(f) || (stand ? null : '請企直，雙手垂低、雙腳合埋'),
        tip, effort: Math.max(0, Math.max(sa, sl)), dbg: { 手臂角: arm, 兩腿角: leg },
      };
    },
  },

  knees: {
    id: 'knees', name: '高抬腿', en: 'High Knees', icon: '🏃', kind: 'reps', unit: '下', view: '正面企立', floor: false, channels: 2,
    readyText: '企直，全身入鏡',
    setup: '面向鏡頭企直，由頭到腳都要入鏡。',
    rule: '膝頭提到接近髖部高度再放低，左右腳每提一次計一下。',
    shallow: '膝頭提高啲',
    measure(f, base, level) {
      const th = T.knees[level], g = T.knees;
      const miss = standingFraming(f);
      if (miss) return no(miss);
      const c = centers(f), P = f.p;
      const ext = [P[LM.lKnee].y - P[LM.lHip].y, P[LM.rKnee].y - P[LM.rHip].y];
      const k2 = kneeAngle2(f);
      const straight = k2 >= 165 && upright(f, c);
      if (straight) base.thigh = ema(base.thigh, (ext[0] + ext[1]) / 2);
      const thigh = Math.max(base.thigh ?? 0, 0.6 * Math.max(...ext), 0.02);
      const lifts = ext.map((e) => 1 - e / thigh);
      return {
        ok: true, ch: lifts.map((l) => ({ p: Math.max(0, l) / th.lift, rest: l <= g.restLift })),
        ready: straight && !standingSize(f), hint: standingSize(f) || (straight ? null : '請企直'),
        dbg: { '左膝%': lifts[0] * 100, '右膝%': lifts[1] * 100 },
      };
    },
  },

  pushup: {
    id: 'pushup', name: '掌上壓', en: 'Push-up', icon: '💪', kind: 'reps', unit: '下', view: '側面，身體打橫', floor: true, channels: 1,
    readyText: '撐直雙手，身體成一直線',
    setup: '身體打橫、側面對住鏡頭，由頭到腳都要入鏡。',
    rule: '屈手令胸口貼近地面，再完全撐直，全程身體成一直線，先計一下。',
    shallow: '再壓低啲',
    measure(f, base, level) {
      const th = T.pushup[level], g = T.pushup;
      const miss = sideFraming(f, ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'], NAMES);
      if (miss) return no(miss);
      const sh = sidePt(f, 'shoulder'), hip = sidePt(f, 'hip'), an = sidePt(f, 'ankle'), wr = sidePt(f, 'wrist');
      const inc = incline(an, sh);
      const bodyLen = Math.hypot(sh.x - an.x, sh.y - an.y);
      const handsDown = wr.y > sh.y - 0.02 && Math.abs(wr.y - an.y) < 0.45 * bodyLen;
      if (inc > g.maxIncline || !handsDown) return no('請做掌上壓預備姿勢：雙手撐地、身體打橫', { dbg: { 身體傾斜: inc } });
      const elbow = sideAvg(f, (s) => angle(f.p[s.shoulder], f.p[s.elbow], f.p[s.wrist]), ['shoulder', 'elbow', 'wrist']);
      const line = angle(sh, hip, an);
      const height = wr.y - sh.y;
      const top = elbow >= g.straightElbow;
      if (top) base.arm = ema(base.arm, height);
      const drop = base.arm ? 1 - height / base.arm : 0;
      const se = Math.max(0, 165 - elbow) / (165 - th.elbow), sd = Math.max(0, drop) / th.drop;
      const p = Math.min(se, sd);
      const rest = elbow >= g.restElbow && drop <= 0.5 * th.drop;
      const bad = line < th.line;
      // 髖在膊–踝連線之上 = 翹臀；之下 = 塌腰
      const t = (hip.x - sh.x) / ((an.x - sh.x) || 1e-6);
      const hipHigh = hip.y < sh.y + t * (an.y - sh.y);
      const fault = bad ? (hipHigh ? '臀部唔好翹高，身體要成一直線' : '腰唔好塌，身體要成一直線') : null;
      return {
        ok: true, ch: [{ p, rest }], ready: top && !bad, hint: top ? (bad ? fault : null) : '請撐直雙手',
        fault, effort: Math.max(se, sd), dbg: { 手踭角: elbow, '膊降%': drop * 100, 身體直線: line },
      };
    },
  },

  situp: {
    id: 'situp', name: '仰臥起坐', en: 'Sit-up', icon: '🔥', kind: 'reps', unit: '下', view: '側面，瞓喺地上', floor: true, channels: 1,
    readyText: '瞓低，屈膝，腳掌貼地',
    setup: '瞓低、屈膝，側面對住鏡頭，由頭到腳都要入鏡。',
    rule: '上身坐起到接近垂直，再瞓返落地，先計一下。',
    shallow: '坐高啲',
    measure(f, base, level) {
      const th = T.situp[level], g = T.situp;
      const miss = sideFraming(f, ['shoulder', 'hip', 'knee'], NAMES);
      if (miss) return no(miss);
      const sh = sidePt(f, 'shoulder'), hip = sidePt(f, 'hip'), kn = sidePt(f, 'knee');
      const torsoLen = Math.hypot(sh.x - hip.x, sh.y - hip.y) || 1e-6;
      const thighLen = Math.hypot(kn.x - hip.x, kn.y - hip.y) || 1e-6;
      // 屈膝瞓／坐喺地上：膝頭高過髖部，而且大腿斜向上（企立時膝頭在髖部之下）
      const kneeUp = (hip.y - kn.y) / thighLen;
      // 上身角度：膊在髖之上為正（瞓低 ≈ 0–20°，坐直 ≈ 90°）
      const torso = sh.y <= hip.y ? incline(hip, sh) : -incline(hip, sh);
      if (kneeUp < 0.15) return no('請瞓低並屈膝，側面對住鏡頭', { dbg: { 上身角: torso, 膝高: kneeUp } });
      const p = Math.max(0, torso - th.down) / (th.up - th.down);
      const rest = torso <= th.down;
      return { ok: true, ch: [{ p, rest }], ready: rest, hint: rest ? null : '請瞓低', dbg: { 上身角: torso, 膝高: kneeUp, 上身長: torsoLen } };
    },
  },

  plank: {
    id: 'plank', name: '平板支撐', en: 'Plank', icon: '🧱', kind: 'hold', unit: '秒', view: '側面，身體打橫', floor: true, channels: 0,
    readyText: '撐好平板支撐姿勢',
    setup: '身體打橫、側面對住鏡頭，用前臂或手掌撐地，由頭到腳都要入鏡。',
    rule: '身體保持一直線先計時；塌腰、翹臀或趴低就停止計時。',
    shallow: '',
    measure(f, base, level) {
      const th = T.plank[level], g = T.plank;
      const miss = sideFraming(f, ['shoulder', 'elbow', 'hip', 'ankle'], NAMES);
      if (miss) return no(miss);
      const sh = sidePt(f, 'shoulder'), hip = sidePt(f, 'hip'), an = sidePt(f, 'ankle'), el = sidePt(f, 'elbow'), wr = sidePt(f, 'wrist'), kn = sidePt(f, 'knee');
      const inc = incline(an, sh);
      const bodyLen = Math.hypot(sh.x - an.x, sh.y - an.y) || 1e-6;
      const support = Math.max(el.y, wr.y);
      const lift = (support - sh.y) / bodyLen;
      const line = angle(sh, hip, an);
      const knee = angle(hip, kn, an);
      const dbg = { 身體直線: line, 身體傾斜: inc, '膊高%': lift * 100, 膝角: knee };
      const t = (hip.x - sh.x) / ((an.x - sh.x) || 1e-6);
      const hipHigh = hip.y < sh.y + t * (an.y - sh.y);
      let hint = null;
      if (inc > g.maxIncline) hint = '請撐好平板支撐姿勢：身體打橫';
      else if (lift < g.minLift) hint = '撐高上身，唔好趴喺地上';
      else if (line < th.line) hint = hipHigh ? '臀部唔好翹高' : '腰唔好塌';
      else if (knee < 130) hint = '雙腳要伸直';
      const holding = !hint;
      return { ok: true, ch: [], holding, ready: holding, hint, tip: hint, dbg };
    },
  },
};
export const EXERCISE_ORDER = ['squat', 'pushup', 'situp', 'jack', 'knees', 'plank'];
export const measureRaw = (ex, lm, world, aspect, base, level) => EXERCISES[ex].measure(makeFrame(lm, world, aspect), base, level);
export { clamp };
