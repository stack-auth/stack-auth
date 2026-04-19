> Этот перевод сгенерирован Claude. Если у вас есть предложения по улучшению, PR приветствуются.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Документация</a>
  | <a href="https://stack-auth.com/">☁️ Облачная версия</a>
  | <a href="https://demo.stack-auth.com/">✨ Демо</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | Русский | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: платформа аутентификации с открытым исходным кодом

Stack Auth — это управляемое решение для аутентификации пользователей. Оно удобно для разработчиков и полностью открыто (лицензировано под MIT и AGPL).

Stack Auth позволяет начать работу всего за пять минут, после чего вы сможете использовать все его возможности по мере роста вашего проекта. Наш управляемый сервис полностью опционален, и вы можете экспортировать данные пользователей и разместить систему самостоятельно, бесплатно, в любое время.

Мы поддерживаем фронтенды на Next.js, React и JavaScript, а также любой бэкенд, который может использовать наш [REST API](https://docs.stack-auth.com/api/overview). Ознакомьтесь с нашим [руководством по настройке](https://docs.stack-auth.com/docs/next/getting-started/setup), чтобы начать.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Чем это отличается от X?

Задайте себе вопросы о `X`:

- Является ли `X` проектом с открытым исходным кодом?
- Удобен ли `X` для разработчиков, хорошо ли задокументирован, и можно ли начать работу за считанные минуты?
- Помимо аутентификации, поддерживает ли `X` также авторизацию и управление пользователями (см. список функций ниже)?

Если вы ответили «нет» на любой из этих вопросов, то именно этим Stack Auth отличается от `X`.

## ✨ Возможности

Чтобы первыми узнавать о новых функциях, подпишитесь на [нашу рассылку](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` и `<SignUp/>`</h3> Компоненты аутентификации, поддерживающие OAuth, вход по паролю и магические ссылки, с общими ключами разработки для ускорения настройки. Все компоненты поддерживают тёмную и светлую темы. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Идиоматичные API для Next.js</h3> Мы используем серверные компоненты, хуки React и обработчики маршрутов. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Панель управления пользователями</h3> Панель для фильтрации, анализа и редактирования пользователей. Заменяет первый внутренний инструмент, который вам пришлось бы создавать. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Настройки аккаунта</h3> Позволяет пользователям обновлять профиль, подтверждать электронную почту или менять пароль. Настройка не требуется. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Мультиарендность и команды</h3> Управляйте B2B-клиентами с помощью организационной структуры, которая логична и масштабируется до миллионов. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Управление доступом на основе ролей</h3> Определите произвольный граф разрешений и назначьте его пользователям. Организации могут создавать роли, специфичные для организации. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth-подключения</h3>Помимо входа в систему, Stack Auth также может управлять токенами доступа для сторонних API, таких как Outlook и Google Calendar. Он обрабатывает обновление токенов и управление областями действия, делая токены доступа доступными через один вызов функции. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Поддержка беспарольной аутентификации с помощью passkeys, позволяющая пользователям безопасно входить в систему с помощью биометрии или аппаратных ключей безопасности на всех их устройствах. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Имперсонация</h3> Имперсонируйте пользователей для отладки и поддержки, входя в их аккаунт, как если бы вы были ими. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Вебхуки</h3> Получайте уведомления, когда пользователи используют ваш продукт, на базе Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Автоматические письма</h3> Отправляйте настраиваемые письма по триггерам, таким как регистрация, сброс пароля и подтверждение электронной почты, редактируемые с помощью WYSIWYG-редактора. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Управление сессиями и JWT</h3> Stack Auth управляет токенами обновления и доступа, JWT и куками, обеспечивая лучшую производительность без затрат на реализацию. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Аутентификация между машинами (M2M)</h3> Используйте краткосрочные токены доступа для аутентификации ваших машин на других машинах. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Установка и настройка

Чтобы установить Stack Auth в вашем проекте на Next.js (для React, JavaScript или других фреймворков см. нашу [полную документацию](https://docs.stack-auth.com)):

1. Запустите мастер установки Stack Auth следующей командой:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Затем создайте аккаунт на [панели управления Stack Auth](https://app.stack-auth.com/projects), создайте новый проект с API-ключом и скопируйте его переменные окружения в файл .env.local вашего проекта Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Готово! Вы можете запустить приложение с помощью `npm run dev` и перейти по адресу [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup), чтобы увидеть страницу регистрации. Вы также можете посмотреть страницу настроек аккаунта по адресу [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Ознакомьтесь с [документацией](https://docs.stack-auth.com/getting-started/setup) для более подробного руководства.

## 🌱 Проекты сообщества, созданные с помощью Stack Auth

Есть свой проект? Мы будем рады добавить его, если вы создадите PR или напишете нам в [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Разработка и участие

Этот раздел для вас, если вы хотите внести вклад в проект Stack Auth или запустить панель управления Stack Auth локально.

**Важно**: пожалуйста, внимательно прочитайте [руководство по участию](CONTRIBUTING.md) и присоединяйтесь к [нашему Discord](https://discord.stack-auth.com), если хотите помочь.

### Требования

- Node v20
- pnpm v9
- Docker

### Настройка

Примечание: для комфортной разработки рекомендуется 24 ГБ+ оперативной памяти.

В новом терминале:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# В другом терминале запустите тесты в режиме наблюдения
pnpm test
```

Теперь вы можете открыть панель разработки по адресу [http://localhost:8100](http://localhost:8100). Оттуда вы можете перейти к панели управления по адресу [http://localhost:8101](http://localhost:8101), API на порту 8102, демо на порту 8103, документация на порту 8104, Inbucket (электронная почта) на порту 8105 и Prisma Studio на порту 8106. См. панель разработки для списка всех запущенных сервисов.

Ваша IDE может показывать ошибку на всех импортах `@stackframe/XYZ`. Чтобы это исправить, просто перезапустите языковой сервер TypeScript; например, в VSCode вы можете открыть палитру команд (Ctrl+Shift+P) и выполнить `Developer: Reload Window` или `TypeScript: Restart TS server`.

Предзаполненные файлы .env для настройки ниже доступны и используются по умолчанию в `.env.development` в каждом из пакетов. Однако, если вы создаёте продакшн-сборку (например, с помощью `pnpm run build`), вы должны указать переменные окружения вручную (см. ниже).

### Полезные команды

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm build:packages
pnpm codegen
pnpm dev
pnpm dev:full
pnpm dev:basic
pnpm start-deps
pnpm stop-deps
pnpm restart-deps
pnpm db:migration-gen
pnpm db:reset
pnpm db:init
pnpm db:seed
pnpm db:migrate
pnpm test <file-filters>
pnpm explain-query
pnpm verify-data-integrity
```

Примечание: при работе с ИИ рекомендуется держать открытой вкладку терминала с dev-сервером, чтобы ИИ мог выполнять запросы к нему.

## ❤ Участники

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
