> 此翻译由 Claude 生成。如有改进建议，欢迎提交 PR。

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 文档</a>
  | <a href="https://stack-auth.com/">☁️ 托管版本</a>
  | <a href="https://demo.stack-auth.com/">✨ 演示</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h3>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | 简体中文 | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth：开源身份验证平台

Stack Auth 是一套托管式用户身份验证解决方案。它对开发者友好，且完全开源（采用 MIT 和 AGPL 许可证）。

Stack Auth 让你在短短五分钟内即可上手，之后随着项目成长，你可以使用它的所有功能。我们的托管服务完全是可选的，你可以随时导出用户数据并免费自行托管。

我们支持 Next.js、React 和 JavaScript 前端，以及任何可以使用我们 [REST API](https://docs.stack-auth.com/api/overview) 的后端。查看我们的[设置指南](https://docs.stack-auth.com/docs/next/getting-started/setup)以开始使用。

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## 与 X 有什么不同？

问问自己关于 `X`：

- `X` 是开源的吗？
- `X` 对开发者友好吗？文档完善吗？能在几分钟内上手吗？
- 除了身份验证，`X` 还提供授权和用户管理吗（见下方功能列表）？

如果以上任何一个问题你的回答是"否"，那就是 Stack Auth 与 `X` 的不同之处。

## ✨ 功能

想第一时间收到新功能通知，请订阅[我们的新闻通讯](https://stack-auth.beehiiv.com/subscribe)。

| | |
|-|:-:|
| <h3>`<SignIn/>` 和 `<SignUp/>`</h3> 支持 OAuth、密码凭证和魔法链接的身份验证组件，具有共享开发密钥以加速设置。所有组件均支持深色/浅色模式。 | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>惯用的 Next.js API</h3> 我们基于服务器组件、React hooks 和路由处理器构建。 | ![Dark/light mode](.github/assets/components.png) |
| <h3>用户仪表板</h3> 用于筛选、分析和编辑用户的仪表板。替代你原本需要构建的第一个内部工具。 | ![User dashboard](.github/assets/dashboard.png) |
| <h3>账户设置</h3> 让用户更新个人资料、验证电子邮件或更改密码。无需额外设置。 | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>多租户与团队</h3> 通过合理且可扩展至数百万的组织架构来管理 B2B 客户。 | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>基于角色的访问控制</h3> 定义任意的权限图并分配给用户。组织可以创建组织专属的角色。 | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth 连接</h3>除了登录之外，Stack Auth 还可以管理第三方 API 的访问令牌，例如 Outlook 和 Google Calendar。它会处理令牌刷新和范围控制，让访问令牌仅需一个函数调用即可获取。 | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> 支持使用 Passkeys 的无密码身份验证，让用户可以在所有设备上通过生物识别或安全密钥安全登录。 | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>用户模拟</h3> 模拟用户进行调试和支持，以他们的身份登录账户。 | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> 当用户使用你的产品时获得通知，基于 Svix 构建。 | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>自动化邮件</h3> 在注册、密码重置和电子邮件验证等触发事件时发送可自定义的邮件，可通过所见即所得编辑器编辑。 | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>用户会话与 JWT 处理</h3> Stack Auth 管理刷新令牌和访问令牌、JWT 和 Cookie，以零实现成本实现最佳性能。 | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M 身份验证</h3> 使用短期访问令牌来验证机器对机器的通信。 | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 安装与设置

在你的 Next.js 项目中安装 Stack Auth（如需 React、JavaScript 或其他框架，请参阅我们的[完整文档](https://docs.stack-auth.com)）：

1. 使用以下命令运行 Stack Auth 的安装向导：
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. 然后在 [Stack Auth 仪表板](https://app.stack-auth.com/projects)上创建账户，创建一个带有 API 密钥的新项目，并将其环境变量复制到你 Next.js 项目的 .env.local 文件中：
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. 完成了！你可以使用 `npm run dev` 运行你的应用程序，并前往 [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) 查看注册页面。你也可以在 [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings) 查看账户设置页面。

查看[文档](https://docs.stack-auth.com/getting-started/setup)以获取更详细的指南。

## 🌱 一些使用 Stack Auth 构建的社区项目

有自己的项目吗？欢迎创建 PR 或在 [Discord](https://discord.stack-auth.com) 上联系我们，我们很乐意展示它。

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 开发与贡献

如果你想为 Stack Auth 项目做出贡献或在本地运行 Stack Auth 仪表板，本节适合你。

**重要**：请仔细阅读[贡献指南](CONTRIBUTING.md)，并加入[我们的 Discord](https://discord.stack-auth.com) 如果你想提供帮助。

### 系统要求

- Node v20
- pnpm v9
- Docker

### 设置

注意：建议使用 24GB 以上的内存以获得流畅的开发体验。

在新的终端中：

```sh
pnpm install

# 构建包并生成代码。这只需要做一次，之后 `pnpm dev` 会自动处理
pnpm build:packages
pnpm codegen

# 以 Docker 容器启动依赖服务（数据库、Inbucket 等），并使用 Prisma schema 初始化数据库
# 请确保已安装并运行 Docker（或 OrbStack）
pnpm restart-deps

# 启动开发服务器
pnpm dev

# 在另一个终端中，以监听模式运行测试
pnpm test # 实用参数：--no-watch（禁用监听模式）和 --bail 1（在第一个失败后停止）
```

现在你可以在 [http://localhost:8100](http://localhost:8100) 打开开发启动台。从那里你可以导航到 [http://localhost:8101](http://localhost:8101) 的仪表板、8102 端口的 API、8103 端口的演示、8104 端口的文档、8105 端口的 Inbucket（电子邮件）和 8106 端口的 Prisma Studio。详细的运行服务列表请参阅开发启动台。

你的 IDE 可能会在所有 `@stackframe/XYZ` 导入上显示错误。要修复此问题，只需重新启动 TypeScript 语言服务器；例如在 VSCode 中你可以打开命令面板（Ctrl+Shift+P）并运行 `Developer: Reload Window` 或 `TypeScript: Restart TS server`。

以下设置的预填充 .env 文件已准备好，并默认在每个包的 `.env.development` 中使用。但是如果你要创建生产版本（例如使用 `pnpm run build`），你必须手动提供环境变量（见下方）。

### 常用命令

```sh
# 注意：
# 请参阅开发启动台（默认：http://localhost:8100）以获取所有运行服务的列表。

# 安装命令
pnpm install: 安装依赖包

# 类型与代码检查命令
pnpm typecheck: 运行 TypeScript 类型检查。可能需要先构建或启动开发服务器。
pnpm lint: 运行 ESLint 代码检查。可选择传入 `--fix` 以修复部分检查错误。可能需要先构建或启动开发服务器。

# 构建命令
pnpm build: 构建所有项目，包括应用程序、包、示例和文档。同时运行代码生成任务。在运行之前，你需要将所有文件夹中的 `.env.development` 文件复制为 `.env.production.local` 或手动设置环境变量。
pnpm build:packages: 构建所有 npm 包。
pnpm codegen: 运行所有代码生成任务，例如 Prisma client 和 OpenAPI 文档生成。

# 开发命令
pnpm dev: 运行主要项目的开发服务器，不包括大部分示例。首次运行时需要先构建包并运行 codegen。之后它会监听文件变更（包括代码生成文件）。如果你因任何原因需要重新启动开发服务器，那是一个可以报告的错误。
pnpm dev:full: 运行所有项目的开发服务器，包括示例。
pnpm dev:basic: 仅运行必要服务（后端和仪表板）的开发服务器。不建议大多数用户使用，请升级你的设备。

# 环境命令
pnpm start-deps: 以 Docker 容器启动依赖服务（数据库、Inbucket 等），并使用种子脚本和迁移进行初始化。注意：启动的依赖服务会显示在开发启动台上（默认为 8100 端口）。
pnpm stop-deps: 停止 Docker 依赖服务（数据库、Inbucket 等）并删除其中的数据。
pnpm restart-deps: 停止并重新启动依赖服务。

# 数据库命令
pnpm db:migration-gen: 目前未使用。请手动（或使用 AI）生成 Prisma 迁移。
pnpm db:reset: 将数据库重置为初始状态。由 `pnpm start-deps` 自动运行。
pnpm db:init: 使用种子脚本和迁移初始化数据库。由 `pnpm db:reset` 自动运行。
pnpm db:seed: 使用种子脚本重新填充数据库。由 `pnpm db:init` 自动运行。
pnpm db:migrate: 运行迁移。由 `pnpm db:init` 自动运行。

# 测试命令
pnpm test <file-filters>: 运行测试。传入 `--bail 1` 使测试在第一个失败后停止。传入 `--no-watch` 运行一次测试而非监听模式。

# 其他命令
pnpm explain-query: 粘贴 SQL 查询以获取查询计划的说明，帮助你调试性能问题。
pnpm verify-data-integrity: 通过运行一系列完整性检查来验证数据库中的数据完整性。这在任何时间点都不应该失败（除非你手动修改了数据库）。
```

注意：使用 AI 工作时，你应该保持一个打开开发服务器的终端标签页，让 AI 可以对其运行查询。

## ❤ 贡献者

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
