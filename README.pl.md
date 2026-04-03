> To tłumaczenie zostało wygenerowane przez Claude. Sugestie ulepszeń w formie PR są mile widziane.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokumentacja</a>
  | <a href="https://stack-auth.com/">☁️ Wersja hostowana</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | Polski | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Platforma uwierzytelniania open source

Stack Auth to zarządzane rozwiązanie do uwierzytelniania użytkowników. Jest przyjazne dla programistów i w pełni open source (licencjonowane na MIT i AGPL).

Stack Auth pozwala zacząć w zaledwie pięć minut, po czym będziesz mógł korzystać ze wszystkich funkcji w miarę rozwoju projektu. Nasza usługa zarządzana jest całkowicie opcjonalna, a Ty możesz wyeksportować dane użytkowników i hostować samodzielnie, za darmo, w dowolnym momencie.

Obsługujemy frontendy Next.js, React i JavaScript, a także dowolny backend, który może korzystać z naszego [REST API](https://docs.stack-auth.com/api/overview). Sprawdź nasz [przewodnik konfiguracji](https://docs.stack-auth.com/docs/next/getting-started/setup), aby zacząć.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Czym to się różni od X?

Zadaj sobie pytania o `X`:

- Czy `X` jest open source?
- Czy `X` jest przyjazny dla programistów, dobrze udokumentowany i pozwala zacząć w kilka minut?
- Czy oprócz uwierzytelniania `X` oferuje również autoryzację i zarządzanie użytkownikami (zobacz listę funkcji poniżej)?

Jeśli na którekolwiek z tych pytań odpowiedziałeś "nie", to właśnie tym Stack Auth różni się od `X`.

## ✨ Funkcje

Aby otrzymywać powiadomienia o nowych funkcjach jako pierwszy, zapisz się do [naszego newslettera](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` i `<SignUp/>`</h3> Komponenty uwierzytelniania obsługujące OAuth, logowanie hasłem i magic links, ze współdzielonymi kluczami deweloperskimi dla szybszej konfiguracji. Wszystkie komponenty obsługują tryb ciemny/jasny. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Idiomatyczne API Next.js</h3> Budujemy na server components, React hooks i route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Panel użytkowników</h3> Panel do filtrowania, analizowania i edycji użytkowników. Zastępuje pierwsze narzędzie wewnętrzne, które musiałbyś zbudować. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Ustawienia konta</h3> Pozwala użytkownikom aktualizować profil, weryfikować e-mail lub zmieniać hasło. Bez dodatkowej konfiguracji. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy i zespoły</h3> Zarządzaj klientami B2B ze strukturą organizacyjną, która ma sens i skaluje się do milionów. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Kontrola dostępu oparta na rolach</h3> Zdefiniuj dowolny graf uprawnień i przypisz go użytkownikom. Organizacje mogą tworzyć role specyficzne dla organizacji. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Połączenia OAuth</h3> Oprócz logowania Stack Auth może również zarządzać tokenami dostępu do API firm trzecich, takich jak Outlook i Google Calendar. Obsługuje odświeżanie tokenów i kontrolę zakresu, udostępniając tokeny dostępu za pomocą jednego wywołania funkcji. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Obsługa uwierzytelniania bez hasła za pomocą passkeys, umożliwiająca użytkownikom bezpieczne logowanie biometrią lub kluczami bezpieczeństwa na wszystkich urządzeniach. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Personifikacja użytkowników</h3> Personifikuj użytkowników w celach debugowania i wsparcia, logując się na ich konto tak, jakbyś był nimi. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Otrzymuj powiadomienia, gdy użytkownicy korzystają z Twojego produktu, zbudowane na Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Automatyczne e-maile</h3> Wysyłaj konfigurowalne e-maile przy zdarzeniach takich jak rejestracja, reset hasła i weryfikacja e-mail, edytowalne za pomocą edytora WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Obsługa sesji użytkownika i JWT</h3> Stack Auth zarządza tokenami odświeżania i dostępu, JWT i ciasteczkami, zapewniając najlepszą wydajność bez kosztów implementacji. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Uwierzytelnianie M2M</h3> Używaj krótkoterminowych tokenów dostępu do uwierzytelniania maszyn między sobą. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Instalacja i konfiguracja

Aby zainstalować Stack Auth w projekcie Next.js (dla React, JavaScript lub innych frameworków, zobacz [pełną dokumentację](https://docs.stack-auth.com)):

1. Uruchom kreator instalacji Stack Auth następującym poleceniem:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Następnie utwórz konto na [panelu Stack Auth](https://app.stack-auth.com/projects), utwórz nowy projekt z kluczem API i skopiuj zmienne środowiskowe do pliku .env.local w projekcie Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. To wszystko! Możesz uruchomić aplikację za pomocą `npm run dev` i przejść do [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup), aby zobaczyć stronę rejestracji. Możesz też sprawdzić stronę ustawień konta pod adresem [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Sprawdź [dokumentację](https://docs.stack-auth.com/getting-started/setup), aby uzyskać bardziej szczegółowy przewodnik.

## 🌱 Wybrane projekty społeczności zbudowane ze Stack Auth

Masz własny projekt? Chętnie go wyróżnimy, jeśli utworzysz PR lub napiszesz do nas na [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Rozwój i wkład

Ta sekcja jest dla Ciebie, jeśli chcesz wnieść wkład w projekt Stack Auth lub uruchomić panel Stack Auth lokalnie.

**Ważne**: Przeczytaj uważnie [wytyczne dotyczące wkładu](CONTRIBUTING.md) i dołącz do [naszego Discorda](https://discord.stack-auth.com), jeśli chcesz pomóc.

### Wymagania

- Node v20
- pnpm v9
- Docker

### Konfiguracja

Uwaga: Zalecane jest 24GB+ RAM dla płynnego doświadczenia programistycznego.

W nowym terminalu:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# W innym terminalu uruchom testy w trybie obserwowania
pnpm test
```

Teraz możesz otworzyć stronę startową deweloperską pod adresem [http://localhost:8100](http://localhost:8100). Stamtąd możesz przejść do panelu pod [http://localhost:8101](http://localhost:8101), API na porcie 8102, demo na porcie 8103, dokumentacji na porcie 8104, Inbucket (e-maile) na porcie 8105 i Prisma Studio na porcie 8106. Zobacz stronę startową deweloperską, aby zobaczyć listę wszystkich uruchomionych usług.

Twoje IDE może wyświetlać błąd na wszystkich importach `@stackframe/XYZ`. Aby to naprawić, po prostu uruchom ponownie TypeScript language server; na przykład w VSCode możesz otworzyć paletę poleceń (Ctrl+Shift+P) i uruchomić `Developer: Reload Window` lub `TypeScript: Restart TS server`.

Wstępnie wypełnione pliki .env dla poniższej konfiguracji są dostępne i używane domyślnie w `.env.development` w każdym z pakietów. Jeśli jednak tworzysz build produkcyjny (np. za pomocą `pnpm run build`), musisz dostarczyć zmienne środowiskowe ręcznie (patrz poniżej).

### Przydatne polecenia

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

Uwaga: Pracując z AI, warto mieć otwartą kartę terminala z dev serverem, aby AI mogło wykonywać zapytania.

## ❤ Współtwórcy

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
