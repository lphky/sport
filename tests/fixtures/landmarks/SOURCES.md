# 真人關鍵點測試數據

這裏的 JSON 是用 `tools/extract.mjs`（MediaPipe PoseLandmarker full 模型）由真人影片／相片抽出的關鍵點座標，
只含座標數字，不含影像。`tests/real.test.mjs` 用它們重播，核對計數結果。「真實次數」是逐格睇片人手數出來的。

| 檔案 | 來源（Wikimedia Commons） | 內容 | 真實次數 |
|---|---|---|---|
| jack_burpee.json | File:Jumping jacks and burpees.webm（頭 16 秒） | 正面開合跳，中間夾雜彎腰落地（波比跳） | 開合跳 6 |
| squat_raise.json | File:Squat and Frontal Raise.webm | 側面深蹲，中間有一次彎腰擺壺鈴 | 深蹲 6 |
| squat_kb_side.json | File:Kettlebell Racked Squats (side view).webm（頭 26 秒） | 側面剪影：先彎腰執壺鈴，再深蹲 | 深蹲 3 |
| pushup_home.json | File:Muscle Strengthening at Home - Push-ups.webm（44 秒起） | 斜側面跪膝掌上壓，片尾轉標準姿勢但未完成一下 | 跪膝掌上壓 3 |
| pushup_interval.json | File:Interval Push-ups.webm（頭 26 秒） | 側面剪影掌上壓 | 掌上壓 3 |
| situp_demo.json | File:Demonstration of A Sit-up.webm（2.5–9.6 秒） | 側面仰臥起坐，第 3 下未完鏡頭已轉 | 仰臥起坐 2 |
| situp_tokyo.json | File:Situps-tokyoarea-2018.webm | 黃昏、遠距離、斜後方、有途人經過 | 仰臥起坐 5 |
| situp_home.json | File:Muscle Strengthening at Home - Sit-ups.webm（14–28 秒） | 捲腹（只抬頭及膊頭） | 仰臥起坐 0 |
| still_*.json | `tests/fixtures/*.jpg`（AI 生成的真人相片） | 單張姿勢 | — |

影片本身沒有放入 repo。重新抽取：下載原片後執行 `node tools/extract.mjs <影片> <輸出.json> --fps 15`。
