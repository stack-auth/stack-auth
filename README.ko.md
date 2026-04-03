> 이 번역은 Claude에 의해 생성되었습니다. 개선 제안이 있으시면 PR을 보내주세요.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 문서</a>
  | <a href="https://stack-auth.com/">☁️ 호스팅 버전</a>
  | <a href="https://demo.stack-auth.com/">✨ 데모</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | 한국어 | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: 오픈소스 인증 플랫폼

Stack Auth는 매니지드 사용자 인증 솔루션입니다. 개발자 친화적이며 완전한 오픈소스입니다(MIT 및 AGPL 라이선스).

Stack Auth는 단 5분 만에 시작할 수 있으며, 프로젝트가 성장함에 따라 모든 기능을 바로 사용할 수 있습니다. 매니지드 서비스는 완전히 선택 사항이며, 사용자 데이터를 내보내고 언제든지 무료로 셀프 호스팅할 수 있습니다.

Next.js, React, JavaScript 프론트엔드를 지원하며, [REST API](https://docs.stack-auth.com/api/overview)를 사용할 수 있는 모든 백엔드에서도 이용 가능합니다. [설정 가이드](https://docs.stack-auth.com/docs/next/getting-started/setup)를 확인하여 시작하세요.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## X와 어떻게 다른가요?

`X`에 대해 다음 질문들을 생각해 보세요:

- `X`는 오픈소스인가요?
- `X`는 개발자 친화적이고, 문서가 잘 되어 있으며, 몇 분 만에 시작할 수 있나요?
- 인증 외에도 `X`는 인가와 사용자 관리도 지원하나요(아래 기능 목록 참조)?

이 질문 중 하나라도 "아니오"라고 답했다면, 그것이 Stack Auth와 `X`의 차이점입니다.

## ✨ 기능

새로운 기능이 추가될 때 가장 먼저 알림을 받으려면 [뉴스레터](https://stack-auth.beehiiv.com/subscribe)를 구독해 주세요.

| | |
|-|:-:|
| <h3>`<SignIn/>`과 `<SignUp/>`</h3> OAuth, 비밀번호 인증, 매직 링크를 지원하는 인증 컴포넌트. 설정을 빠르게 할 수 있는 공유 개발 키 포함. 모든 컴포넌트가 다크/라이트 모드를 지원합니다. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>관용적인 Next.js API</h3> 서버 컴포넌트, React 훅, 라우트 핸들러를 기반으로 구축되었습니다. | ![Dark/light mode](.github/assets/components.png) |
| <h3>사용자 대시보드</h3> 사용자를 필터링, 분석, 편집할 수 있는 대시보드. 처음으로 만들어야 했을 내부 도구를 대체합니다. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>계정 설정</h3> 사용자가 프로필 업데이트, 이메일 인증, 비밀번호 변경을 할 수 있습니다. 별도의 설정이 필요 없습니다. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>멀티테넌시와 팀</h3> 합리적이고 수백만 규모까지 확장 가능한 조직 구조로 B2B 고객을 관리합니다. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>역할 기반 접근 제어</h3> 임의의 권한 그래프를 정의하고 사용자에게 할당할 수 있습니다. 조직은 조직별 역할을 생성할 수 있습니다. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth 연결</h3>로그인 외에도 Stack Auth는 Outlook 및 Google Calendar와 같은 서드파티 API의 액세스 토큰도 관리할 수 있습니다. 토큰 갱신과 스코프 제어를 처리하며, 단일 함수 호출로 액세스 토큰을 사용할 수 있습니다. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>패스키</h3> 패스키를 사용한 비밀번호 없는 인증을 지원하여, 사용자가 모든 기기에서 생체 인식이나 보안 키로 안전하게 로그인할 수 있습니다. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>사용자 가장</h3> 디버깅과 지원을 위해 사용자를 가장하여 해당 사용자로 계정에 로그인할 수 있습니다. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhook</h3> Svix 기반으로 구축되어 사용자가 제품을 사용할 때 알림을 받을 수 있습니다. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>자동 이메일</h3> 가입, 비밀번호 재설정, 이메일 인증 등의 트리거에 맞춤형 이메일을 전송하며, WYSIWYG 에디터로 편집할 수 있습니다. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>사용자 세션 및 JWT 처리</h3> Stack Auth는 리프레시 토큰과 액세스 토큰, JWT, 쿠키를 관리하여 구현 비용 없이 최상의 성능을 제공합니다. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M 인증</h3> 수명이 짧은 액세스 토큰을 사용하여 머신 간 인증을 수행합니다. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 설치 및 설정

Next.js 프로젝트에 Stack Auth를 설치하려면 (React, JavaScript 또는 기타 프레임워크는 [전체 문서](https://docs.stack-auth.com)를 참조하세요):

1. 다음 명령어로 Stack Auth 설치 마법사를 실행합니다:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. 그런 다음 [Stack Auth 대시보드](https://app.stack-auth.com/projects)에서 계정을 만들고, API 키가 포함된 새 프로젝트를 생성한 후, 환경 변수를 Next.js 프로젝트의 .env.local 파일에 복사합니다:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. 이것으로 끝입니다! `npm run dev`로 앱을 실행하고 [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup)에 접속하여 회원가입 페이지를 확인할 수 있습니다. [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings)에서 계정 설정 페이지도 확인할 수 있습니다.

더 자세한 가이드는 [문서](https://docs.stack-auth.com/getting-started/setup)를 확인하세요.

## 🌱 Stack Auth로 만든 커뮤니티 프로젝트

본인의 프로젝트가 있으신가요? PR을 만들거나 [Discord](https://discord.stack-auth.com)에서 메시지를 보내주시면 기꺼이 소개하겠습니다.

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 개발 및 기여

Stack Auth 프로젝트에 기여하거나 Stack Auth 대시보드를 로컬에서 실행하고 싶은 분들을 위한 섹션입니다.

**중요**: [기여 가이드라인](CONTRIBUTING.md)을 꼼꼼히 읽어주시고, 도움을 주고 싶으시면 [Discord](https://discord.stack-auth.com)에 참여해 주세요.

### 요구 사항

- Node v20
- pnpm v9
- Docker

### 설정

참고: 원활한 개발 경험을 위해 24GB 이상의 RAM을 권장합니다.

새 터미널에서:

```sh
pnpm install

# 패키지 빌드 및 코드 생성. 이 작업은 한 번만 실행하면 되며, 이후에는 `pnpm dev`가 자동으로 수행합니다
pnpm build:packages
pnpm codegen

# 의존성(DB, Inbucket 등)을 Docker 컨테이너로 시작하고 Prisma 스키마로 DB를 시드합니다
# Docker(또는 OrbStack)가 설치되어 실행 중인지 확인하세요
pnpm restart-deps

# 개발 서버 시작
pnpm dev

# 다른 터미널에서 워치 모드로 테스트 실행
pnpm test # 유용한 옵션: --no-watch (워치 모드 비활성화) 및 --bail 1 (첫 번째 실패 시 중단)
```

[http://localhost:8100](http://localhost:8100)에서 개발 런치패드를 열 수 있습니다. 거기서 [http://localhost:8101](http://localhost:8101)의 대시보드, 포트 8102의 API, 포트 8103의 데모, 포트 8104의 문서, 포트 8105의 Inbucket(이메일), 포트 8106의 Prisma Studio로 이동할 수 있습니다. 실행 중인 모든 서비스 목록은 개발 런치패드를 참조하세요.

IDE에서 모든 `@stackframe/XYZ` 임포트에 오류가 표시될 수 있습니다. 이를 해결하려면 TypeScript 언어 서버를 재시작하세요. 예를 들어 VSCode에서는 명령 팔레트(Ctrl+Shift+P)를 열고 `Developer: Reload Window` 또는 `TypeScript: Restart TS server`를 실행합니다.

아래 설정을 위한 사전 구성된 .env 파일이 각 패키지의 `.env.development`에 기본적으로 사용되고 있습니다. 그러나 프로덕션 빌드(예: `pnpm run build`)를 생성하는 경우 환경 변수를 수동으로 제공해야 합니다(아래 참조).

### 유용한 명령어

```sh
# 참고:
# 실행 중인 모든 서비스 목록은 개발 런치패드(기본: http://localhost:8100)를 참조하세요.

# 설치 명령어
pnpm install: 의존성 설치

# 타입 및 린트 명령어
pnpm typecheck: TypeScript 타입 체커를 실행합니다. 먼저 빌드 또는 개발 서버 실행이 필요할 수 있습니다.
pnpm lint: ESLint 린터를 실행합니다. 선택적으로 `--fix`를 전달하여 일부 린트 오류를 수정할 수 있습니다. 먼저 빌드 또는 개발 서버 실행이 필요할 수 있습니다.

# 빌드 명령어
pnpm build: 앱, 패키지, 예제, 문서를 포함한 모든 프로젝트를 빌드합니다. 코드 생성 작업도 실행됩니다. 실행 전에 각 폴더의 `.env.development` 파일을 `.env.production.local`로 복사하거나 환경 변수를 수동으로 설정해야 합니다.
pnpm build:packages: 모든 npm 패키지를 빌드합니다.
pnpm codegen: Prisma 클라이언트 및 OpenAPI 문서 생성 등 모든 코드 생성 작업을 실행합니다.

# 개발 명령어
pnpm dev: 대부분의 예제를 제외한 메인 프로젝트의 개발 서버를 실행합니다. 첫 실행 시 패키지 빌드와 코드 생성이 필요합니다. 이후에는 파일 변경(코드 생성 파일 포함)을 감시합니다. 개발 서버를 재시작해야 하는 경우, 그것은 보고할 수 있는 버그입니다.
pnpm dev:full: 예제를 포함한 모든 프로젝트의 개발 서버를 실행합니다.
pnpm dev:basic: 필수 서비스(백엔드와 대시보드)만의 개발 서버를 실행합니다. 대부분의 사용자에게는 권장하지 않으며, 머신 업그레이드를 고려하세요.

# 환경 명령어
pnpm start-deps: 의존성(DB, Inbucket 등)을 Docker 컨테이너로 시작하고 시드 스크립트와 마이그레이션으로 초기화합니다. 참고: 시작된 의존성은 개발 런치패드(기본 포트 8100)에 표시됩니다.
pnpm stop-deps: 의존성(DB, Inbucket 등)을 중지하고 데이터를 삭제합니다.
pnpm restart-deps: 의존성을 중지하고 재시작합니다.

# 데이터베이스 명령어
pnpm db:migration-gen: 현재 사용되지 않습니다. Prisma 마이그레이션은 수동으로(또는 AI를 사용하여) 생성해 주세요.
pnpm db:reset: 데이터베이스를 초기 상태로 리셋합니다. `pnpm start-deps`에 의해 자동 실행됩니다.
pnpm db:init: 시드 스크립트와 마이그레이션으로 데이터베이스를 초기화합니다. `pnpm db:reset`에 의해 자동 실행됩니다.
pnpm db:seed: 시드 스크립트로 데이터베이스를 다시 시드합니다. `pnpm db:init`에 의해 자동 실행됩니다.
pnpm db:migrate: 마이그레이션을 실행합니다. `pnpm db:init`에 의해 자동 실행됩니다.

# 테스트 명령어
pnpm test <file-filters>: 테스트를 실행합니다. `--bail 1`을 전달하면 첫 번째 실패 시 중단됩니다. `--no-watch`를 전달하면 워치 모드 대신 한 번만 실행됩니다.

# 기타 명령어
pnpm explain-query: SQL 쿼리를 붙여넣으면 쿼리 플랜에 대한 설명을 받을 수 있어 성능 문제 디버깅에 도움이 됩니다.
pnpm verify-data-integrity: 일련의 무결성 검사를 실행하여 데이터베이스 데이터의 무결성을 확인합니다. (수동으로 DB를 조작하지 않는 한) 어느 시점에서도 실패하지 않아야 합니다.
```

참고: AI와 작업할 때는 AI가 쿼리를 실행할 수 있도록 개발 서버가 실행 중인 터미널 탭을 열어두는 것이 좋습니다.

## ❤ 기여자

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
