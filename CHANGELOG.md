# Changelog

版號規則（延續 Church Roster 慣例，三碼 `x.y.z`）：

- `0.y.z`：開發階段
- `1.0.0`：第一次正式上線（取代舊的 `ChurchRoster.exe`）
- 之後依 `major.minor.patch` 遞增

版號維護在 `package.json` 的 `version` 欄位。舊的 Python 工具停在 `v1.0.0` 不再跳版。

---

## 0.1.0 — 2026-10-22（Phase 0：骨架）

- 建立 Vite + React + TypeScript + Tailwind + vitest 專案骨架
- `src/engine/schema.ts`：專案檔 schema v1 的型別定義（含 15 種限制條件型別）
- `src/ui/steps.ts`、`src/App.tsx`：五步引導的版面外殼與配色 token（沿用 Excel 配色）
- `tests/fixtures/`：匿名 fixture（28 人 / 26 週）與舊 Python 引擎產出的 golden 班表
- `tests/fixtures.test.ts`：fixture 與 golden 的結構驗證（參照完整性、排滿、不排到不行的日期、一人一週一角色）
- `.github/workflows/deploy.yml`：push 到預設分支後測試、建置並發布到 GitHub Pages
