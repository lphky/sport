import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../js/player.mjs';
import { createTracker } from '../js/tracker.mjs';
import { createHoldCounter } from '../js/counter.mjs';
import { EXERCISES } from '../js/exercises.mjs';
import { makeFrame } from '../js/geometry.mjs';
import { MOVES, prone, reps, standing, supine, timeline } from './pose-sim.mjs';

const pose = (lm) => ({ lm, world: null });
function run(exercise, frames, { level = 'standard', zone = [0, 1], extra = () => [] } = {}) {
  const pl = createPlayer({ exercise, level, zone });
  const events = [];
  for (const f of frames) {
    const poses = [...(f.lm ? [pose(f.lm)] : []), ...extra(f)];
    events.push(...pl.update(poses, f.t, 1, 'play').events.map((e) => e.type));
  }
  return { score: pl.score, attempts: pl.counter.attempts, events, pl };
}
const lead = [[0, 0.5]];

for (const [ex, move] of [['squat', 'squat'], ['jack', 'jack'], ['pushup', 'pushup'], ['situp', 'situp']]) {
  test(`${EXERCISES[ex].name}：5 下完整動作 → 5`, () => {
    const r = run(ex, timeline(move, [...lead, ...reps(5)]));
    assert.equal(r.score, 5);
    assert.equal(r.attempts, 5);
  });
  test(`${EXERCISES[ex].name}：3 下做一半 → 0，並提示未夠`, () => {
    const r = run(ex, timeline(move, [...lead, ...reps(3, 0.6, 0.6, { squat: 0.55, jack: 0.6 }[ex] ?? 0.62)]));
    assert.equal(r.score, 0);
    assert.equal(r.events.filter((e) => e === 'shallow').length, 3);
  });
  test(`${EXERCISES[ex].name}：到位線附近抖動 → 只計 1`, () => {
    const jitter = Array.from({ length: 12 }, (_, i) => [i % 2 ? 0.93 : 1.0, 0.07]);
    const r = run(ex, timeline(move, [...lead, [0.95, 0.6], ...jitter, [0, 0.6], [0, 0.3]]));
    assert.equal(r.score, 1);
  });
  test(`${EXERCISES[ex].name}：起始姿勢附近晃動 → 0`, () => {
    const wobble = Array.from({ length: 20 }, (_, i) => [i % 2 ? 0.12 : 0, 0.15]);
    assert.equal(run(ex, timeline(move, [...lead, ...wobble])).score, 0);
  });
  test(`${EXERCISES[ex].name}：做到一半離開畫面 → 不計，返回後要重新由起始姿勢開始`, () => {
    const r = run(ex, timeline(move, [...lead, [1, 0.6], [null, 1.5], [0, 0.1], [0, 0.5], ...reps(2)]));
    assert.equal(r.score, 2);
    assert.ok(r.events.includes('lost') && r.events.includes('back'));
  });
  test(`${EXERCISES[ex].name}：極快動作（雜訊）→ 不計`, () => {
    const r = run(ex, timeline(move, [...lead, [1, 0.07], [0, 0.07], [0, 0.4]]));
    assert.equal(r.score, 0);
  });
  test(`${EXERCISES[ex].name}：未返回起始姿勢就再做 → 只計返回的次數`, () => {
    // 落到位 → 只升返一半 → 再落 → 完全返回：只算 1 下
    const r = run(ex, timeline(move, [...lead, [1, 0.6], [0.5, 0.4], [1, 0.4], [0, 0.6], [0, 0.3]]));
    assert.equal(r.score, 1);
  });
}

test('三個級別的門檻：同一個中等幅度動作，輕鬆計、嚴格不計', () => {
  for (const [ex, move, k] of [['squat', 'squat', 0.64], ['pushup', 'pushup', 0.72], ['situp', 'situp', 0.62], ['jack', 'jack', 0.8]]) {
    const frames = timeline(move, [...lead, ...reps(3, 0.6, 0.6, k)]);
    assert.equal(run(ex, frames, { level: 'easy' }).score, 3, `${ex} easy`);
    assert.equal(run(ex, frames, { level: 'strict' }).score, 0, `${ex} strict`);
  }
});

test('開合跳：只舉手唔開腳、只開腳唔舉手 → 0', () => {
  const armsOnly = timeline('jack', [...lead, ...reps(3)]).map((f) => ({ ...f, lm: standing({ arm: 12 + 158 * f.k }) }));
  const legsOnly = timeline('jack', [...lead, ...reps(3)]).map((f) => ({ ...f, lm: standing({ spread: 8 + 40 * f.k }) }));
  assert.equal(run('jack', armsOnly).score, 0);
  assert.equal(run('jack', legsOnly).score, 0);
});

