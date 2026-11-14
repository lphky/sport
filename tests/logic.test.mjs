import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES } from '../js/config.mjs';
import { angle, checkFraming, createCounter, createTracker, makeBaseline, measure, rawMeasure } from '../js/squat-logic.mjs';
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

test('多人：揀畫面最中間的人，即使旁人可信度較高', () => {
  const side = makePose(0, { visibility: 0.99, dx: -0.3 });
  const mid = makePose(0, { visibility: 0.8, dx: 0.05 });
  const tr = createTracker();
  const r = tr.update([side, mid], 0);
  assert.equal(r.pose, mid);
  assert.equal(r.multiple, true);
  assert.deepEqual(r.people.map((p) => p.tracked), [false, true]);
  assert.equal(createTracker().update([mid], 0).multiple, false);
});

test('鎖定後：有人行入中間都繼續追原本的人', () => {
  const tr = createTracker();
  const me = (dx) => makePose(0, { dx });
  tr.update([me(0.1)], 0);
  // 玩家稍為移動，另一人站到正中
  let t = 0;
  for (let i = 0; i < 30; i++) {
    t += 1 / 30;
    const r = tr.update([makePose(0, { dx: 0 }), me(0.1 + i * 0.003)].reverse(), t);
    assert.ok(Math.abs(r.pose[0].x - (0.6 + i * 0.003)) < 1e-9, '應追原本的人');
  }
});

test('鎖定的人走咗：唔自動轉追旁人，等撳選重新鎖定；返原位會自動接返', () => {
  const tr = createTracker();
  const me = makePose(0, { dx: 0.25 });
  const other = makePose(0, { dx: -0.05 });
  tr.update([me], 0);
  let r = tr.update([other], 0.5);
  assert.equal(r.pose, null);
  assert.equal(r.lost, false, '短暫消失未算走咗');
  r = tr.update([me, other], 1.0);
  assert.equal(r.pose, me);
  for (const t of [3, 10, 60]) {
    r = tr.update([other], t);
    assert.equal(r.pose, null, '走咗好耐都唔會轉追旁人');
    assert.equal(r.lost, true);
    assert.equal(tr.lost, true);
  }
  // 撳旁人重新鎖定
  assert.equal(tr.selectAt(0.45, 0.5, [other], 61), true);
  r = tr.update([other], 61.1);
  assert.equal(r.pose, other);
  assert.equal(r.lost, false);
  // 再走咗，原本嗰位返嚟原位都唔會搶走鎖定（距離太遠）
  r = tr.update([me], 70);
  assert.equal(r.pose, null);
  assert.equal(r.lost, true);
  // 鎖定的人返到原位：自動接返
  r = tr.update([me, other], 71);
  assert.equal(r.pose, other);
  assert.equal(r.lost, false);
});

test('未鎖定（站位階段）每幀揀最中間；撳選可手動指定', () => {
  const tr = createTracker();
  const a = makePose(0, { dx: 0.2 });
  const b = makePose(0, { dx: -0.3 });
  assert.equal(tr.update([a], 0, false).pose, a);
  const c = makePose(0, { dx: 0 });
  assert.equal(tr.update([a, c], 0.1, false).pose, c);
  assert.equal(tr.selectAt(0.2, 0.5, [a, b, c], 0.2), true);
  assert.equal(tr.update([a, b, c], 0.3, false).pose, b, '手動指定後唔會被自動揀中間覆蓋');
  assert.equal(tr.selectAt(0.95, 0.05, [a, b, c], 0.4), false);
});

test('換人時中斷未完成的一下但保留次數', () => {
  const c = createCounter();
  const base = makeBaseline([rawMeasure(makePose(0))]);
  let t = 0;
  for (const phi of [0, 0, 30, 60, 60, 30, 0, 0]) { t += 0.3; c.update(measure(makePose(phi), base, diff), t); }
  assert.equal(c.reps, 1);
  for (const phi of [0, 30, 60]) { t += 0.3; c.update(measure(makePose(phi), base, diff), t); }
  c.interrupt();
  for (const phi of [60, 30, 0, 0]) { t += 0.3; c.update(measure(makePose(phi), base, diff), t); }
  assert.equal(c.reps, 1);
  assert.equal(c.state, 'standing');
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
