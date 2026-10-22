# Changelog

版號規則（延續 Church Roster 慣例，三碼 `x.y.z`）：

- `0.y.z`：開發階段
- `1.0.0`：第一次正式上線（取代舊的 `ChurchRoster.exe`）
- 之後依 `major.minor.patch` 遞增

版號維護在 `package.json` 的 `version` 欄位。舊的 Python 工具停在 `v1.0.0` 不再跳版。

---

## 0.2.0 — 2026-10-22（Phase 1：引擎移植）

把舊版 429 行 Python 引擎移植成 TypeScript。對外只有一個純函式 `runScheduler(project)`，
指派順序與每個角色用哪種策略全部由資料決定，不再寫死角色名或人名。

- `src/engine/`：新增 `dates`、`rules`、`state`、`context`、`eligibility`、`ordering`、
  `strategies`、`run`、`index` 九個模組
- 三種指派策略取代舊版四個寫死角色名的函式：成對指派（`Role.pairsWith`）、固定組合輪替
  （`rotation_groups`）、單純填滿
- `src/engine/schema.ts`：`Role` 新增選填的 `pairsWith`，表示兩個角色要一起排
- 15 種限制條件全部實作，並補上舊版沒有的 `substitute_priority.prefer`
- 入口驗證：所有 id 參照、日期格式、成對關係都會逐項檢查，有問題丟
  `ProjectValidationError` 並帶完整問題清單（取代舊版對不上就靜默忽略的行為）
- 新增 `softViolations` 輸出：固定組合被拆開、完全沒用上固定組合、動用最後手段人員
- 修掉舊版四個缺陷：輪替群組為空時 `% 0` 崩潰、姓名對不上靜默忽略、soft 規則不回報、
  `forbidden_together` 不檢查完整組合本身
- 測試 64 個：parity（26 週與 golden 深度相等）、15 種規則的生效／不生效、引擎行為

## 0.1.0 — 2026-10-22（Phase 0：骨架）

- 建立 Vite + React + TypeScript + Tailwind + vitest 專案骨架
- `src/engine/schema.ts`：專案檔 schema v1 的型別定義（含 15 種限制條件型別）
- `src/ui/steps.ts`、`src/App.tsx`：五步引導的版面外殼與配色 token（沿用 Excel 配色）
- `tests/fixtures/`：匿名 fixture（28 人 / 26 週）與舊 Python 引擎產出的 golden 班表
- `tests/fixtures.test.ts`：fixture 與 golden 的結構驗證（參照完整性、排滿、不排到不行的日期、一人一週一角色）
- `.github/workflows/deploy.yml`：push 到預設分支後測試、建置並發布到 GitHub Pages
