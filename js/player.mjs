import { CONFIG, THRESHOLDS } from './config.mjs';
import { createCounter, createHoldCounter } from './counter.mjs';
import { EXERCISES } from './exercises.mjs';
import { createSmoother, makeFrame } from './geometry.mjs';
import { createTracker } from './tracker.mjs';

// 一位玩家的完整流程：追蹤 → 平滑 → 量度 → 計數。純邏輯，可用錄低的關鍵點重播測試。
export function createPlayer({ exercise, level = 'standard', zone = [0, 1], cfg = CONFIG } = {}) {
  const ex = EXERCISES[exercise];
  const tracker = createTracker({ zone, cfg });
  const smoother = createSmoother(cfg.filter);
  const counter = ex.kind === 'hold' ? createHoldCounter({ cfg }) : createCounter({ channels: ex.channels, minRep: THRESHOLDS[exercise].minRep, cfg });
  let base = {};
  let ready = { since: null, done: false };
  let last = { m: null, lm: null, index: -1, lost: false };
  const api = {
    ex, tracker, counter, zone,
    get score() { return ex.kind === 'hold' ? counter.seconds : counter.reps; },
    get last() { return last; },
    get readyProgress() { return ready.done ? 1 : ready.since === null ? 0 : Math.min(1, (last.t - ready.since) / cfg.readySeconds); },
    get isReady() { return ready.done; },
    resetReady() { ready = { since: null, done: false }; },
    resetAll() { tracker.reset(); smoother.reset(); counter.reset(); base = {}; ready = { since: null, done: false }; last = { m: null, lm: null, index: -1, lost: false }; },
    switched() { smoother.reset(); counter.interrupt(); base = {}; ready = { since: null, done: false }; },
    // phase: 'ready'（預備：檢查預備姿勢，不計數）或 'play'（計數）
    update(poses, t, aspect, phase, taken = []) {
      const tr = tracker.update(poses, t, { autoLock: phase !== 'ready' || ready.since !== null || ready.done, taken });
      let m = null, lm = null;
      if (tr.pose) {
        const sm = smoother.push(tr.pose.lm, tr.pose.world, t);
        lm = sm.lm;
        m = ex.measure(makeFrame(sm.lm, sm.world, aspect), base, level);
      } else smoother.reset();
      last = { m, lm, index: tr.index, lost: tr.lost, t };
      let events = [];
      if (phase === 'ready') {
        if (m && m.ok && m.ready) { if (ready.since === null) ready.since = t; if (t - ready.since >= cfg.readySeconds) ready.done = true; }
        else if (!ready.done || !m || !m.ok) {
          // 已完成預備的人只要仍然量度得到就保持；量度不到（走開）就要重新預備
          ready = { since: null, done: false };
        }
      } else if (phase === 'play') events = counter.update(m, t);
      return { m, lm, events, index: tr.index, lost: tr.lost };
    },
  };
  return api;
}
