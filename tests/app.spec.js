import { test, expect } from '@playwright/test';

// 在瀏覽器內按真實時間逐幀注入模擬姿勢
async function play(page, segments) {
  await page.evaluate(async (segs) => {
    const { makePose, timeline } = await import('/tests/pose-sim.mjs');
    const frames = timeline(segs);
    const t0 = performance.now();
    for (const f of frames) {
      const wait = t0 + f.t * 1000 - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      window.__sport.inject(f.phi === null ? [] : [makePose(f.phi)]);
    }
  }, segments);
}
const squat = [[0, 0.4], [60, 0.8], [60, 0.2], [0, 0.8]];

test('自由模式：校準 → 倒數 → 數 3 下 → 半蹲不計 → 完成並保存紀錄', async ({ page }) => {
  await page.goto('/?sim');
  await expect(page.getByRole('heading', { name: /深蹲/ })).toBeVisible();
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('#toast')).toHaveText(/睇唔到你/);
  await play(page, [[0, 2.6]]);
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('countdown');
  await play(page, [[0, 3.6]]);
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('play');
  await play(page, [[0, 0.3], ...squat, ...squat, ...squat, [12, 0.6], [0, 0.8]]);
  await expect(page.locator('#count')).toHaveText('3');
  expect(await page.evaluate(() => window.__sport.attempts)).toBe(4);
  await page.getByRole('button', { name: /完成/ }).click();
  await expect(page.locator('#resultCount')).toHaveText('3');
  await expect(page.locator('#resultRate')).toHaveText('75%');
  await expect(page.locator('#resultRecord')).toBeVisible();
  await page.getByRole('button', { name: '返回首頁' }).click();
  await expect(page.locator('#records')).toContainText('3 下');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every((k) => k.startsWith('squat-challenge:'))).toBe(true);
});

test('目標模式 10 下：完成自動結束並記錄用時；離開畫面時提示', async ({ page }) => {
  await page.goto('/?sim');
  await page.getByRole('radio', { name: /目標模式/ }).check();
  await page.getByRole('radio', { name: '10 下' }).check();
  await page.getByRole('button', { name: '開始' }).click();
  await play(page, [[0, 6.4]]);
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('play');
  await play(page, [[0, 0.3], [null, 1]]);
  await expect(page.locator('#toast')).toHaveText(/睇唔到你/);
  await play(page, [[0, 0.5], ...Array(10).fill(squat).flat()]);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultCount')).toHaveText('10');
  await expect(page.locator('#records')).toBeHidden();
  await page.getByRole('button', { name: '返回首頁' }).click();
  await expect(page.locator('#records')).toContainText('秒');
});

test('暫停及 Esc 返回首頁不保存', async ({ page }) => {
  await page.goto('/?sim');
  await page.getByRole('button', { name: '開始' }).click();
  await play(page, [[0, 6.4]]);
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('play');
  await page.keyboard.press('Space');
  await expect(page.locator('#pausedLayer')).toBeVisible();
  const e1 = await page.evaluate(() => window.__sport.elapsed);
  await play(page, squat);
  expect(await page.evaluate(() => window.__sport.reps)).toBe(0);
  expect(await page.evaluate(() => window.__sport.elapsed)).toBeCloseTo(e1, 1);
  await page.keyboard.press('Space');
  await play(page, [[0, 0.3], ...squat]);
  await expect(page.locator('#count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#records')).not.toContainText('1 下');
});

test('真模型＋模擬鏡頭：載入本地模型並進入站位檢查', async ({ page }) => {
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('#game')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#toast')).toHaveText(/睇唔到|光線/, { timeout: 15000 });
  expect(logs.some((l) => l.includes('PoseLandmarker ready: ./models/'))).toBe(true);
  expect(external).toEqual([]);
  await page.screenshot({ path: 'test-results/setup-fake-camera.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
});

test('拒絕鏡頭權限：顯示原因及再試', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('#msgTitle')).toHaveText('鏡頭權限被拒絕');
  await expect(page.getByRole('button', { name: '再試' })).toBeVisible();
});

