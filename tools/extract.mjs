// 開發工具：用真姿勢模型由影片／相片抽出關鍵點，存成 JSON，供離線調校及回歸測試。
// 用法：node tools/extract.mjs <輸入檔> <輸出.json> [--start 秒] [--end 秒] [--fps 15] [--model full|lite] [--poses 2]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [input, output] = args;
const start = Number(opt('start', 0)), end = Number(opt('end', 1e9)), fps = Number(opt('fps', 15));
const model = opt('model', 'full'), poses = Number(opt('poses', 2));
const port = 4300 + Math.floor(Math.random() * 500);
const isImage = /\.(png|jpe?g|webp)$/i.test(input);

// 影片先用 ffmpeg 拆成逐幀相片（無頭瀏覽器逐幀 seek 不可靠）
let dir = null, count = 0;
if (!isImage) {
  dir = mkdtempSync(join(tmpdir(), 'sport-frames-'));
  const range = ['-ss', String(start), ...(end < 1e8 ? ['-to', String(end)] : [])];
  execFileSync('ffmpeg', ['-loglevel', 'error', ...range, '-i', input, '-vf', `fps=${fps},scale=-2:'min(720,ih)'`, '-q:v', '3', join(dir, '%05d.jpg')]);
  count = readdirSync(dir).length;
}
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { stdio: 'ignore', cwd: resolve(import.meta.dirname, '..') });
await new Promise((r) => setTimeout(r, 900));
const b = await chromium.launch();
try {
  const p = await b.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  const mime = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(input).toLowerCase()] || 'application/octet-stream';
  await p.route('**/__media', (r) => r.fulfill({ body: readFileSync(input), contentType: mime }));
  await p.route('**/__frame/*', (r) => r.fulfill({ body: readFileSync(join(dir, String(Number(r.request().url().split('/').pop()) + 1).padStart(5, '0') + '.jpg')), contentType: 'image/jpeg' }));
  await p.goto(`http://127.0.0.1:${port}/tools/blank.html`);
  const out = await p.evaluate(async ({ isImage, fps, model, poses, count }) => {
    const mod = await import('/vendor/tasks-vision/vision_bundle.mjs');
    const fileset = { wasmLoaderPath: '/vendor/tasks-vision/wasm/vision_wasm_internal.js', wasmBinaryPath: '/vendor/tasks-vision/wasm/vision_wasm_internal.wasm' };
    const lm = await mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate: 'CPU' },
      runningMode: isImage ? 'IMAGE' : 'VIDEO', numPoses: poses,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    const pack = (res) => ({
      poses: res.landmarks.map((l) => l.map((q) => [r4(q.x), r4(q.y), r4(q.z), r4(q.visibility ?? 0)])),
      world: res.worldLandmarks.map((l) => l.map((q) => [r4(q.x), r4(q.y), r4(q.z)])),
    });
    if (isImage) {
      const img = new Image(); img.src = '/__media'; await img.decode();
      return { fps: 0, aspect: img.naturalWidth / img.naturalHeight, frames: [{ t: 0, ...pack(lm.detect(img)) }] };
    }
    const frames = [];
    let aspect = 1;
    for (let i = 0; i < count; i++) {
      const bmp = await createImageBitmap(await (await fetch(`/__frame/${i}`)).blob());
      aspect = bmp.width / bmp.height;
      frames.push({ t: r4(i / fps), ...pack(lm.detectForVideo(bmp, Math.round((i / fps) * 1000) + 1)) });
      bmp.close();
    }
    return { fps, aspect, frames };
  }, { isImage, fps, model, poses, count });
  writeFileSync(output, JSON.stringify(out));
  console.log(`${output}: ${out.frames.length} 幀，有人的幀 ${out.frames.filter((f) => f.poses.length).length}`);
} finally { await b.close(); server.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); }
