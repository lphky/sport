import { CONFIG } from './config.mjs';

export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 };
export const REQUIRED = [
  ['頭', [LM.nose]],
  ['肩膊', [LM.lShoulder, LM.rShoulder]],
  ['髖部', [LM.lHip, LM.rHip]],
  ['膝頭', [LM.lKnee, LM.rKnee]],
  ['腳踝', [LM.lAnkle, LM.rAnkle]],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const vis = (p) => (p ? (p.visibility ?? 1) : 0);
const inFrame = (p) => p.x > -0.02 && p.x < 1.02 && p.y > -0.02 && p.y < 1.02;

export function angle(a, b, c, aspect = 1) {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return 180;
  return (Math.acos(clamp((v1x * v2x + v1y * v2y) / n, -1, 1)) * 180) / Math.PI;
}

export function createSmoother(alpha = CONFIG.smoothingAlpha) {
  let prev = null;
  return {
    reset() { prev = null; },
    push(lms) {
      if (!lms) return null;
      if (!prev || prev.length !== lms.length) {
        prev = lms.map((p) => ({ ...p }));
        return prev;
      }
      prev = lms.map((p, i) => ({
        x: prev[i].x + alpha * (p.x - prev[i].x),
        y: prev[i].y + alpha * (p.y - prev[i].y),
        z: (prev[i].z ?? 0) + alpha * ((p.z ?? 0) - (prev[i].z ?? 0)),
        visibility: p.visibility,
      }));
      return prev;
    },
  };
}

export function checkFraming(lms, minVis = CONFIG.minVisibility) {
  if (!lms) return { ok: false, missing: ['全身'], hint: '睇唔到你，請站到鏡頭前' };
  const missing = [];
  for (const [name, idx] of REQUIRED) {
    if (!idx.every((i) => vis(lms[i]) >= minVis && inFrame(lms[i]))) missing.push(name);
  }
  if (missing.length) {
    let hint;
    if (missing.length >= 4) hint = '睇唔到你，請站到鏡頭前';
    else if (missing.includes('腳踝') || missing.includes('膝頭')) hint = `睇唔到${missing.join('、')}，請行後少少`;
    else if (missing.includes('頭')) hint = '睇唔到頭，請行後少少或降低鏡頭';
    else hint = `睇唔到${missing.join('、')}，請調整位置`;
    return { ok: false, missing, hint };
  }
  const height = Math.max(lms[LM.lAnkle].y, lms[LM.rAnkle].y) - lms[LM.nose].y;
  if (height > 0.95) return { ok: false, missing: [], hint: '太近，請後退' };
  if (height < 0.3) return { ok: false, missing: [], hint: '太遠，請行近少少' };
  return { ok: true, missing: [], hint: '好！保持站直' };
}

function sideKnee(lms, aspect) {
  const l = { a: angle(lms[LM.lHip], lms[LM.lKnee], lms[LM.lAnkle], aspect), v: Math.min(vis(lms[LM.lHip]), vis(lms[LM.lKnee]), vis(lms[LM.lAnkle])) };
  const r = { a: angle(lms[LM.rHip], lms[LM.rKnee], lms[LM.rAnkle], aspect), v: Math.min(vis(lms[LM.rHip]), vis(lms[LM.rKnee]), vis(lms[LM.rAnkle])) };
  if (l.v >= 0.8 && r.v >= 0.8) return (l.a + r.a) / 2;
  return l.v >= r.v ? l.a : r.a;
}

export function rawMeasure(lms, aspect = 1) {
  const hipY = (lms[LM.lHip].y + lms[LM.rHip].y) / 2;
  const ankleY = (lms[LM.lAnkle].y + lms[LM.rAnkle].y) / 2;
  const sh = { x: (lms[LM.lShoulder].x + lms[LM.rShoulder].x) / 2, y: (lms[LM.lShoulder].y + lms[LM.rShoulder].y) / 2 };
  const hip = { x: (lms[LM.lHip].x + lms[LM.rHip].x) / 2, y: hipY };
  const lean = (Math.atan2(Math.abs((sh.x - hip.x) * aspect), Math.abs(hip.y - sh.y)) * 180) / Math.PI;
  return { hipY, ankleY, kneeAngle: sideKnee(lms, aspect), lean };
}

export function makeBaseline(samples) {
  const avg = (k) => samples.reduce((s, m) => s + m[k], 0) / samples.length;
  const hipY = avg('hipY');
  const ankleY = avg('ankleY');
  return { hipY, legLen: Math.max(0.05, ankleY - hipY), kneeAngle: avg('kneeAngle') };
}

export function measure(lms, baseline, diff, aspect = 1) {
  const m = rawMeasure(lms, aspect);
  const hipDrop = (m.hipY - baseline.hipY) / baseline.legLen;
  const hipScore = Math.max(0, hipDrop) / diff.hipDrop;
  const kneeScore = Math.max(0, CONFIG.kneeStraight - m.kneeAngle) / (CONFIG.kneeStraight - diff.kneeAngle);
  const score = Math.max(hipScore, kneeScore);
  const standing = m.kneeAngle >= CONFIG.standKneeMin && Math.abs(hipDrop) <= CONFIG.standHipDropMax;
  return { ...m, hipDrop, hipScore, kneeScore, score, standing };
}

// 深蹲狀態機：idle → standing → descending → bottom → ascending → standing(+1)
export function createCounter(cfg = CONFIG) {
  const s = { state: 'idle', reps: 0, attempts: 0, startT: 0, maxScore: 0, lostSince: null };
  const api = {
    get state() { return s.state; },
    get reps() { return s.reps; },
    get attempts() { return s.attempts; },
    reset() { Object.assign(s, { state: 'idle', reps: 0, attempts: 0, startT: 0, maxScore: 0, lostSince: null }); },
    // 換了追蹤對象：中斷未完成的一下，要先企直再數（不清除次數）
    interrupt() { Object.assign(s, { state: 'idle', startT: 0, maxScore: 0, lostSince: null }); },
    // m: measure() 結果；若追蹤不到傳 null。t: 秒。回傳事件陣列。
    update(m, t) {
      const ev = [];
      if (!m) {
        if (s.lostSince === null) s.lostSince = t;
        if (s.state !== 'lost' && t - s.lostSince >= cfg.lostSeconds) {
          s.state = 'lost';
          ev.push('lost');
        }
        return ev;
      }
      s.lostSince = null;
      if (s.state === 'lost') { s.state = 'idle'; ev.push('back'); }
      if (m.lean > cfg.leanMaxDeg && s.state !== 'idle') ev.push('lean');
      switch (s.state) {
        case 'idle':
          if (m.standing) s.state = 'standing';
          break;
        case 'standing':
          if (m.score >= cfg.startDescendScore) { s.state = 'descending'; s.startT = t; s.maxScore = m.score; }
          break;
        case 'descending':
          s.maxScore = Math.max(s.maxScore, m.score);
          if (m.score >= cfg.bottomEnterScore) s.state = 'bottom';
          else if (m.standing) {
            s.state = 'standing';
            if (s.maxScore >= cfg.shallowMinScore) { s.attempts++; ev.push('shallow'); }
          }
          break;
        case 'bottom':
          if (m.score < cfg.bottomExitScore) s.state = 'ascending';
          break;
        case 'ascending':
          if (m.score >= cfg.bottomEnterScore) s.state = 'bottom';
          else if (m.standing) {
            s.state = 'standing';
            if (t - s.startT < cfg.minRepSeconds) ev.push('tooFast');
            else { s.reps++; s.attempts++; ev.push('rep'); }
          }
          break;
      }
      return ev;
    },
  };
  return api;
}

// 一個人的範圍框（只計可見關鍵點）及中心
export function personBox(lms, minVis = 0.3) {
  let pts = lms.filter((p) => vis(p) >= minVis);
  if (pts.length < 4) pts = lms;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const core = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip].map((i) => lms[i]);
  const coreVis = core.reduce((a, p) => a + vis(p), 0) / core.length;
  const cx = coreVis >= 0.5 ? core.reduce((a, p) => a + p.x, 0) / core.length : (x0 + x1) / 2;
  return { x0, x1, y0, y1, cx, w: x1 - x0, h: y1 - y0, coreVis };
}

