> 此翻譯由 Claude 生成。如有改進建議，歡迎提交 PR。

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 文件</a>
  | <a href="https://stack-auth.com/">☁️ 託管版本</a>
  | <a href="https://demo.stack-auth.com/">✨ 示範</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h3>

<p align="center">
  <a href="README.md">English</a> | 繁體中文 | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth：開源身份驗證平台

Stack Auth 是一套託管式使用者身份驗證解決方案。它對開發者友善，且完全開源（採用 MIT 和 AGPL 授權）。

Stack Auth 讓你在短短五分鐘內即可上手，之後隨著專案成長，你可以使用它的所有功能。我們的託管服務完全是可選的，你可以隨時匯出使用者資料並免費自行託管。

我們支援 Next.js、React 和 JavaScript 前端，以及任何可以使用我們 [REST API](https://docs.stack-auth.com/api/overview) 的後端。查看我們的[設定指南](https://docs.stack-auth.com/docs/next/getting-started/setup)以開始使用。

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## 與 X 有什麼不同？

問問自己關於 `X`：

- `X` 是開源的嗎？
- `X` 對開發者友善嗎？文件完善嗎？能在幾分鐘內上手嗎？
- 除了身份驗證，`X` 還提供授權和使用者管理嗎（見下方功能列表）？

如果以上任何一個問題你的回答是「否」，那就是 Stack Auth 與 `X` 的不同之處。

## ✨ 功能

想第一時間收到新功能通知，請訂閱[我們的電子報](https://stack-auth.beehiiv.com/subscribe)。

| | |
|-|:-:|
| <h3>`<SignIn/>` 和 `<SignUp/>`</h3> 支援 OAuth、密碼憑證和魔法連結的身份驗證元件，具有共享開發金鑰以加速設定。所有元件均支援深色/淺色模式。 | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>慣用的 Next.js API</h3> 我們基於伺服器元件、React hooks 和路由處理器構建。 | ![Dark/light mode](.github/assets/components.png) |
| <h3>使用者儀表板</h3> 用於篩選、分析和編輯使用者的儀表板。取代你原本需要建立的第一個內部工具。 | ![User dashboard](.github/assets/dashboard.png) |
| <h3>帳戶設定</h3> 讓使用者更新個人資料、驗證電子郵件或變更密碼。無需額外設定。 | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>多租戶與團隊</h3> 透過合理且可擴展至數百萬的組織架構來管理 B2B 客戶。 | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>基於角色的存取控制</h3> 定義任意的權限圖表並指派給使用者。組織可以建立組織專屬的角色。 | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth 連線</h3>除了登入之外，Stack Auth 還可以管理第三方 API 的存取權杖，例如 Outlook 和 Google Calendar。它會處理權杖刷新和範圍控制，讓存取權杖僅需一個函式呼叫即可取得。 | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> 支援使用 Passkeys 的無密碼身份驗證，讓使用者可以在所有裝置上透過生物辨識或安全金鑰安全登入。 | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>使用者模擬</h3> 模擬使用者進行除錯和支援，以他們的身份登入帳戶。 | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> 當使用者使用你的產品時獲得通知，基於 Svix 構建。 | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>自動化郵件</h3> 在註冊、密碼重設和電子郵件驗證等觸發事件時發送可自訂的郵件，可透過所見即所得編輯器編輯。 | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>使用者工作階段與 JWT 處理</h3> Stack Auth 管理刷新權杖和存取權杖、JWT 和 Cookie，以零實作成本實現最佳效能。 | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M 身份驗證</h3> 使用短期存取權杖來驗證機器對機器的通訊。 | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 安裝與設定

在你的 Next.js 專案中安裝 Stack Auth（如需 React、JavaScript 或其他框架，請參閱我們的[完整文件](https://docs.stack-auth.com)）：

1. 使用以下指令執行 Stack Auth 的安裝精靈：
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. 然後在 [Stack Auth 儀表板](https://app.stack-auth.com/projects)上建立帳戶，建立一個帶有 API 金鑰的新專案，並將其環境變數複製到你 Next.js 專案的 .env.local 檔案中：
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. 完成了！你可以使用 `npm run dev` 執行你的應用程式，並前往 [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) 查看註冊頁面。你也可以在 [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings) 查看帳戶設定頁面。

查看[文件](https://docs.stack-auth.com/getting-started/setup)以獲取更詳細的指南。

## 🌱 一些使用 Stack Auth 建立的社群專案

有自己的專案嗎？歡迎建立 PR 或在 [Discord](https://discord.stack-auth.com) 上聯繫我們，我們很樂意展示它。

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 開發與貢獻

如果你想為 Stack Auth 專案做出貢獻或在本地執行 Stack Auth 儀表板，本節適合你。

**重要**：請仔細閱讀[貢獻指南](CONTRIBUTING.md)，並加入[我們的 Discord](https://discord.stack-auth.com)如果你想提供幫助。

### 系統需求

- Node v20
- pnpm v9
- Docker

### 設定

注意：建議使用 24GB 以上的記憶體以獲得流暢的開發體驗。

在新的終端機中：

```sh
pnpm install

# 建置套件並產生程式碼。這只需要做一次，之後 `pnpm dev` 會自動處理
pnpm build:packages
pnpm codegen

# 以 Docker 容器啟動相依服務（資料庫、Inbucket 等），並使用 Prisma schema 初始化資料庫
# 請確保已安裝並執行 Docker（或 OrbStack）
pnpm restart-deps

# 啟動開發伺服器
pnpm dev

# 在另一個終端機中，以監看模式執行測試
pnpm test # 實用參數：--no-watch（停用監看模式）和 --bail 1（在第一個失敗後停止）
```

現在你可以在 [http://localhost:8100](http://localhost:8100) 開啟開發啟動台。從那裡你可以導航到 [http://localhost:8101](http://localhost:8101) 的儀表板、8102 埠的 API、8103 埠的示範、8104 埠的文件、8105 埠的 Inbucket（電子郵件）和 8106 埠的 Prisma Studio。詳細的執行服務列表請參閱開發啟動台。

你的 IDE 可能會在所有 `@stackframe/XYZ` 匯入上顯示錯誤。要修正此問題，只需重新啟動 TypeScript 語言伺服器；例如在 VSCode 中你可以開啟命令面板（Ctrl+Shift+P）並執行 `Developer: Reload Window` 或 `TypeScript: Restart TS server`。

以下設定的預設 .env 檔案已準備好，並預設在每個套件的 `.env.development` 中使用。但是如果你要建立正式版本（例如使用 `pnpm run build`），你必須手動提供環境變數（見下方）。

### 常用指令

```sh
# 注意：
# 請參閱開發啟動台（預設：http://localhost:8100）以獲取所有執行服務的列表。

# 安裝指令
pnpm install: 安裝相依套件

# 型別與程式碼檢查指令
pnpm typecheck: 執行 TypeScript 型別檢查。可能需要先建置或啟動開發伺服器。
pnpm lint: 執行 ESLint 程式碼檢查。可選擇傳入 `--fix` 以修正部分檢查錯誤。可能需要先建置或啟動開發伺服器。

# 建置指令
pnpm build: 建置所有專案，包括應用程式、套件、範例和文件。同時執行程式碼產生任務。在執行之前，你需要將所有資料夾中的 `.env.development` 檔案複製為 `.env.production.local` 或手動設定環境變數。
pnpm build:packages: 建置所有 npm 套件。
pnpm codegen: 執行所有程式碼產生任務，例如 Prisma client 和 OpenAPI 文件產生。

# 開發指令
pnpm dev: 執行主要專案的開發伺服器，不包括大部分範例。首次執行時需要先建置套件並執行 codegen。之後它會監看檔案變更（包括程式碼產生檔案）。如果你因任何原因需要重新啟動開發伺服器，那是一個可以回報的錯誤。
pnpm dev:full: 執行所有專案的開發伺服器，包括範例。
pnpm dev:basic: 僅執行必要服務（後端和儀表板）的開發伺服器。不建議大多數使用者使用，請升級你的設備。

# 環境指令
pnpm start-deps: 以 Docker 容器啟動相依服務（資料庫、Inbucket 等），並使用種子腳本和遷移進行初始化。注意：啟動的相依服務會顯示在開發啟動台上（預設為 8100 埠）。
pnpm stop-deps: 停止 Docker 相依服務（資料庫、Inbucket 等）並刪除其中的資料。
pnpm restart-deps: 停止並重新啟動相依服務。

# 資料庫指令
pnpm db:migration-gen: 目前未使用。請手動（或使用 AI）產生 Prisma 遷移。
pnpm db:reset: 將資料庫重設為初始狀態。由 `pnpm start-deps` 自動執行。
pnpm db:init: 使用種子腳本和遷移初始化資料庫。由 `pnpm db:reset` 自動執行。
pnpm db:seed: 使用種子腳本重新填充資料庫。由 `pnpm db:init` 自動執行。
pnpm db:migrate: 執行遷移。由 `pnpm db:init` 自動執行。

# 測試指令
pnpm test <file-filters>: 執行測試。傳入 `--bail 1` 使測試在第一個失敗後停止。傳入 `--no-watch` 執行一次測試而非監看模式。

# 其他指令
pnpm explain-query: 貼上 SQL 查詢以獲取查詢計畫的說明，幫助你除錯效能問題。
pnpm verify-data-integrity: 透過執行一系列完整性檢查來驗證資料庫中的資料完整性。這在任何時間點都不應該失敗（除非你手動修改了資料庫）。
```

注意：使用 AI 工作時，你應該保持一個開啟開發伺服器的終端機分頁，讓 AI 可以對其執行查詢。

## ❤ 貢獻者

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
