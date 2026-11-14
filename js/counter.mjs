import { CONFIG } from './config.mjs';

// 通用計數狀態機（每個通道獨立）：idle → rest → moving → peak → returning → rest(+1)
// 一定要由起始姿勢出發、做到位、再返回起始姿勢先計一下。
export function createCounter({ channels = 1, minRep = 0.5, cfg = CONFIG } = {}) {
  const mk = () => ({ state: 'idle', startT: 0, maxP: 0, frames: 0, faults: 0, faultMsg: null });
  let ch = Array.from({ length: channels }, mk);
  const s = { reps: 0, attempts: 0, lostSince: null, lost: false };
  return {
    get reps() { return s.reps; },
    get attempts() { return s.attempts; },
    get state() { return s.lost ? 'lost' : ch.map((c) => c.state).join('/'); },
    get lost() { return s.lost; },
    reset() { ch = ch.map(mk); Object.assign(s, { reps: 0, attempts: 0, lostSince: null, lost: false }); },
    // 中斷未完成的一下（換人、暫停後），次數保留
    interrupt() { ch = ch.map(mk); s.lostSince = null; s.lost = false; },
    // m：measure() 結果，量度不到時傳 null 或 ok=false。回傳事件：{type, ch?, msg?}
    update(m, t) {
      const ev = [];
      if (!m || !m.ok) {
        if (s.lostSince === null) s.lostSince = t;
        if (!s.lost && t - s.lostSince >= cfg.lostSeconds) { s.lost = true; ch = ch.map(mk); ev.push({ type: 'lost' }); }
        return ev;
      }
      s.lostSince = null;
      if (s.lost) { s.lost = false; ev.push({ type: 'back' }); }
      m.ch.forEach((x, i) => {
        const c = ch[i];
        if (c.state !== 'idle' && c.state !== 'rest') { c.frames++; if (m.fault) { c.faults++; c.faultMsg = m.fault; } }
        switch (c.state) {
          case 'idle':
            if (x.rest) c.state = 'rest';
            break;
          case 'rest':
            if (x.p >= cfg.startP && !x.rest) Object.assign(c, { state: 'moving', startT: t, maxP: x.p, frames: 1, faults: m.fault ? 1 : 0, faultMsg: m.fault || null });
            break;
          case 'moving':
            c.maxP = Math.max(c.maxP, x.p);
            if (x.p >= 1) c.state = 'peak';
            else if (x.rest) {
              c.state = 'rest';
              if (c.maxP >= cfg.attemptP) { s.attempts++; ev.push({ type: 'shallow', ch: i }); }
            }
            break;
          case 'peak':
            if (x.p < cfg.peakExitP) c.state = 'returning';
            break;
          case 'returning':
            if (x.p >= 1) c.state = 'peak';
            else if (x.rest) {
              c.state = 'rest';
              s.attempts++;
              if (t - c.startT < minRep) ev.push({ type: 'tooFast', ch: i });
              else if (c.faults / c.frames > cfg.faultRatio) ev.push({ type: 'fault', ch: i, msg: c.faultMsg });
              else { s.reps++; ev.push({ type: 'rep', ch: i }); }
            }
            break;
        }
      });
      return ev;
    },
  };
}

// 計時類（平板支撐）：姿勢正確先累積秒數；極短暫的量度中斷（holdGrace 內）不當作中斷
export function createHoldCounter({ cfg = CONFIG } = {}) {
  const init = () => ({ total: 0, best: 0, cur: 0, holding: false, lastT: null, badSince: null, pending: 0, breaks: 0, lost: false });
  let s = init();
  return {
    get seconds() { return s.total; },
    get best() { return Math.max(s.best, s.cur); },
    get current() { return s.cur; },
    get holding() { return s.holding; },
    get breaks() { return s.breaks; },
    get reps() { return s.total; },
    get attempts() { return 0; },
    get lost() { return s.lost; },
    get state() { return s.holding ? 'holding' : 'idle'; },
    reset() { s = init(); },
    interrupt() { if (s.holding) { s.best = Math.max(s.best, s.cur); s.cur = 0; s.holding = false; } s.lastT = null; s.badSince = null; s.pending = 0; },
    update(m, t) {
      const ev = [];
      const good = !!(m && m.ok && m.holding);
      const dt = s.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - s.lastT));
      s.lastT = t;
      if (good) {
        s.badSince = null;
        if (s.lost) { s.lost = false; ev.push({ type: 'back' }); }
        if (!s.holding) { s.holding = true; s.cur = 0; s.pending = 0; ev.push({ type: 'holdStart' }); }
        else { s.total += dt + s.pending; s.cur += dt + s.pending; s.pending = 0; }
        return ev;
      }
      if (s.badSince === null) s.badSince = t;
      if (s.holding) {
        s.pending += dt;
        if (t - s.badSince > cfg.holdGrace) {
          s.holding = false; s.pending = 0; s.best = Math.max(s.best, s.cur); s.breaks++;
          ev.push({ type: 'holdBreak', msg: m?.hint || null });
        }
      }
      if (!(m && m.ok) && !s.lost && t - s.badSince >= cfg.lostSeconds) { s.lost = true; ev.push({ type: 'lost' }); }
      return ev;
    },
  };
}
