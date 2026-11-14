// 所有計數門檻集中在這裏。調整說明見 README.md「計數門檻調整」。
// 正面面向鏡頭時，2D 投影會令膝角及髖降看起來細過實際。
// 以真人正面相片實測：大腿水平的深蹲 ≈ 髖降 27%、膝角 143°；四分一蹲 ≈ 髖降 4%、膝角 173°。
// 任一項達標即算到底（hipDrop 或 kneeAngle）。
export const DIFFICULTIES = {
  easy:     { label: '輕鬆', hipDrop: 0.15, kneeAngle: 155 },
  standard: { label: '標準', hipDrop: 0.20, kneeAngle: 150 },
  deep:     { label: '深蹲', hipDrop: 0.25, kneeAngle: 145 },
};

export const CONFIG = {
  // 站直判定
  standKneeMin: 160,          // 膝角 ≥ 此值
  standHipDropMax: 0.10,      // 髖部離站立基準 ≤ 此比例

  // 深度分數（1.0 = 到達合格線）
  startDescendScore: 0.30,    // 由站立進入「下蹲中」
  bottomEnterScore: 1.00,     // 進入「到底」
  bottomExitScore: 0.85,      // 離開「到底」（遲滯，防止臨界抖動）
  shallowMinScore: 0.50,      // 未到底但曾蹲到此深度才算一次「嘗試」
  kneeStraight: 170,          // 膝角分數的起點

  minRepSeconds: 0.5,         // 少於此時長視為雜訊
  lostSeconds: 0.5,           // 關鍵點連續過低多久視為離開畫面
  leanMaxDeg: 50,             // 上身前傾提示

  minVisibility: 0.5,         // 關鍵點可信度
  smoothingAlpha: 0.5,        // EMA 平滑（0–1，越大越跟手）

  trackHoldSeconds: 1.5,      // 鎖定的人消失多久先改揀其他人
  trackMatchMin: 0.12,        // 每幀追蹤同一人容許的最少橫向移動（佔畫面闊度）
  maxPoses: 3,                // 每幀最多偵測幾多人

  calibrateSeconds: 2,        // 站直多久完成校準
  calibrateMaxMove: 0.03,     // 校準期間髖部最大移動（佔畫面高度）
};

export const STORAGE_PREFIX = 'squat-challenge:';
export const MODEL_LOCAL = './models/pose_landmarker_lite.task';
export const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
export const VISION_VERSION = '1.2.3';
export const VISION_LOCAL = './vendor/tasks-vision/vision_bundle.mjs';
export const WASM_LOCAL = './vendor/tasks-vision/wasm';
export const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.mjs`;
export const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