test('高抬腿：左右交替各 5 次 → 10；提得唔夠高 → 0', () => {
  const alt = (k) => Array.from({ length: 5 }, () => [[k, 0.2, 'kneeL'], [0, 0.2], [0, 0.01, 'kneeR'], [k, 0.2], [0, 0.2], [0, 0.01, 'kneeL']]).flat();
  assert.equal(run('knees', timeline('kneeL', [...lead, ...alt(1)])).score, 10);
  const low = run('knees', timeline('kneeL', [...lead, ...alt(0.6)]));
  assert.equal(low.score, 0);
  assert.equal(low.events.filter((e) => e === 'shallow').length, 10);
});
test('高抬腿：企喺度深蹲或開合跳 → 0', () => {
  assert.equal(run('knees', timeline('jack', [...lead, ...reps(4)])).score, 0);
});

test('掌上壓：塌腰／翹臀 → 不計並報犯規；企喺度屈手 → 0', () => {
  for (const sag of [0.2, -0.2]) {
    const frames = timeline('pushup', [...lead, ...reps(3)], { opts: { sag } });
    const r = run('pushup', frames);
    assert.equal(r.score, 0, `sag ${sag}`);
    assert.equal(r.events.filter((e) => e === 'fault').length, 3);
  }
  const standingCurl = timeline('squat', [...lead, ...reps(3)]);
  assert.equal(run('pushup', standingCurl).score, 0);
});
test('掌上壓：只郁頭／手踭有雜訊但膊頭無落 → 0', () => {
  // 膊頭高度不變，只有手踭點左右飄（模擬偵測雜訊）
  const frames = timeline('pushup', [...lead, ...reps(4)]).map((f) => {
    const lm = prone({ elbow: 175 });
    for (const i of [13, 14]) lm[i].x += 0.09 * f.k;
    return { ...f, lm };
  });
  assert.equal(run('pushup', frames).score, 0);
});

test('仰臥起坐：企喺度彎腰、伸直腳瞓 → 0', () => {
  assert.equal(run('situp', timeline('squat', [...lead, ...reps(3)]).map((f) => ({ ...f, lm: standing({ lean: 70 * f.k }) }))).score, 0);
  assert.equal(run('situp', timeline('situp', [...lead, ...reps(3)], { opts: { legsFlat: true } })).score, 0);
});

test('深蹲：只係彎腰鞠躬 → 0', () => {
  const bow = timeline('squat', [...lead, ...reps(3)]).map((f) => ({ ...f, lm: standing({ lean: 75 * f.k }) }));
  assert.equal(run('squat', bow).score, 0);
});
test('深蹲：側面彎腰執嘢（膝頭有屈、上身打橫）→ 不計並報犯規', () => {
  const frames = timeline('squat', [...lead, ...reps(3)]).map((f) => {
    const lm = standing({ bend: 40 * f.k, lean: 80 * f.k });
    // 模擬側面：兩邊膊頭重疊
    lm[12].x = lm[11].x; lm[14].x = lm[13].x; lm[16].x = lm[15].x;
    return { ...f, lm };
  });
  const r = run('squat', frames);
  assert.equal(r.score, 0);
  assert.ok(r.events.includes('fault'));
});
test('深蹲：行近鏡頭後（身形變大）仍然準確', () => {
  const a = timeline('squat', [...lead, ...reps(2)]);
  const b = timeline('squat', [[0, 0.8], ...reps(3)], { opts: { s: 1.25, floor: 0.97 }, t0: a.at(-1).t });
  assert.equal(run('squat', [...a, ...b]).score, 5);
});

test('平板支撐：保持 5 秒 → 約 5 秒；塌腰、趴低都停止計時', () => {
  const r = run('plank', timeline('plank', [[0, 5.5]]));
  assert.ok(Math.abs(r.score - 5.5) < 0.2, `got ${r.score}`);
  const sagged = run('plank', timeline('plank', [[0, 2], [1, 0.3], [1, 3], [0, 0.3], [0, 2]]));
  assert.ok(sagged.score > 3.6 && sagged.score < 4.9, `got ${sagged.score}`);
  assert.ok(sagged.events.includes('holdBreak'));
  const flat = timeline('plank', [[0, 3]]).map((f) => ({ ...f, lm: prone({ flat: true, forearm: true }) }));
  assert.equal(run('plank', flat).score, 0);
  const high = run('plank', timeline('plank', [[0, 3]]).map((f) => ({ ...f, lm: prone({ elbow: 175 }) })));
  assert.ok(high.score > 2.7, '撐直手的平板支撐亦計');
});
test('平板支撐：慢電腦每秒只得 2 幀仍計足時間；中途停咗好耐（切換分頁）唔計', () => {
  const slow = createHoldCounter();
  for (let t = 0; t <= 10; t += 0.5) slow.update({ ok: true, holding: true }, t);
  assert.ok(Math.abs(slow.seconds - 10) < 0.01, `got ${slow.seconds}`);
  const gap = createHoldCounter();
  gap.update({ ok: true, holding: true }, 0); gap.update({ ok: true, holding: true }, 1); gap.update({ ok: true, holding: true }, 30);
  assert.ok(gap.seconds <= 2, `got ${gap.seconds}`);
});
test('平板支撐：企喺度 → 0', () => {
  assert.equal(run('plank', timeline('squat', [[0, 3]])).score, 0);
});

