# 深蹲挑戰 sport

- GitHub `lphky/sport`，main 根目錄 GitHub Pages：https://lphky.github.io/sport/ 。用 lphky 帳戶推送（`GH_TOKEN=$(gh auth token -u lphky)`），不要切換全域 active 帳戶。
- 純前端 ES Modules，無 Framework／後端；MediaPipe tasks-vision 1.2.3 及 pose_landmarker_lite 已放入 repo（vendor/、models/），CDN 只作後備。
- 門檻只改 `js/config.mjs`；計數狀態機在 `js/squat-logic.mjs`（純函數）。門檻曾按真人正面實測下調，勿回復規格原值 35%/110°。
- 多人：`createTracker()`（squat-logic.mjs）揀最中間的人，校準開始後鎖定；鎖定的人走咗（>trackHoldSeconds）不自動轉人，只會原位接返或撳畫面重新鎖定（用戶 2026-11-14 要求）；app.mjs `drawPeople()` 畫追蹤框。
- `?sim` 開放 `window.__sport` 測試介面；`?cpu` 強制 CPU。LocalStorage 前綴 `squat-challenge:`。
- 改動後執行 `npm test` 及 `npm run test:real`，並更新 docs/TEST-RESULTS.md。