// 揀畫面中間的人並鎖定：鎖定後只跟同一人；人消失超過 trackHoldSeconds 才重新揀。
// 用 selectAt() 可手動指定追蹤某人。
// update() 回傳 { pose, people:[{box, tracked}], multiple, lost }
export function createTracker(cfg = CONFIG) {
  let lock = null; // { cx, w, h, seenT, manual }
  const closest = (list, x) => list.reduce((a, c) => (Math.abs(c.box.cx - x) < Math.abs(a.box.cx - x) ? c : a));
  const matches = (b) => {
    const ratio = b.h / Math.max(0.01, lock.h);
    return Math.abs(b.cx - lock.cx) <= Math.max(cfg.trackMatchMin, lock.w * 0.6) && ratio > 0.5 && ratio < 2;
  };
  const people = (poses) => (poses || []).map((p) => ({ p, box: personBox(p) }));
  return {
    get locked() { return !!lock; },
    get manual() { return !!lock?.manual; },
    get lost() { return !!lock?.lost; },
    reset() { lock = null; },
    // x, y：未鏡像的畫面座標（0–1）
    selectAt(x, y, poses, t) {
      const hit = people(poses).filter(({ box: b }) => x >= b.x0 - 0.03 && x <= b.x1 + 0.03 && y >= b.y0 - 0.05 && y <= b.y1 + 0.05);
      if (!hit.length) return false;
      const c = closest(hit, x);
      lock = { cx: c.box.cx, w: c.box.w, h: c.box.h, seenT: t, manual: true, lost: false };
      return true;
    },
    // autoLock = false：未手動指定時每幀重新揀中間的人（站位未完成時用）
    update(poses, t, autoLock = true) {
      if (!autoLock && lock && !lock.manual) lock = null;
      const list = people(poses);
      const multiple = list.filter((x) => x.box.coreVis >= cfg.minVisibility).length > 1;
      let chosen = null;
      if (lock && list.length) {
        const m = list.filter((x) => matches(x.box));
        if (m.length) chosen = closest(m, lock.cx);
      }
      const others = () => list.map((x) => ({ box: x.box, tracked: false }));
      if (!chosen && lock && t - lock.seenT <= cfg.trackHoldSeconds) {
        // 鎖定的人暫時睇唔到：唔轉去追其他人
        return { pose: null, people: others(), multiple, lost: false };
      }
      if (!chosen && lock) {
        // 鎖定的人走咗：保持鎖定、唔自動轉追其他人；佢返到原位會自動接返，或者撳畫面重新鎖定
        lock.lost = true;
        return { pose: null, people: others(), multiple, lost: true };
      }
      if (!chosen && list.length) {
        const good = list.filter((x) => x.box.coreVis >= cfg.minVisibility);
        chosen = closest(good.length ? good : list, 0.5);
      }
      if (chosen) lock = { cx: chosen.box.cx, w: chosen.box.w, h: chosen.box.h, seenT: t, manual: !!lock?.manual, lost: false };
      return { pose: chosen ? chosen.p : null, people: list.map((x) => ({ box: x.box, tracked: x === chosen })), multiple, lost: false };
    },
  };
}
