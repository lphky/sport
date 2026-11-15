// 瀏覽器流程測試：用 ?sim 模式注入模擬關鍵點，不需要鏡頭及模型。
import { test, expect } from '@playwright/test';

// plans：每位（或旁觀者）一個 { move, segments, opts }；以 30fps 實時注入
async function drive(page, plans) {
  await page.evaluate(async (plans) => {
    const sim = await import('/tests/pose-sim.mjs');
    const tracks = plans.map((p) => sim.timeline(p.move, p.segments, { opts: p.opts || {} }));
    const n = Math.max(...tracks.map((t) => t.length));
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const i = Math.floor(((performance.now() - t0) / 1000) * 30);
        if (i >= n) { window.__sport.inject(tracks.map((t) => t.at(-1).lm).filter(Boolean)); return done(); }
        window.__sport.inject(tracks.map((t) => (t[i] ?? t.at(-1)).lm).filter(Boolean));
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, plans);
}
const reps = (n, d = 0.45, k = 1) => Array.from({ length: n }, () => [[k, d], [k, 0.12], [0, d], [0, 0.12]]).flat();
const L = { cx: 0.75, s: 0.6 }, R = { cx: 0.25, s: 0.6 };   // 畫面左邊 = 未鏡像座標右半

async function setupGame(page, { players = 1, ex = 'squat', mode = 'free', limit, level = 'standard', names = [] } = {}) {
  await page.goto('/?sim');
  await page.locator(`input[name=players][value="${players}"]`).check({ force: true });
  await page.locator(`input[name=ex][value="${ex}"]`).check({ force: true });
  await page.locator(`input[name=mode][value="${mode}"]`).check({ force: true });
  if (limit) await page.locator(`input[name=limit][value="${limit}"]`).check({ force: true });
  await page.locator(`input[name=level][value="${level}"]`).check({ force: true });
  for (const [i, n] of names.entries()) await page.locator(`#name${i}`).fill(n);
  await page.getByRole('button', { name: '開始' }).click();
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('ready');
}
const phase = (page) => page.evaluate(() => window.__sport.phase);
const scores = (page) => page.evaluate(() => window.__sport.scores);
// 預備姿勢 2 秒 + 倒數 3 秒
const READY = [[0, 6.2]];

const SOLO = [
  ['squat', 'squat', '深蹲'], ['pushup', 'pushup', '掌上壓'], ['situp', 'situp', '仰臥起坐'], ['jack', 'jack', '開合跳'],
];
for (const [ex, move, name] of SOLO) {
  test(`單人自由練習：${name} 3 下 → 計 3，結果畫面正確`, async ({ page }) => {
    await setupGame(page, { ex, names: ['小明'] });
    await drive(page, [{ move, segments: [...READY, ...reps(3), [0, 0.3]] }]);
    expect(await phase(page)).toBe('play');
    expect(await scores(page)).toEqual([3]);
    await expect(page.locator('#pp0 .pcount')).toHaveText('3');
    await page.getByRole('button', { name: /完成/ }).click();
    await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#resultPlayers .s')).toContainText('3');
    await expect(page.locator('#resultPlayers')).toContainText('小明');
    await expect(page.locator('#resultPlayers')).toContainText('新紀錄');
  });
}

test('單人：高抬腿左右各 3 次 → 6；提唔夠高唔計', async ({ page }) => {
  await setupGame(page, { ex: 'knees' });
  const alt = (k) => Array.from({ length: 3 }, () => [[k, 0.25, 'kneeL'], [0, 0.25], [0, 0.02, 'kneeR'], [k, 0.25], [0, 0.25], [0, 0.02, 'kneeL']]).flat();
  await drive(page, [{ move: 'kneeL', segments: [...READY, ...alt(1), ...alt(0.45), [0, 0.3]] }]);
  expect(await scores(page)).toEqual([6]);
});

test('單人：未做預備姿勢唔會開始；半蹲唔計並提示', async ({ page }) => {
  await setupGame(page);
  await drive(page, [{ move: 'squat', segments: [[0.6, 0.1], [0.6, 2.5]] }]);
  expect(await phase(page)).toBe('ready');
  await drive(page, [{ move: 'squat', segments: [...READY, ...reps(2, 0.45, 0.55), [0, 0.2]] }]);
  expect(await scores(page)).toEqual([0]);
  await expect(page.locator('#toast0')).toContainText('再蹲低啲');
});

test('計時賽 30 秒：時間到自動完結，成績入龍虎榜', async ({ page }) => {
  await setupGame(page, { mode: 'timed', limit: 30, names: ['阿強'] });
  await drive(page, [{ move: 'squat', segments: [...READY, ...reps(4), [0, 0.3]] }]);
  expect(await scores(page)).toEqual([4]);
  await expect(page.locator('#timerLabel')).toHaveText('剩餘秒數');
  await expect(page.locator('#result')).toBeVisible({ timeout: 40000 });
  await expect(page.locator('#resultPlayers .s')).toContainText('4');
  await page.getByRole('button', { name: /龍虎榜/ }).click();
  await expect(page.locator('#boardList')).toContainText('阿強');
  await expect(page.locator('#boardKey')).toContainText('深蹲・計時賽 30 秒・標準');
});

test('雙人目標賽：先做夠 10 下者勝；雙方各自計數', async ({ page }) => {
  await setupGame(page, { players: 2, ex: 'jack', mode: 'target', limit: 10, names: ['大文', '小芬'] });
  await expect(page.locator('#divider')).toBeVisible();
  await drive(page, [
    { move: 'jack', segments: [...READY, ...reps(10, 0.3), [0, 0.5]], opts: L },
    { move: 'jack', segments: [...READY, ...reps(6, 0.6), [0, 0.5]], opts: R },
  ]);
  await expect(page.locator('#result')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#resultTitle')).toContainText('大文 勝出');
  const s = await scores(page);
  expect(s[0]).toBe(10);
  expect(s[1]).toBeGreaterThanOrEqual(4);
  expect(s[1]).toBeLessThan(10);
  await page.screenshot({ path: 'test-results/result-2p.png' });
});

test('雙人：要兩位都做好預備姿勢先開始；旁觀者做動作唔計', async ({ page }) => {
  await setupGame(page, { players: 2 });
  await drive(page, [{ move: 'squat', segments: [[0, 3]], opts: L }]);
  expect(await phase(page)).toBe('ready');
  expect(await page.evaluate(() => window.__sport.ready)).toEqual([true, false]);
  await expect(page.locator('#ready0')).toContainText('等埋對手');
  // 右邊玩家入場；中間後面有旁觀者一齊深蹲
  await drive(page, [
    { move: 'squat', segments: [...READY, ...reps(3), [0, 0.3]], opts: L },
    { move: 'squat', segments: [...READY, ...reps(2, 0.7), [0, 0.3]], opts: R },
    { move: 'squat', segments: [...READY, ...reps(4, 0.35), [0, 0.3]], opts: { cx: 0.52, s: 0.35, floor: 0.6 } },
  ]);
  expect(await scores(page)).toEqual([3, 2]);
  await page.screenshot({ path: 'test-results/play-2p.png' });
});

test('雙人平板支撐鬥耐力：撐得耐者勝，跌低超過 3 秒自動完結', async ({ page }) => {
  await setupGame(page, { players: 2, ex: 'plank', mode: 'free', names: ['甲', '乙'] });
  await drive(page, [
    { move: 'plank', segments: [[0, 5.4], [0, 6], [1, 0.3], [1, 4]], opts: { cx: 0.75, s: 0.7 } },
    { move: 'plank', segments: [[0, 5.4], [0, 3], [1, 0.3], [1, 7]], opts: { cx: 0.25, s: 0.7 } },
  ]);
  await expect(page.locator('#result')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#resultTitle')).toContainText('甲 勝出');
  const s = await scores(page);
  expect(s[0]).toBeGreaterThan(5.5); expect(s[0]).toBeLessThan(7.6);
  expect(s[1]).toBeGreaterThan(2.6); expect(s[1]).toBeLessThan(4.6);
});

test('暫停會停止計時及計數；Esc 返回首頁', async ({ page }) => {
  await setupGame(page);
  await drive(page, [{ move: 'squat', segments: [...READY, ...reps(1), [0, 0.2]] }]);
  await page.keyboard.press('Space');
  await expect(page.locator('#pausedLayer')).toBeVisible();
  const t1 = await page.evaluate(() => window.__sport.elapsed);
  await drive(page, [{ move: 'squat', segments: [[0, 0.2], ...reps(2)] }]);
  expect(await page.evaluate(() => window.__sport.elapsed)).toBe(t1);
  expect(await scores(page)).toEqual([1]);
  await page.keyboard.press('Space');
  await drive(page, [{ move: 'squat', segments: [[0, 0.4], ...reps(1), [0, 0.2]] }]);
  expect(await scores(page)).toEqual([2]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
});

test('鎖定的人走咗唔會轉追旁人；撳畫面重新鎖定後繼續計', async ({ page }) => {
  await setupGame(page);
  const by = { cx: 0.2, s: 0.6 };
  await drive(page, [
    { move: 'squat', segments: [...READY, ...reps(1), [0, 0.3], [null, 0.1], [null, 4]] },
    { move: 'squat', segments: [[0, 5.4 + 1.5], [0, 2], ...reps(2, 0.4)], opts: by },
  ]);
  expect(await scores(page)).toEqual([1]);
  await expect(page.locator('#toast0')).toContainText('鎖定嘅人走咗');
  // 旁人喺未鏡像 x=0.2 → 畫面右邊 80%
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.62);
  await drive(page, [{ move: 'squat', segments: [[0, 0.6], ...reps(2), [0, 0.3]], opts: by }]);
  expect(await scores(page)).toEqual([3]);
});

test('鏡頭權限被拒絕／搵唔到鏡頭 → 顯示原因及「再試」', async ({ page }) => {
  for (const [err, text] of [['NotAllowedError', '鏡頭權限被拒絕'], ['NotFoundError', '搵唔到鏡頭']]) {
    await page.addInitScript((name) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('x', name));
    }, err);
    await page.goto('/');
    await page.getByRole('button', { name: '開始' }).click();
    await expect(page.locator('#msgTitle')).toHaveText(text, { timeout: 60000 });
    await expect(page.getByRole('button', { name: '再試' })).toBeVisible();
  }
});

test('版面：首頁及比賽畫面喺手機窄屏唔會重疊（截圖檢查）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await setupGame(page, { players: 2 });
  await drive(page, [
    { move: 'squat', segments: [...READY, ...reps(1), [0.6, 0.3]], opts: L },
    { move: 'squat', segments: [...READY, ...reps(1), [0, 0.3]], opts: R },
  ]);
  await page.screenshot({ path: 'test-results/play-mobile.png' });
  const a = await page.locator('#pp0').boundingBox(), b = await page.locator('#pp1').boundingBox(), c = await page.locator('.center-box').boundingBox();
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
  expect(c.y + c.height).toBeLessThanOrEqual(a.y + 1);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('深蹲：左右抬腳不加分，雙人同場正常深蹲照計', async ({ page }) => {
  await setupGame(page, { players: 2 });
  await drive(page, [
    { move: 'kneeL', segments: [...READY, ...reps(2), [0, 0.02, 'kneeR'], ...reps(2), [0, 0.3]], opts: L },
    { move: 'squat', segments: [...READY, ...reps(4), [0, 0.3]], opts: R },
  ]);
  expect(await scores(page)).toEqual([0, 4]);
  await drive(page, [
    { move: 'squat', segments: [[0, 0.5], ...reps(2), [0, 0.3]], opts: L },
    { move: 'squat', segments: [[0, 3.5]], opts: R },
  ]);
  expect(await scores(page)).toEqual([2, 4]);
});
