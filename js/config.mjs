// 所有判定門檻集中在這裏。調整方法見 README「門檻調整」。
// 三個判定級別：easy 輕鬆／standard 標準／strict 嚴格。
export const LEVELS = { easy: '輕鬆', standard: '標準', strict: '嚴格' };

export const THRESHOLDS = {
  // 深蹲：膝角（knee，真實角度；大腿水平 ≈ 90–100°）及髖部下降幅度（hipDrop，佔企直時髖到踝高度的比例）要同時達標。
  // 側面拍攝時直接用 2D 膝角；正面拍攝時 2D 膝角會失真，改用 3D 估算膝角（偏大，所以加 knee3Offset）。
  // 實測：側面真人深蹲膝角可到 40–100°、髖降 30–70%；彎腰執嘢膝角 111–145°、上身前傾 50–77°（不計）。
  // 正面真人相片：半蹲至大腿接近水平 ≈ 髖降 27%、3D 膝角 116°；四分一蹲 ≈ 髖降 4%、3D 膝角 158°。
  squat: {
    easy:     { knee: 125, hipDrop: 0.12 },
    standard: { knee: 110, hipDrop: 0.19 },
    strict:   { knee: 95,  hipDrop: 0.27 },
    knee3Offset: 12, kneeLeniency: 0.8, restKnee: 160, restDrop: 0.10, straightKnee: 165, leanMax: 60, minRep: 0.4,
  },
  // 掌上壓（側面）：手踭角要屈到 elbow 以下，同時膊頭要降低 drop（佔撐直時膊頭離地高度的比例）。
  // line = 膊–髖–踝夾角下限（身體要成一直線）。
  pushup: {
    easy:     { elbow: 115, drop: 0.22, line: 140 },
    standard: { elbow: 100, drop: 0.30, line: 150 },
    strict:   { elbow: 90,  drop: 0.38, line: 157 },
    restElbow: 150, straightElbow: 160, maxIncline: 40, minRep: 0.35,
  },
  // 仰臥起坐（側面）：上身與地面夾角要升到 up 以上，再瞓返落 down 以下。
  situp: {
    easy:     { up: 48, down: 35 },
    standard: { up: 60, down: 30 },
    strict:   { up: 70, down: 25 },
    minRep: 0.45,
  },
  // 開合跳（正面）：手臂舉高（髖–膊–腕夾角）及雙腳打開（兩腿夾角）要同時達標。
  jack: {
    easy:     { arm: 105, leg: 24 },
    standard: { arm: 125, leg: 30 },
    strict:   { arm: 145, leg: 36 },
    restArm: 55, restLeg: 19, armZero: 30, legZero: 12, minRep: 0.25,
  },
  // 高抬腿（正面）：lift = 膝頭升高幅度（1 = 膝頭到髖部高度）。左右腳各自計數。
  knees: {
    easy:     { lift: 0.55 },
    standard: { lift: 0.75 },
    strict:   { lift: 0.90 },
    restLift: 0.30, minRep: 0.12,
  },
  // 平板支撐（側面）：身體成一直線（line）、接近水平、膊頭離地夠高先計時。
  plank: {
    easy:     { line: 145 },
    standard: { line: 155 },
    strict:   { line: 162 },
    maxIncline: 35, minLift: 0.11,
  },
};

export const CONFIG = {
  minVis: 0.5,              // 關鍵點可信度下限
  lostSeconds: 0.6,         // 連續多久量度不到 → 當作離開，返回後要由起始姿勢重新開始
  readySeconds: 1.5,        // 預備姿勢要保持多久
  startP: 0.30,             // 進度超過此值 → 動作開始
  peakExitP: 0.80,          // 到位後跌穿此值 → 回程（遲滯，防止臨界抖動）
  attemptP: 0.55,           // 未到位但曾達此進度 → 記一次「未夠」
  faultRatio: 0.40,         // 一下之中姿勢犯規的幀數比例超過此值 → 不計
  holdGrace: 0.35,          // 平板支撐：短暫量度不到的寬限秒數
  trackHoldSeconds: 1.5,    // 鎖定的人消失多久當作「走咗」
  trackMatchMin: 0.12,      // 追蹤同一人每幀容許的最少移動（佔畫面闊度）
  filter: { minCutoff: 2.2, beta: 9, dCutoff: 1 },   // One Euro 平滑
};

export const STORAGE_PREFIX = 'sport-arena:';
export const MODELS = {
  full: { label: '高準確', local: './models/pose_landmarker_full.task', cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task' },
  lite: { label: '高速', local: './models/pose_landmarker_lite.task', cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
};
export const VISION_VERSION = '1.2.3';
export const VISION_LOCAL = './vendor/tasks-vision/vision_bundle.mjs';
export const WASM_LOCAL = './vendor/tasks-vision/wasm';
export const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.mjs`;
export const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
