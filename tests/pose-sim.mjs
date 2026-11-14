// 以簡單幾何生成模擬關鍵點：phi = 小腿前傾角（度），0 = 站直。
export function makePose(phi = 0, { dx = 0, visibility = 0.99, lean = 0 } = {}) {
  const L = 0.2, ay = 0.9, r = (phi * Math.PI) / 180;
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5 + dx, y: 0.5, z: 0, visibility }));
  const hipY = ay - 2 * L * Math.cos(r);
  const leanR = (lean * Math.PI) / 180;
  for (const [side, off] of [['l', -0.05], ['r', 0.05]]) {
    const ax = 0.5 + off + dx;
    const ankle = { x: ax, y: ay };
    const knee = { x: ax + L * Math.sin(r), y: ay - L * Math.cos(r) };
    const hip = { x: ax, y: hipY };
    const sh = { x: ax + 0.25 * Math.sin(leanR), y: hipY - 0.25 * Math.cos(leanR) };
    const idx = side === 'l' ? { s: 11, h: 23, k: 25, a: 27 } : { s: 12, h: 24, k: 26, a: 28 };
    Object.assign(pts[idx.a], ankle);
    Object.assign(pts[idx.k], knee);
    Object.assign(pts[idx.h], hip);
    Object.assign(pts[idx.s], sh);
  }
  Object.assign(pts[0], { x: 0.5 + dx, y: hipY - 0.33 });
  return pts;
}

// 由一串 [phi, 秒數] 片段生成逐幀序列（30fps，線性插值）
export function timeline(segments, fps = 30) {
  const frames = [];
  let t = 0, cur = segments[0][0];
  for (const [target, secs] of segments) {
    const n = Math.max(1, Math.round(secs * fps));
    for (let i = 1; i <= n; i++) {
      t += 1 / fps;
      frames.push({ t, phi: target === null ? null : cur + ((target - cur) * i) / n });
    }
    if (target !== null) cur = target;
  }
  return frames;
}
