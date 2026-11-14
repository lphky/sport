import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../js/config.mjs';
import { angle, checkFraming, createCounter, makeBaseline, measure, pickPose, rawMeasure } from '../js/squat-logic.mjs';
import { makePose, timeline } from './pose-sim.mjs';

const diff = DIFFICULTIES.standard;
const baseline = makeBaseline([rawMeasure(makePose(0))]);

function run(segments, d = diff) {
  const c = createCounter();
  const events = [];
  for (const f of timeline(segments)) {
    const m = f.phi === null ? null : measure(makePose(f.phi), baseline, d);
    events.push(...c.update(m, f.t));
  }
  return { reps: c.reps, attempts: c.attempts, events, state: c.state };
}

const fullSquat = [[0, 0.4], [60, 0.8], [60, 0.2], [0, 0.8]];

test('angle：直線 180°、直角 90°', () => {
  assert.equal(Math.round(angle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })), 180);
  assert.equal(Math.round(angle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })), 90);
});

test('完整深蹲 ×5 → 5', () => {
  const r = run([[0, 0.5], ...Array(5).fill(fullSquat).flat()]);
  assert.equal(r.reps, 5);
  assert.equal(r.attempts, 5);
});

test('半蹲 ×3 → 0 次，嘗試 3', () => {
  const half = [[0, 0.4], [12, 0.6], [0, 0.6]];
  const r = run([[0, 0.5], ...Array(3).fill(half).flat()]);
  assert.equal(r.reps, 0);
  assert.equal(r.attempts, 3);
  assert.equal(r.events.filter((e) => e === 'shallow').length, 3);
});

test('合格線附近抖動 → 不重複計數', () => {
  const m = measure(makePose(40), baseline, diff);
  assert.ok(m.score > 1, 'phi 40 應過合格線');
  const jitter = [];
  for (let i = 0; i < 20; i++) jitter.push([i % 2 ? 36 : 40, 0.1]);
  const r = run([[0, 0.5], [40, 0.8], ...jitter, [0, 0.8]]);
  assert.equal(r.reps, 1);
});

test('站立時輕微晃動 → 不算嘗試', () => {
  const sway = [];
  for (let i = 0; i < 20; i++) sway.push([i % 2 ? 0 : 8, 0.15]);
  const r = run([[0, 0.5], ...sway]);
  assert.equal(r.reps, 0);
  assert.equal(r.attempts, 0);
});

test('中途離開畫面 → 不誤計，回來要先站直', () => {
  const r = run([[0, 0.5], [60, 0.8], [null, 1.0], [60, 0.3], [0, 0.8]]);
  assert.equal(r.reps, 0);
  assert.ok(r.events.includes('lost'));
  assert.ok(r.events.includes('back'));
  const r2 = run([[0, 0.5], [60, 0.8], [null, 1.0], [0, 0.3], ...fullSquat]);
  assert.equal(r2.reps, 1);
});

test('短暫失去追蹤 (<0.5 秒) 不中斷', () => {
  const r = run([[0, 0.5], [60, 0.8], [null, 0.2], [60, 0.1], [0, 0.8]]);
  assert.equal(r.reps, 1);
});

test('極快動作 (<0.5 秒) → 不計', () => {
  const r = run([[0, 0.5], [60, 0.15], [0, 0.15], [0, 0.5]]);
  assert.equal(r.reps, 0);
  assert.ok(r.events.includes('tooFast'));
});

test('難度：同一深度在「深蹲」難度不合格', () => {
  const seg = [[0, 0.5], [16, 0.8], [16, 0.2], [0, 0.8]];
  assert.equal(run(seg, DIFFICULTIES.standard).reps, 1);
  assert.equal(run(seg, DIFFICULTIES.deep).reps, 0);
});

test('上身前傾 → lean 提示但照計', () => {
  const c = createCounter();
  const ev = [];
  let t = 0;
  for (const [phi, lean] of [[0, 0], [0, 0], ...Array(20).fill([30, 60]), ...Array(20).fill([60, 60]), ...Array(30).fill([0, 0])]) {
    t += 1 / 30;
    ev.push(...c.update(measure(makePose(phi, { lean }), baseline, diff), t));
  }
  assert.ok(ev.includes('lean'));
  assert.equal(c.reps, 1);
});

test('站位檢查', () => {
  assert.equal(checkFraming(makePose(0)).ok, true);
  const noAnkle = makePose(0);
  noAnkle[27].visibility = 0.1;
  const r = checkFraming(noAnkle);
  assert.equal(r.ok, false);
  assert.match(r.hint, /腳踝/);
  assert.equal(checkFraming(null).ok, false);
});

test('多人：揀可信度最高並提示', () => {
  const a = makePose(0, { visibility: 0.9 });
  const b = makePose(0, { visibility: 0.7, dx: 0.2 });
  const r = pickPose([b, a]);
  assert.equal(r.pose, a);
  assert.equal(r.multiple, true);
  assert.equal(pickPose([a]).multiple, false);
});

// 以真人正面相片經 PoseLandmarker 量得的數值（見 docs/TEST-RESULTS.md）
test('真人正面實測數值：大腿水平深蹲在「標準」及「深蹲」都合格，四分一蹲唔會開始計', () => {
  const stand = { hipY: 0.5246, ankleY: 0.8828, kneeAngle: 179.8, lean: 2 };
  const base = makeBaseline([stand]);
  const fake = (raw) => {
    const hipDrop = (raw.hipY - base.hipY) / base.legLen;
    return (d) => Math.max(hipDrop / d.hipDrop, (170 - raw.kneeAngle) / (170 - d.kneeAngle));
  };
  const bottom = fake({ hipY: 0.6208, kneeAngle: 143.3 });
  const quarter = fake({ hipY: 0.5386, kneeAngle: 172.7 });
  assert.ok(bottom(DIFFICULTIES.standard) >= 1);
  assert.ok(bottom(DIFFICULTIES.deep) >= 1);
  assert.ok(quarter(DIFFICULTIES.easy) < 0.3);
});
