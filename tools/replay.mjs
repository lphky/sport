// 開發工具：用 extract.mjs 抽出的關鍵點重播，檢視計數結果及訊號。
// 用法：node tools/replay.mjs <關鍵點.json> <動作> [--level standard] [--from 秒] [--to 秒] [--trace] [--zone 0,1]
import { readFileSync } from 'node:fs';
import { createPlayer } from '../js/player.mjs';

export function loadPoses(file) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  return { aspect: d.aspect, frames: d.frames.map((f) => ({
    t: f.t,
    poses: f.poses.map((l, i) => ({ lm: l.map(([x, y, z, visibility]) => ({ x, y, z, visibility })), world: f.world?.[i]?.map(([x, y, z]) => ({ x, y, z })) ?? null })),
  })) };
}
export function replay(file, exercise, { level = 'standard', from = 0, to = 1e9, zone = [0, 1], trace = false, skipReady = true } = {}) {
  const { aspect, frames } = loadPoses(file);
  const pl = createPlayer({ exercise, level, zone });
  const log = [];
  for (const f of frames) {
    if (f.t < from || f.t > to) continue;
    const r = pl.update(f.poses, f.t, aspect, 'play');
    for (const e of r.events) log.push({ t: f.t, ...e });
    if (trace) {
      const m = r.m;
      console.log(f.t.toFixed(2), pl.counter.state.padEnd(12), m ? (m.ok ? (m.ch.map((c) => `${c.p.toFixed(2)}${c.rest ? 'r' : ' '}`).join(' ') + (m.holding != null ? (m.holding ? ' HOLD' : ' -') : '')) : `✗ ${m.hint}`) : '（無人）',
        m?.dbg ? Object.entries(m.dbg).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' ') : '', m?.fault ? `⚠${m.fault}` : '', r.events.map((e) => e.type).join(','));
    }
  }
  return { score: pl.score, attempts: pl.counter.attempts, log, player: pl };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const r = replay(a[0], a[1], { level: opt('level', 'standard'), from: Number(opt('from', 0)), to: Number(opt('to', 1e9)), zone: opt('zone', '0,1').split(',').map(Number), trace: a.includes('--trace') });
  console.log(`結果：${r.score.toFixed?.(1) ?? r.score}，嘗試 ${r.attempts}`);
  console.log(r.log.map((e) => `${e.t.toFixed(1)}s ${e.type}${e.msg ? `(${e.msg})` : ''}`).join('\n'));
}
