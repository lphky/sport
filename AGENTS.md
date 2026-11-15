# 運動擂台 sport

- 用鏡頭自動計數的體育堂遊戲：深蹲、掌上壓、仰臥起坐、開合跳、高抬腿、平板支撐；單人或雙人對戰（左右分區）。2026-11-14 按用戶要求全部重寫（取代舊「深蹲挑戰」）。
- GitHub `lphky/sport`，main 根目錄 GitHub Pages：https://lphky.github.io/sport/ 。用 lphky 帳戶推送（`GH_TOKEN=$(gh auth token -u lphky)`），不要切換全域 active 帳戶。
- 純前端 ES Modules，無 Framework／後端。MediaPipe tasks-vision 1.2.3、pose_landmarker_full（預設）及 lite 已放入 repo，CDN 只作後備。
- 結構：`js/config.mjs` 門檻；`exercises.mjs` 量度；`counter.mjs` 狀態機；`tracker.mjs` 追蹤；`player.mjs` 串連；`app.mjs` 畫面。前五個是純函數，改判定邏輯不要寫入 app.mjs。
- 用戶重視準確度（體育堂用）。門檻都是用真人影片／相片校準的，改門檻或量度後必須跑 `node --test tests/*.test.mjs`（包括 tests/real.test.mjs 的真人數據回歸），不要憑感覺改。
- 深蹲防抬腳（2026-11-15）：髖降直接對比站立髖高，不能改回腳踝至髖距離縮短。腳踝相對站立上移超過 maxFootLift、連續 footLiftFrames 幀會 cancelRep 取消該下並等待企直；不能用一般 faultRatio 稀釋這項犯規。
- 深蹲判定是視角自適應：側面用 2D 膝角，正面用 3D 膝角＋髖降；彎腰（側面前傾 >60°）報犯規。勿改回單一 2D 門檻。
- 追蹤：鎖定的人走咗不自動轉人，只會原位接返或撳畫面重新鎖定（用戶 2026-11-14 要求）。雙人時左邊玩家 = 未鏡像座標右半。
- 新增真人測試數據：`tools/extract.mjs` 抽關鍵點 → `tools/replay.mjs --trace` 睇訊號 → 逐格睇片數真實次數 → 加入 tests/fixtures/landmarks 及 SOURCES.md。影片本身不入 repo。
- `?sim` 開放 `window.__sport` 測試介面；`?cpu` 強制 CPU。LocalStorage 前綴 `sport-arena:`。
- 改動後執行 `npm test` 及 `npm run test:real`，並更新 docs/TEST-RESULTS.md。