test('冇鏡頭／被佔用', async ({ page }) => {
  await page.addInitScript(() => {
    let n = 0;
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('x', n++ === 0 ? 'NotFoundError' : 'NotReadableError'));
  });
  await page.goto('/');
  await page.getByRole('button', { name: '開始' }).click();
  await expect(page.locator('#msgTitle')).toHaveText('搵唔到鏡頭');
  await page.getByRole('button', { name: '再試' }).click();
  await expect(page.locator('#msgTitle')).toHaveText('鏡頭被其他程式佔用');
});

test('手機窄螢幕版面不重疊', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('/?sim');
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button', { name: '開始' }).click();
  await play(page, [[0, 6.4]]);
  await page.screenshot({ path: 'test-results/play-mobile.png' });
  await page.close();
});

test('60 秒挑戰：時間到自動結束', async ({ page }) => {
  await page.clock.install();
  await page.goto('/?sim');
  await page.getByRole('radio', { name: /60 秒挑戰/ }).check();
  await page.getByRole('button', { name: '開始' }).click();
  await page.evaluate(async () => {
    const { makePose } = await import('/tests/pose-sim.mjs');
    window.__sport.inject([makePose(0)]);
  });
  await page.clock.runFor(2600);
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.__sport.phase)).toBe('play');
  await page.clock.runFor(30000);
  await expect(page.locator('#timer')).toHaveText(/^(29|30)$/);
  await page.clock.runFor(31000);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#resultMode')).toHaveText('60 秒挑戰');
  await expect(page.locator('#resultTime')).toHaveText('1:00.0');
});

test('多人：追蹤中間的人並畫框；旁人蹲都唔計；撳旁人可以轉追', async ({ page }) => {
  await page.goto('/?sim');
  await page.getByRole('button', { name: '開始' }).click();
  // 旁人（可信度較高、企喺左邊）不停深蹲；玩家企中間
  const run = (segs, sidePhi) => page.evaluate(async ([segs, sidePhi]) => {
    const { makePose, timeline } = await import('/tests/pose-sim.mjs');
    const t0 = performance.now();
    for (const f of timeline(segs)) {
      const wait = t0 + f.t * 1000 - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const side = makePose(sidePhi === 'squat' ? 60 * Math.abs(Math.sin(f.t * 2)) : 0, { dx: -0.32, visibility: 0.99 });
      window.__sport.inject([side, makePose(f.phi, { dx: 0.02, visibility: 0.85 })]);
    }
  }, [segs, sidePhi]);
  await run([[0, 2.6]], 'stand');
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('countdown');
  const people = await page.evaluate(() => window.__sport.people);
  expect(people.length).toBe(2);
  expect(Math.abs((await page.evaluate(() => window.__sport.trackedCx)) - 0.52)).toBeLessThan(0.01);
  await page.screenshot({ path: 'test-results/multi-person.png' });
  await run([[0, 3.6]], 'stand');
  await expect.poll(() => page.evaluate(() => window.__sport.phase)).toBe('play');
  const squat = [[0, 0.4], [60, 0.8], [60, 0.2], [0, 0.8]];
  await run([[0, 0.3], ...squat, ...squat], 'squat');
  await expect(page.locator('#count')).toHaveText('2');
  // 撳左邊旁人（畫面鏡像，旁人顯示喺右邊）
  const box = await page.locator('#stage').boundingBox();
  const geo = await page.evaluate(() => {
    const r = document.getElementById('overlay').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  const side = 0.5 - 0.32;
  // SIM 模式畫面比例 = 畫布比例，故 x 直接按闊度換算
  await page.mouse.click(box.x + geo.w * (1 - side), box.y + geo.h * 0.6);
  await expect(page.locator('#toast')).toHaveText(/已轉為追蹤/);
  await run([[0, 0.3]], 'stand');
  expect(Math.abs((await page.evaluate(() => window.__sport.trackedCx)) - side)).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.__sport.reps)).toBe(2);
});
