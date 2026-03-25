> Denne oversættelse er genereret af Claude. Forslag til forbedringer via PR er velkomne.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokumentation</a>
  | <a href="https://stack-auth.com/">☁️ Hostet version</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | Dansk | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Den open source-autentificeringsplatform

Stack Auth er en administreret brugerautentificeringsløsning. Den er udviklervenlig og fuldt open source (licenseret under MIT og AGPL).

Stack Auth får dig i gang på bare fem minutter, hvorefter du er klar til at bruge alle funktionerne, efterhånden som dit projekt vokser. Vores administrerede tjeneste er helt valgfri, og du kan eksportere dine brugerdata og selv-hoste, gratis, når som helst.

Vi understøtter Next.js, React og JavaScript-frontends sammen med enhver backend, der kan bruge vores [REST API](https://docs.stack-auth.com/api/overview). Se vores [opsætningsguide](https://docs.stack-auth.com/docs/next/getting-started/setup) for at komme i gang.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Hvordan adskiller dette sig fra X?

Stil dig selv disse spørgsmål om `X`:

- Er `X` open source?
- Er `X` udviklervenlig, veldokumenteret, og kan du komme i gang på få minutter?
- Udover autentificering, tilbyder `X` også autorisering og brugeradministration (se funktionslisten nedenfor)?

Hvis du svarede "nej" til nogen af disse spørgsmål, så er det sådan Stack Auth adskiller sig fra `X`.

## ✨ Funktioner

For at blive notificeret først, når vi tilføjer nye funktioner, kan du abonnere på [vores nyhedsbrev](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` og `<SignUp/>`</h3> Autentificeringskomponenter der understøtter OAuth, adgangskodelogin og magic links, med delte udviklingsnøgler for hurtigere opsætning. Alle komponenter understøtter mørk/lys tilstand. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Idiomatiske Next.js API'er</h3> Vi bygger på server components, React hooks og route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Bruger-dashboard</h3> Dashboard til at filtrere, analysere og redigere brugere. Erstatter det første interne værktøj, du ellers ville skulle bygge. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Kontoindstillinger</h3> Lader brugere opdatere deres profil, verificere deres e-mail eller ændre deres adgangskode. Ingen opsætning krævet. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy & teams</h3> Administrer B2B-kunder med en organisationsstruktur, der giver mening og skalerer til millioner. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Rollebaseret adgangskontrol</h3> Definer en vilkårlig rettighedsgraf og tildel den til brugere. Organisationer kan oprette organisationsspecifikke roller. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth-forbindelser</h3> Udover login kan Stack Auth også administrere access tokens til tredjeparts-API'er som Outlook og Google Calendar. Det håndterer fornyelse af tokens og styring af scope, så access tokens er tilgængelige via et enkelt funktionskald. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Understøttelse af adgangskodefri autentificering med passkeys, der giver brugere mulighed for at logge ind sikkert med biometri eller sikkerhedsnøgler på tværs af alle deres enheder. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Brugerefterligning</h3> Efterlign brugere til fejlfinding og support ved at logge ind på deres konto, som om du var dem. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Bliv notificeret, når brugere anvender dit produkt, bygget på Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Automatiske e-mails</h3> Send tilpassede e-mails ved hændelser som tilmelding, nulstilling af adgangskode og e-mailbekræftelse, redigerbare med en WYSIWYG-editor. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Brugersession & JWT-håndtering</h3> Stack Auth administrerer refresh- og access tokens, JWT'er og cookies, hvilket giver den bedste ydeevne uden implementeringsomkostninger. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M-autentificering</h3> Brug kortvarige access tokens til at autentificere dine maskiner mod andre maskiner. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Installation & opsætning

For at installere Stack Auth i dit Next.js-projekt (for React, JavaScript eller andre frameworks, se vores [komplette dokumentation](https://docs.stack-auth.com)):

1. Kør Stack Auths installationsguide med følgende kommando:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Opret derefter en konto på [Stack Auth-dashboardet](https://app.stack-auth.com/projects), opret et nyt projekt med en API-nøgle, og kopiér miljøvariablerne til .env.local-filen i dit Next.js-projekt:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Det var det! Du kan køre din app med `npm run dev` og gå til [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) for at se tilmeldingssiden. Du kan også se kontoindstillingssiden på [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Se [dokumentationen](https://docs.stack-auth.com/getting-started/setup) for en mere detaljeret guide.

## 🌱 Nogle fællesskabsprojekter bygget med Stack Auth

Har du dit eget? Vi vil gerne fremhæve det, hvis du opretter en PR eller skriver til os på [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Udvikling & bidrag

Dette afsnit er for dig, hvis du vil bidrage til Stack Auth-projektet eller køre Stack Auth-dashboardet lokalt.

**Vigtigt**: Læs venligst [retningslinjerne for bidrag](CONTRIBUTING.md) omhyggeligt og tilslut dig [vores Discord](https://discord.stack-auth.com), hvis du gerne vil hjælpe.

### Krav

- Node v20
- pnpm v9
- Docker

### Opsætning

Bemærk: 24GB+ RAM anbefales for en problemfri udviklingsoplevelse.

I en ny terminal:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# I en anden terminal, kør tests i watch-tilstand
pnpm test
```

Du kan nu åbne dev-launchpadden på [http://localhost:8100](http://localhost:8100). Derfra kan du navigere til dashboardet på [http://localhost:8101](http://localhost:8101), API på port 8102, demo på port 8103, dokumentation på port 8104, Inbucket (e-mails) på port 8105 og Prisma Studio på port 8106. Se dev-launchpadden for en liste over alle kørende tjenester.

Din IDE viser muligvis en fejl på alle `@stackframe/XYZ`-imports. For at løse dette skal du blot genstarte TypeScript language server; for eksempel i VSCode kan du åbne kommandopaletten (Ctrl+Shift+P) og køre `Developer: Reload Window` eller `TypeScript: Restart TS server`.

Forududfyldte .env-filer til opsætningen nedenfor er tilgængelige og bruges som standard i `.env.development` i hver af pakkerne. Hvis du dog opretter en produktionsbuild (f.eks. med `pnpm run build`), skal du levere miljøvariablerne manuelt (se nedenfor).

### Nyttige kommandoer

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

Bemærk: Når du arbejder med AI, bør du holde en terminalfane åben med dev-serveren, så AI'en kan køre forespørgsler mod den.

## ❤ Bidragydere

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
