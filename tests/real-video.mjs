// 真模型實測：用三張真人正面姿勢相片砌成模擬鏡頭影片，經 PoseLandmarker 計數。
// 用法：npm run test:real   （需要 ffmpeg；會先開本機伺服器）
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fx = resolve('tests/fixtures');
const dir = mkdtempSync(join(tmpdir(), 'sport-'));
// 站 9 秒（校準＋倒數）→ 5 下深蹲 → 1 下四分一蹲 → 站 2 秒，之後影片循環
const seq = [['stand', 9], ...Array(5).fill([['bottom', 1.3], ['stand', 1.3]]).flat(), ['quarter', 1.3], ['stand', 1.3], ['stand', 2]];
writeFileSync(join(dir, 'list.txt'), seq.map(([n, d]) => `file '${fx}/${n}.png'\nduration ${d}\n`).join('') + `file '${fx}/stand.png'\n`);
const y4m = join(dir, 'squat.y4m');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-r', '15', '-pix_fmt', 'yuv420p', y4m]);

const server = spawn('python3', ['-m', 'http.server', '4191', '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
let ok = false;
try {
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  await p.goto('http://127.0.0.1:4191/?cpu');
  await p.evaluate(() => localStorage.setItem('squat-challenge:settings', JSON.stringify({ difficulty: 'standard', sound: false, skeleton: true })));
  await p.reload();
  await p.getByRole('button', { name: '開始' }).click();
  await p.waitForFunction(() => !document.querySelector('#hud').classList.contains('hidden'), null, { timeout: 90000 });
  const t0 = Date.now();
  const counts = [];
  while (Date.now() - t0 < 40000) {
    counts.push(Number(await p.locator('#count').textContent()));
    await p.waitForTimeout(250);
  }
  const final = counts.at(-1);
  // 每個 27.6 秒循環有 5 下合格深蹲；40 秒內應數到 5–10 下，而且每次只加 1
  const steps = counts.slice(1).map((c, i) => c - counts[i]).filter((d) => d);
  console.log('計數變化：', [...new Set(counts)].join(' → '));
  ok = final >= 5 && final <= 10 && steps.every((d) => d === 1);
  console.log(ok ? `通過：40 秒內數到 ${final} 下` : `失敗：數到 ${final} 下`);
} finally {
  await b.close();
  server.kill();
}
process.exit(ok ? 0 : 1);
