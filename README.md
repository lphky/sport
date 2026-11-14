# 深蹲挑戰（sport）

用電腦前置鏡頭自動數深蹲的網頁遊戲。姿勢偵測（MediaPipe Pose Landmarker）完全在瀏覽器內運行，**影像不會上傳、不會錄影、不會儲存**。

- 網上版：https://lphky.github.io/sport/
- 模式：自由模式、60 秒挑戰、目標模式（10／20／30 下）
- 難度：輕鬆／標準／深蹲（設定內切換）
- 最佳紀錄及設定存於瀏覽器 LocalStorage（key 前綴 `squat-challenge:`），結果頁可「清除紀錄」

## 建議擺位

鏡頭大約胸口高度或稍低，人企後 2–3 米、正面面向鏡頭，頭到腳踝全部入鏡，光線充足。

## 多人入鏡

遊戲會揀**畫面最中間嘅人**追蹤，並用框顯示：

- 綠色實線框「✓ 追蹤中」＝ 正在數呢個人（站位未齊時變橙色）
- 白色虛線框「未追蹤」＝ 畫面其他人，佢哋做乜都唔會計
- 開始校準後會**鎖定**同一個人：其他人行入中間都唔會轉；鎖定嘅人離開畫面超過 1.5 秒先會重新揀中間嘅人
- 揀錯人時，用滑鼠／手指**撳一下想追蹤嘅人**即可轉換（遊戲中途轉換會保留已數次數，新的人要先企直再數）

相關設定：`js/config.mjs` 的 `trackHoldSeconds`、`trackMatchMin`、`maxPoses`。

## 本機開啟

鏡頭只可以喺 HTTPS 或 localhost 使用，直接雙擊 `index.html`（file://）開唔到鏡頭。

```bash
npm start          # http://127.0.0.1:4190/
```

## 部署（GitHub Pages）

Settings → Pages → Source: Deploy from a branch → `main` / `(root)`。全部路徑都係相對路徑，放喺 `/sport/` 子路徑都可以運作。

嵌入其他網頁時 iframe 必須加 `allow="camera"`：

```html
<iframe src="https://lphky.github.io/sport/" allow="camera" width="1280" height="720"></iframe>
```

上線後驗收：① 撳「開始」會彈出鏡頭權限 ② 載入後見到站位檢查 ③ 站直 2 秒後倒數 ④ 深蹲會加數 ⑤ 完成後首頁顯示最佳紀錄。

## 檔案結構

```
index.html                       介面及樣式
js/config.mjs                    所有門檻及路徑設定
js/squat-logic.mjs               計數邏輯（純函數，同介面分開）
js/app.mjs                       鏡頭、模型、畫面流程
vendor/tasks-vision/             @mediapipe/tasks-vision 1.2.3（bundle＋wasm）
models/pose_landmarker_lite.task 姿勢模型
tests/                           單元測試、瀏覽器測試、真人相片實測
```

模型及程式庫優先從本 repo 載入（學校／公司網絡封鎖 CDN 都用到）；本地載入失敗先會退回固定版本 CDN。

## 計數規則

每一下要經過：**站直 → 下蹲 → 到底（過合格線）→ 站返直**先算一下。

- 深度 = max(髖部下降比例 ÷ 難度門檻, (170° − 膝角) ÷ (170° − 難度膝角))，1.0 即到合格線
- 未到合格線就企返起身：唔計數，計一次「嘗試」並提示「再蹲深少少」
- 一下少過 0.5 秒：當雜訊唔計
- 離開畫面超過 0.5 秒：暫停判斷，回來要先站直
- 上身前傾超過 50°：提示「挺直上身」，唔影響計數

## 計數門檻調整

全部喺 `js/config.mjs`：

| 設定 | 作用 |
| --- | --- |
| `DIFFICULTIES.*.hipDrop` | 髖部要跌幾多（佔站立時髖到腳踝距離）先算到底 |
| `DIFFICULTIES.*.kneeAngle` | 膝角要細過幾多度先算到底（任一項達標即可） |
| `CONFIG.standKneeMin` / `standHipDropMax` | 點樣先算「站直」 |
| `CONFIG.bottomEnterScore` / `bottomExitScore` | 到底的遲滯門檻，防止臨界抖動重複計 |
| `CONFIG.startDescendScore` / `shallowMinScore` | 幾深先算開始蹲／先算一次嘗試 |
| `CONFIG.minRepSeconds` | 最短一下時長 |
| `CONFIG.smoothingAlpha` | 平滑程度（細＝穩但慢，大＝快但抖） |

- **少計**（明明蹲到底都唔加）：調細 `hipDrop`、調大 `kneeAngle`，或者揀「輕鬆」。可以開「顯示骨架」睇實際髖降及膝角數值。
- **多計**（企喺度晃都加）：調大 `hipDrop`、調細 `kneeAngle`，或調細 `smoothingAlpha`。
- 正面拍攝時 2D 投影會令數值偏細：以真人正面相片實測，大腿水平的深蹲約髖降 27%、膝角 143°。

調整後執行 `npm test` 及 `npm run test:real`。

## 測試

```bash
npm install
npm test           # 單元測試（node --test）＋ Playwright 瀏覽器測試
npm run test:real  # 真模型＋真人相片影片實測（需要 ffmpeg）
```

詳細結果見 [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md)。

⚠️ 請量力而為，如有不適立即停止。本遊戲不是醫療或專業健身評估工具。
