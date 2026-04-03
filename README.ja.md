> この翻訳は Claude によって生成されました。改善のご提案がありましたら、PR の作成を歓迎します。

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 ドキュメント</a>
  | <a href="https://stack-auth.com/">☁️ ホスティング版</a>
  | <a href="https://demo.stack-auth.com/">✨ デモ</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語 | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: オープンソースの認証プラットフォーム

Stack Auth はマネージドユーザー認証ソリューションです。開発者にとって使いやすく、完全にオープンソースです（MIT および AGPL ライセンス）。

Stack Auth はわずか5分で導入でき、プロジェクトの成長に合わせてすべての機能をすぐに利用できます。マネージドサービスは完全にオプションであり、ユーザーデータをエクスポートしていつでも無料でセルフホストできます。

Next.js、React、JavaScript のフロントエンドに対応しており、[REST API](https://docs.stack-auth.com/api/overview) を使用できるあらゆるバックエンドでも利用可能です。[セットアップガイド](https://docs.stack-auth.com/docs/next/getting-started/setup)をご覧ください。

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## X との違いは？

`X` について以下の質問を考えてみてください：

- `X` はオープンソースですか？
- `X` は開発者にとって使いやすく、ドキュメントが充実しており、数分で始められますか？
- 認証だけでなく、`X` は認可やユーザー管理もできますか（以下の機能一覧を参照）？

いずれかの質問に「いいえ」と答えた場合、それが Stack Auth と `X` の違いです。

## ✨ 機能

新機能の追加をいち早く知りたい方は、[ニュースレター](https://stack-auth.beehiiv.com/subscribe)にご登録ください。

| | |
|-|:-:|
| <h3>`<SignIn/>` と `<SignUp/>`</h3> OAuth、パスワード認証、マジックリンクに対応した認証コンポーネント。セットアップを高速化する共有開発キー付き。すべてのコンポーネントがダーク/ライトモードに対応しています。 | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>慣用的な Next.js API</h3> サーバーコンポーネント、React フック、ルートハンドラーを活用して構築されています。 | ![Dark/light mode](.github/assets/components.png) |
| <h3>ユーザーダッシュボード</h3> ユーザーのフィルタリング、分析、編集ができるダッシュボード。最初に構築しなければならない内部ツールの代わりになります。 | ![User dashboard](.github/assets/dashboard.png) |
| <h3>アカウント設定</h3> ユーザーがプロフィールの更新、メールアドレスの確認、パスワードの変更を行えます。セットアップ不要です。 | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>マルチテナンシーとチーム</h3> 合理的で数百万規模までスケールする組織構造で B2B 顧客を管理できます。 | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>ロールベースアクセス制御</h3> 任意の権限グラフを定義してユーザーに割り当てられます。組織は組織固有のロールを作成できます。 | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth 接続</h3>ログインだけでなく、Stack Auth は Outlook や Google Calendar などのサードパーティ API のアクセストークンも管理できます。トークンの更新とスコープの制御を処理し、1つの関数呼び出しでアクセストークンを利用できます。 | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>パスキー</h3> パスキーによるパスワードレス認証に対応しており、ユーザーはすべてのデバイスで生体認証やセキュリティキーを使って安全にサインインできます。 | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>なりすまし</h3> デバッグやサポートのためにユーザーになりすまし、そのユーザーとしてアカウントにログインできます。 | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhook</h3> Svix 上に構築されており、ユーザーがプロダクトを利用した際に通知を受け取れます。 | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>自動メール</h3> サインアップ、パスワードリセット、メール確認などのトリガーでカスタマイズ可能なメールを送信でき、WYSIWYG エディタで編集できます。 | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>ユーザーセッションと JWT 処理</h3> Stack Auth はリフレッシュトークンとアクセストークン、JWT、Cookie を管理し、実装コストなしで最高のパフォーマンスを実現します。 | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M 認証</h3> 短期間有効なアクセストークンを使用して、マシン間の認証を行います。 | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 インストールとセットアップ

Next.js プロジェクトに Stack Auth をインストールするには（React、JavaScript、その他のフレームワークについては[完全なドキュメント](https://docs.stack-auth.com)をご覧ください）：

1. 以下のコマンドで Stack Auth のインストールウィザードを実行します：
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. 次に、[Stack Auth ダッシュボード](https://app.stack-auth.com/projects)でアカウントを作成し、API キー付きの新しいプロジェクトを作成して、その環境変数を Next.js プロジェクトの .env.local ファイルにコピーします：
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. 以上です！`npm run dev` でアプリを実行し、[http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) にアクセスしてサインアップページを確認できます。また、[http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings) でアカウント設定ページも確認できます。

より詳細なガイドは[ドキュメント](https://docs.stack-auth.com/getting-started/setup)をご覧ください。

## 🌱 Stack Auth を使ったコミュニティプロジェクト

自分のプロジェクトがありますか？PR を作成するか [Discord](https://discord.stack-auth.com) でメッセージをいただければ、喜んで掲載します。

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 開発と貢献

Stack Auth プロジェクトに貢献したい方や、Stack Auth ダッシュボードをローカルで実行したい方向けのセクションです。

**重要**: [貢献ガイドライン](CONTRIBUTING.md)をよくお読みいただき、協力いただける場合は [Discord](https://discord.stack-auth.com) にご参加ください。

### 必要環境

- Node v20
- pnpm v9
- Docker

### セットアップ

注意: 快適な開発体験のために 24GB 以上の RAM を推奨します。

新しいターミナルで：

```sh
pnpm install

# パッケージのビルドとコード生成。これは一度だけ実行すればよく、以降は `pnpm dev` が自動で行います
pnpm build:packages
pnpm codegen

# 依存関係（DB、Inbucket など）を Docker コンテナとして起動し、Prisma スキーマで DB をシードします
# Docker（または OrbStack）がインストールされ、実行中であることを確認してください
pnpm restart-deps

# 開発サーバーを起動
pnpm dev

# 別のターミナルでウォッチモードでテストを実行
pnpm test # 便利なオプション: --no-watch（ウォッチモード無効）と --bail 1（最初の失敗で停止）
```

[http://localhost:8100](http://localhost:8100) で開発ランチパッドを開けます。そこから、[http://localhost:8101](http://localhost:8101) のダッシュボード、ポート 8102 の API、ポート 8103 のデモ、ポート 8104 のドキュメント、ポート 8105 の Inbucket（メール）、ポート 8106 の Prisma Studio にアクセスできます。実行中のすべてのサービスの一覧は開発ランチパッドをご覧ください。

IDE で `@stackframe/XYZ` のインポートにエラーが表示される場合があります。これを修正するには、TypeScript 言語サーバーを再起動してください。例えば VSCode では、コマンドパレット（Ctrl+Shift+P）を開いて `Developer: Reload Window` または `TypeScript: Restart TS server` を実行します。

以下のセットアップ用の事前設定済み .env ファイルが利用可能で、各パッケージの `.env.development` にデフォルトで使用されます。ただし、プロダクションビルド（例：`pnpm run build`）を作成する場合は、環境変数を手動で設定する必要があります（以下参照）。

### 便利なコマンド

```sh
# 注意:
# 実行中のすべてのサービスの一覧は開発ランチパッド（デフォルト: http://localhost:8100）をご覧ください。

# インストールコマンド
pnpm install: 依存関係をインストール

# 型チェックとリントコマンド
pnpm typecheck: TypeScript の型チェッカーを実行。先にビルドまたは開発サーバーの起動が必要な場合があります。
pnpm lint: ESLint リンターを実行。オプションで `--fix` を渡すとリントエラーの一部を修正できます。先にビルドまたは開発サーバーの起動が必要な場合があります。

# ビルドコマンド
pnpm build: アプリ、パッケージ、サンプル、ドキュメントを含むすべてのプロジェクトをビルドします。コード生成タスクも実行されます。実行前に、各フォルダの `.env.development` ファイルを `.env.production.local` にコピーするか、環境変数を手動で設定する必要があります。
pnpm build:packages: すべての npm パッケージをビルドします。
pnpm codegen: Prisma クライアントや OpenAPI ドキュメント生成などのすべてのコード生成タスクを実行します。

# 開発コマンド
pnpm dev: メインプロジェクトの開発サーバーを実行します（ほとんどのサンプルは除く）。初回実行時はパッケージのビルドとコード生成が必要です。その後はファイルの変更（コード生成ファイルを含む）を監視します。開発サーバーの再起動が必要な場合、それはバグとして報告できます。
pnpm dev:full: サンプルを含むすべてのプロジェクトの開発サーバーを実行します。
pnpm dev:basic: 必要なサービス（バックエンドとダッシュボード）のみの開発サーバーを実行します。ほとんどのユーザーには推奨しません。マシンのアップグレードを検討してください。

# 環境コマンド
pnpm start-deps: 依存関係（DB、Inbucket など）を Docker コンテナとして起動し、シードスクリプトとマイグレーションで初期化します。注意: 起動された依存関係は開発ランチパッド（デフォルトでポート 8100）に表示されます。
pnpm stop-deps: 依存関係（DB、Inbucket など）を停止し、データを削除します。
pnpm restart-deps: 依存関係を停止して再起動します。

# データベースコマンド
pnpm db:migration-gen: 現在未使用。Prisma マイグレーションは手動（または AI を使って）生成してください。
pnpm db:reset: データベースを初期状態にリセットします。`pnpm start-deps` で自動実行されます。
pnpm db:init: シードスクリプトとマイグレーションでデータベースを初期化します。`pnpm db:reset` で自動実行されます。
pnpm db:seed: シードスクリプトでデータベースを再シードします。`pnpm db:init` で自動実行されます。
pnpm db:migrate: マイグレーションを実行します。`pnpm db:init` で自動実行されます。

# テストコマンド
pnpm test <file-filters>: テストを実行します。`--bail 1` を渡すと最初の失敗で停止します。`--no-watch` を渡すとウォッチモードではなく一度だけ実行します。

# その他のコマンド
pnpm explain-query: SQL クエリを貼り付けるとクエリプランの説明が得られ、パフォーマンスの問題をデバッグできます。
pnpm verify-data-integrity: 一連の整合性チェックを実行して、データベース内のデータの整合性を検証します。（手動で DB を操作しない限り）いかなる時点でも失敗しないはずです。
```

注意: AI と作業する場合は、AI がクエリを実行できるよう、開発サーバーが起動しているターミナルタブを開いておくことをお勧めします。

## ❤ コントリビューター

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
