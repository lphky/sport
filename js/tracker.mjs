import { CONFIG } from './config.mjs';
import { personBox } from './geometry.mjs';

// 追蹤一個人並鎖定。zone = 此玩家的範圍（未鏡像的橫向座標 0–1）；單人時為整個畫面。
// 未鎖定時揀範圍內最接近範圍中心的人；鎖定後只跟同一人。
// 鎖定的人走咗（超過 trackHoldSeconds）不會自動轉人：返回原位會接返，或者撳畫面重新鎖定。
// poses：[{ lm, world }]。update() 回傳 { pose, index, lost }
export function createTracker({ zone = [0, 1], cfg = CONFIG, reacquire = false } = {}) {
  let lock = null; // { cx, cy, size, seenT, manual, lost }
  const center = (zone[0] + zone[1]) / 2;
  const inZone = (b) => b.cx >= zone[0] && b.cx < zone[1];
  const d2 = (b, x, y) => Math.hypot(b.cx - x, b.cy - y);
  const matches = (b) => {
    const ratio = b.size / Math.max(0.01, lock.size);
    return d2(b, lock.cx, lock.cy) <= Math.max(cfg.trackMatchMin, lock.size * 0.45) && ratio > 0.4 && ratio < 2.5;
  };
  const keep = (c, t, manual) => { lock = { cx: c.box.cx, cy: c.box.cy, size: c.box.size, seenT: t, manual, lost: false }; };
  return {
    zone,
    get locked() { return !!lock; },
    get lost() { return !!lock?.lost; },
    reset() { lock = null; },
    // x, y：未鏡像的畫面座標（0–1）。成功鎖定回傳 true。
    selectAt(x, y, poses, t) {
      if (x < zone[0] || x >= zone[1]) return false;
      const hit = (poses || []).map((p, index) => ({ p, index, box: personBox(p.lm) }))
        .filter(({ box: b }) => x >= b.x0 - 0.03 && x <= b.x1 + 0.03 && y >= b.y0 - 0.05 && y <= b.y1 + 0.05);
      if (!hit.length) return false;
      keep(hit.reduce((a, c) => (d2(c.box, x, y) < d2(a.box, x, y) ? c : a)), t, true);
      return true;
    },
    // taken：其他玩家已佔用的 pose 索引。autoLock=false：未手動指定時每幀重新揀（預備階段未企定時用）
    update(poses, t, { autoLock = true, taken = [] } = {}) {
      if (!autoLock && lock && !lock.manual) lock = null;
      const list = (poses || []).map((p, index) => ({ p, index, box: personBox(p.lm) })).filter((x) => !taken.includes(x.index));
      let chosen = null;
      if (lock) {
        const m = list.filter((x) => matches(x.box));
        if (m.length) chosen = m.reduce((a, c) => (d2(c.box, lock.cx, lock.cy) < d2(a.box, lock.cx, lock.cy) ? c : a));
        else {
          if (t - lock.seenT > cfg.trackHoldSeconds) lock.lost = true;
          // reacquire（只供離線重播工具用）：走咗就重新揀人
          if (lock.lost && reacquire) { lock = null; return this.update(poses, t, { autoLock, taken }); }
          return { pose: null, index: -1, lost: lock.lost };
        }
      } else {
        const cand = list.filter((x) => inZone(x.box) && x.box.coreVis >= cfg.minVis);
        if (cand.length) chosen = cand.reduce((a, c) => (Math.abs(c.box.cx - center) < Math.abs(a.box.cx - center) ? c : a));
      }
      if (!chosen) return { pose: null, index: -1, lost: false };
      keep(chosen, t, !!lock?.manual);
      return { pose: chosen.p, index: chosen.index, lost: false };
    },
  };
}
