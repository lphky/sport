// 真模型端到端測試：用真人姿勢相片砌成模擬鏡頭影片，經真正的 PoseLandmarker 及遊戲畫面計數。
// 用法：npm run test:real   （需要 ffmpeg；可加場景名只跑一個：node tests/real-video.mjs squat2p）
// 加 --url https://... 可測試已發佈的網站。
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fx = resolve('tests/fixtures');
const dir = mkdtempSync(join(tmpdir(), 'sport-real-'));
const args = process.argv.slice(2);
const urlArg = args.indexOf('--url') >= 0 ? args[args.indexOf('--url') + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');
const ff = (a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const LEAD = 30;   // 開頭保持預備姿勢的秒數（等模型載入、預備及倒數）

// 單人畫面：直接用相片；雙人畫面：左右各取一張相片的中間一半
function frameFile(a, b) {
  if (!b) return `${fx}/${a}.jpg`;
  const out = join(dir, `${a}__${b}.jpg`);
  ff(['-i', `${fx}/${a}.jpg`, '-i', `${fx}/${b}.jpg`, '-filter_complex', '[0:v]scale=1280:720,crop=640:720:320:0[l];[1:v]scale=1280:720,crop=640:720:320:0[r];[l][r]hstack', '-frames:v', '1', '-update', '1', out]);
  return out;
}
function buildVideo(name, seq) {
  const list = join(dir, `${name}.txt`);
  writeFileSync(list, seq.map(([a, b, d]) => `file '${frameFile(a, b)}'\nduration ${d}\n`).join('') + `file '${frameFile(seq.at(-1)[0], seq.at(-1)[1])}'\n`);
  const out = join(dir, `${name}.mjpeg`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=1280:720,fps=30', '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', '6', out]);
  return out;
}
const cyc = (n, up, rest, d, upB = rest, restB = rest) => Array(n).fill([[up, upB, d], [rest, restB, d]]).flat();
const solo = (seq) => seq.map(([a, , d]) => [a, null, d]);

const SCENARIOS = {
  // 5 下到位深蹲 + 1 下四分一蹲 → 5
  squat: {
    setup: { players: 1, ex: 'squat', mode: 'free' },
    seq: solo([['sq_stand', 0, LEAD], ...cyc(5, 'sq_bottom', 'sq_stand', 1.3), ['sq_quarter', 0, 1.3], ['sq_stand', 0, 40]]),
    wait: 16, check: (s) => s[0] === 5,
  },
  // 雙人：畫面左邊的人 5 下、右邊的人 3 下（另加四分一蹲不計）。鏡像後：相片左邊 = 畫面右邊玩家
  squat2p: {
    setup: { players: 2, ex: 'squat', mode: 'free' },
    seq: [['sq_stand', 'sq_stand', LEAD], ...cyc(3, 'sq_bottom', 'sq_stand', 1.3, 'sq_bottom', 'sq_stand'), ...cyc(2, 'sq_stand', 'sq_stand', 1.3, 'sq_bottom', 'sq_stand'), ['sq_quarter', 'sq_quarter', 1.3], ['sq_stand', 'sq_stand', 40]],
    wait: 16, check: (s) => s[0] === 5 && s[1] === 3,
  },
  // 高抬腿：4 次提膝到髖高 → 4；細步（只提起少少）不計
  knees: {
    setup: { players: 1, ex: 'knees', mode: 'free' },
    seq: solo([['sq_stand', 0, LEAD], ['knee_low', 0, 2], ...cyc(4, 'knee_high', 'knee_low', 1.2), ['knee_low', 0, 40]]),
    wait: 15, check: (s) => s[0] === 4,
  },
  // 平板支撐鬥耐力：正確姿勢保持，之後趴低 → 自動完結，成績 ≈ 全場用時 − 3 秒
  plank: {
    setup: { players: 1, ex: 'plank', mode: 'free' },
    seq: solo([['plank_good', 0, LEAD + 8], ['plank_flat', 0, 40]]),
    plank: true,
  },
};

const port = 4191;
const server = urlArg ? null : spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore' });
const base = urlArg || `http://127.0.0.1:${port}/`;
await new Promise((r) => setTimeout(r, 800));
mkdirSync('test-results', { recursive: true });
let failed = 0;
for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  const video = buildVideo(name, sc.seq);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  try {
    const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
    const external = new Set();
    p.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', new URL(base).hostname].includes(u.hostname) && u.protocol.startsWith('http')) external.add(u.hostname); });
    await p.goto(base + (base.includes('?') ? '&' : '?') + 'cpu');
    await p.evaluate((s) => {
      localStorage.setItem('sport-arena:setup', JSON.stringify({ level: 'standard', timed: 60, target: 20, names: ['', ''], ...s }));
      localStorage.setItem('sport-arena:settings', JSON.stringify({ sound: false, debug: true, model: 'full', camera: '' }));
    }, sc.setup);
    await p.reload();
    await p.getByRole('button', { name: '開始' }).click();
    if (args.includes('--debug')) p.on('console', (m) => console.log('[page]', m.text().slice(0, 200)));
    try {
      await p.waitForFunction(() => document.querySelector('#timerLabel')?.textContent === '用時', null, { timeout: 120000 });
    } catch (e) {
      await p.screenshot({ path: `test-results/real-${name}-timeout.png` });
      throw new Error(`未能開始：${await p.evaluate(() => [document.querySelector('#msgTitle')?.textContent, document.querySelector('#ready0 p')?.textContent, document.querySelector('#gameHint')?.textContent].join(' | '))}`);
    }
    const read = () => p.evaluate(() => [...document.querySelectorAll('.pp:not([style*="none"]) .pcount')].map((e) => Number(e.textContent)));
    let ok, detail;
    if (sc.plank) {
      await p.waitForSelector('#result:not(.hidden)', { timeout: 90000 });
      const score = Number((await p.locator('#resultPlayers .s').textContent()).replace(/[^\d.]/g, ''));
      const total = Number((await p.locator('#resultNote').textContent()).match(/([\d.]+) 秒/)[1]);
      ok = score > 3 && Math.abs(total - 3 - score) < 1.5;
      detail = `支撐 ${score} 秒，全場 ${total} 秒`;
    } else {
      const seen = [];
      const t0 = Date.now();
      // 由開始計數起，觀察到片段完結後一段時間
      while (Date.now() - t0 < (LEAD + sc.wait) * 1000) { seen.push((await read()).slice(0, sc.setup.players)); await p.waitForTimeout(300); if (sc.check(seen.at(-1)) && Date.now() - t0 > 12000 && seen.length > 60) break; }
      await p.screenshot({ path: `test-results/real-${name}.png` });
      const final = seen.at(-1);
      // 計數只可以每次加 1，而且穩定在預期數值
      const steps = seen.slice(1).every((s, i) => s.every((v, k) => v - seen[i][k] === 0 || v - seen[i][k] === 1));
      await p.waitForTimeout(3000);
      const later = (await read()).slice(0, sc.setup.players);
      ok = sc.check(final) && steps && sc.check(later);
      detail = `計數 ${JSON.stringify(final)}（3 秒後 ${JSON.stringify(later)}）`;
    }
    const ext = external.size ? `；有連去外部：${[...external].join(', ')}` : '；無連去其他網站';
    console.log(`${ok ? '通過' : '失敗'}  ${name}：${detail}${ext}`);
    if (!ok) failed++;
  } catch (e) {
    failed++;
    console.log(`失敗  ${name}：${e.message.split('\n')[0]}`);
  } finally { await b.close(); }
}
server?.kill();
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
