// 用真人影片／相片抽出的關鍵點重播（見 tests/fixtures/landmarks/SOURCES.md），核對計數與人手數出來的真實次數一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replay } from '../tools/replay.mjs';
import { EXERCISES } from '../js/exercises.mjs';
import { makeFrame } from '../js/geometry.mjs';

const F = (n) => new URL(`./fixtures/landmarks/${n}.json`, import.meta.url).pathname;
const count = (file, ex, level, opts = {}) => replay(F(file), ex, { level, ...opts });
const still = (n) => {
  const d = JSON.parse(readFileSync(F(`still_${n}`), 'utf8')), f = d.frames[0];
  return makeFrame(f.poses[0].map(([x, y, z, visibility]) => ({ x, y, z, visibility })), f.world[0].map(([x, y, z]) => ({ x, y, z })), d.aspect);
};
const LV = ['easy', 'standard', 'strict'];

test('真人影片・開合跳：6 下（中間彎腰落地不計）', () => {
  for (const l of LV) assert.equal(count('jack_burpee', 'jack', l).score, 6, l);
});
test('真人影片・深蹲（側面）：6 下，彎腰擺壺鈴不計', () => {
  for (const l of LV) assert.equal(count('squat_raise', 'squat', l).score, 6, l);
});
test('真人影片・深蹲（側面剪影）：3 下，彎腰執嘢報犯規不計', () => {
  for (const l of LV) {
    const r = count('squat_kb_side', 'squat', l);
    assert.equal(r.score, 3, l);
    if (l === 'standard') assert.ok(r.log.some((e) => e.type === 'fault'), '彎腰應報犯規');
  }
});
test('真人影片・掌上壓（側面剪影）：3 下', () => {
  for (const l of LV) assert.equal(count('pushup_interval', 'pushup', l).score, 3, l);
});
test('真人影片・跪膝掌上壓：輕鬆級計 3 下；標準及嚴格級報「膝頭唔好落地」不計', () => {
  assert.equal(count('pushup_home', 'pushup', 'easy').score, 3);
  for (const l of ['standard', 'strict']) {
    const r = count('pushup_home', 'pushup', l);
    assert.equal(r.score, 0, l);
    assert.equal(r.log.filter((e) => e.type === 'fault' && /膝頭/.test(e.msg)).length, 3, l);
  }
});
test('真人影片・仰臥起坐（側面）：2 下', () => {
  for (const l of LV) assert.equal(count('situp_demo', 'situp', l).score, 2, l);
});
test('真人影片・仰臥起坐（黃昏、遠距離、斜後方、有途人）：輕鬆及標準級 5 下', () => {
  for (const l of ['easy', 'standard']) assert.equal(count('situp_tokyo', 'situp', l).score, 5, l);
  assert.ok(count('situp_tokyo', 'situp', 'strict').score <= 5);
});
test('真人影片・捲腹（只抬頭膊）：唔當仰臥起坐，0 下', () => {
  for (const l of LV) assert.equal(count('situp_home', 'situp', l).score, 0, l);
});
test('真人影片：做緊其他動作唔會被錯計', () => {
  // 頭 2.8 秒只有開合跳（之後的波比跳有落地蹲低，不在此列）
  assert.equal(count('jack_burpee', 'squat', 'standard', { to: 2.8 }).score, 0, '開合跳當深蹲');
  assert.equal(count('jack_burpee', 'knees', 'standard', { to: 2.8 }).score, 0, '開合跳當高抬腿');
  assert.equal(count('jack_burpee', 'situp', 'standard').score, 0, '開合跳當仰臥起坐');
  assert.equal(count('jack_burpee', 'pushup', 'easy', { to: 2.8 }).score, 0, '開合跳當掌上壓');
  assert.equal(count('squat_raise', 'jack', 'standard').score, 0, '深蹲當開合跳');
  assert.equal(count('squat_raise', 'pushup', 'standard').score, 0, '深蹲當掌上壓');
  assert.equal(count('squat_raise', 'situp', 'standard').score, 0, '深蹲當仰臥起坐');
  assert.equal(count('pushup_interval', 'squat', 'standard').score, 0, '掌上壓當深蹲');
  assert.equal(count('pushup_interval', 'situp', 'standard').score, 0, '掌上壓當仰臥起坐');
  assert.equal(count('situp_demo', 'pushup', 'standard').score, 0, '仰臥起坐當掌上壓');
  assert.equal(count('situp_demo', 'squat', 'standard').score, 0, '仰臥起坐當深蹲');
  assert.equal(count('squat_raise', 'plank', 'standard').score, 0, '企喺度當平板支撐');
});

test('真人相片・深蹲（正面）：企直及四分一蹲不到位，半蹲至水平到位', () => {
  for (const l of LV) {
    const base = {};
    const m = (n) => EXERCISES.squat.measure(still(n), base, l).ch[0];
    assert.ok(m('sq_stand').rest, l);
    assert.ok(m('sq_quarter').p < 0.3, l);
    if (l !== 'strict') assert.ok(m('sq_bottom').p >= 1, l);
  }
});
test('真人相片・高抬腿（正面）：膝頭到髖高到位；只係提起少少不到位', () => {
  for (const l of LV) {
    const hi = EXERCISES.knees.measure(still('knee_high'), {}, l).ch, lo = EXERCISES.knees.measure(still('knee_low'), {}, l).ch;
    assert.ok(Math.max(hi[0].p, hi[1].p) >= 1, `${l} 高`);
    assert.ok(Math.max(lo[0].p, lo[1].p) < 0.3 && lo.every((c) => c.rest), `${l} 低`);
  }
});
test('真人相片・平板支撐（側面）：正確姿勢計時；趴喺地上不計；企喺度不計', () => {
  for (const l of LV) {
    assert.equal(EXERCISES.plank.measure(still('plank_good'), {}, l).holding, true, l);
    assert.equal(EXERCISES.plank.measure(still('plank_good2'), {}, l).holding, true, l);
    assert.equal(EXERCISES.plank.measure(still('plank_flat'), {}, l).holding, false, l);
    assert.equal(EXERCISES.plank.measure(still('sq_stand'), {}, l).holding, false, l);
  }
});