test('預備姿勢：要連續保持 1.5 秒先完成', () => {
  const pl = createPlayer({ exercise: 'squat' });
  let t = 0;
  const step = (lm, secs) => { for (let i = 0; i < secs * 30; i++) { t += 1 / 30; pl.update(lm ? [pose(lm)] : [], t, 1, 'ready'); } };
  step(standing({ bend: 30 }), 2); assert.equal(pl.isReady, false);
  step(standing(), 1); assert.equal(pl.isReady, false);
  step(standing({ bend: 30 }), 0.3); step(standing(), 1); assert.equal(pl.isReady, false, '中途郁咗要重新計');
  step(standing(), 0.7); assert.equal(pl.isReady, true);
  step(null, 0.5); assert.equal(pl.isReady, false, '走開要重新預備');
});
test('預備姿勢：各動作的正確與錯誤姿勢', () => {
  const ready = (ex, lm) => EXERCISES[ex].measure(makeFrame(lm, null, 1), {}, 'standard').ready;
  assert.ok(ready('squat', standing()) && ready('jack', standing()) && ready('knees', standing()));
  assert.ok(!ready('jack', standing({ arm: 90 })));
  assert.ok(ready('pushup', prone()) && !ready('pushup', prone({ elbow: 100 })) && !ready('pushup', standing()));
  assert.ok(ready('situp', supine()) && !ready('situp', supine({ torso: 70 })) && !ready('situp', standing()));
  assert.ok(ready('plank', prone({ forearm: true })) && !ready('plank', prone({ forearm: true, flat: true })));
  assert.ok(!ready('squat', standing({ s: 0.3 })), '太遠');
});

// ---------- 追蹤 ----------
test('追蹤：多人時揀範圍中間的人；鎖定後旁人行到中間都唔轉', () => {
  const tr = createTracker();
  const P = (cx) => pose(standing({ cx, s: 0.8 }));
  assert.equal(tr.update([P(0.2), P(0.55), P(0.85)], 0).index, 1);
  assert.equal(tr.update([P(0.5), P(0.6)], 0.1).index, 1, '旁人行到正中都唔轉');
});
test('追蹤：鎖定的人走咗唔自動轉人；返回原位接返；撳畫面可重新鎖定', () => {
  const tr = createTracker();
  const P = (cx) => pose(standing({ cx, s: 0.8 }));
  tr.update([P(0.5), P(0.2)], 0);
  let r = tr.update([P(0.2)], 1); assert.equal(r.pose, null); assert.equal(r.lost, false);
  r = tr.update([P(0.2)], 3); assert.equal(r.pose, null); assert.equal(r.lost, true);
  r = tr.update([P(0.2), P(0.52)], 4); assert.equal(r.index, 1, '返回原位接返');
  tr.update([P(0.2)], 6.1);
  assert.equal(tr.selectAt(0.2, 0.6, [P(0.2)], 6.2), true);
  assert.equal(tr.update([P(0.2)], 6.3).index, 0);
});
test('雙人：左右範圍各自追蹤、各自計數，互不影響；旁觀者不計', () => {
  const a = createPlayer({ exercise: 'squat', zone: [0.5, 1] });
  const b = createPlayer({ exercise: 'squat', zone: [0, 0.5] });
  const fa = timeline('squat', [[0, 0.5], ...reps(5, 0.5, 0.5)], { opts: { cx: 0.75, s: 0.7 } });
  const fb = timeline('squat', [[0, 0.5], ...reps(3, 0.9, 0.8)], { opts: { cx: 0.25, s: 0.7 } });
  // 旁觀者企喺正中後面，佢都做深蹲
  const fc = timeline('squat', [[0, 0.5], ...reps(5, 0.5, 0.5)], { opts: { cx: 0.5, s: 0.45, floor: 0.7 } });
  for (let i = 0; i < fa.length; i++) {
    const poses = [pose(fc[i].lm), pose(fa[i].lm), pose((fb[i] ?? fb.at(-1)).lm)];
    const ra = a.update(poses, fa[i].t, 1, 'play');
    b.update(poses, fa[i].t, 1, 'play', [ra.index]);
  }
  assert.equal(a.score, 5);
  assert.equal(b.score, 3);
});
test('雙人：一位玩家走開，另一位唔會被當成佢', () => {
  const a = createPlayer({ exercise: 'jack', zone: [0.5, 1] });
  const b = createPlayer({ exercise: 'jack', zone: [0, 0.5] });
  const fb = timeline('jack', [[0, 0.5], ...reps(4)], { opts: { cx: 0.25, s: 0.7 } });
  fb.forEach((f, i) => {
    const poses = [pose(f.lm), ...(i < 10 ? [pose(standing({ cx: 0.75, s: 0.7 }))] : [])];
    const ra = a.update(poses, f.t, 1, 'play');
    b.update(poses, f.t, 1, 'play', [ra.index].filter((x) => x >= 0));
  });
  assert.equal(a.score, 0);
  assert.equal(b.score, 4);
});
void MOVES; void supine;
