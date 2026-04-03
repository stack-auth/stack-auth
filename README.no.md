> Denne oversettelsen er generert av Claude. Forslag til forbedringer via PR er velkomne.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokumentasjon</a>
  | <a href="https://stack-auth.com/">☁️ Skytjeneste</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | Norsk | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Autentiseringsplattformen med åpen kildekode

Stack Auth er en administrert løsning for brukerautentisering. Den er utviklervennlig og fullstendig åpen kildekode (lisensiert under MIT og AGPL).

Stack Auth får deg i gang på bare fem minutter, og deretter er du klar til å bruke alle funksjonene etter hvert som prosjektet ditt vokser. Vår administrerte tjeneste er helt valgfri, og du kan eksportere brukerdataene dine og kjøre selv, gratis, når som helst.

Vi støtter Next.js, React og JavaScript-frontender, sammen med enhver backend som kan bruke vårt [REST API](https://docs.stack-auth.com/api/overview). Sjekk ut vår [oppsettguide](https://docs.stack-auth.com/docs/next/getting-started/setup) for å komme i gang.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Hvordan er dette forskjellig fra X?

Still deg selv følgende spørsmål om `X`:

- Er `X` åpen kildekode?
- Er `X` utviklervennlig, godt dokumentert, og lar deg komme i gang på minutter?
- I tillegg til autentisering, håndterer `X` også autorisasjon og brukeradministrasjon (se funksjonslisten nedenfor)?

Hvis du svarte "nei" på noen av disse spørsmålene, så er det slik Stack Auth skiller seg fra `X`.

## ✨ Funksjoner

For å bli varslet først når vi legger til nye funksjoner, vennligst abonner på [vårt nyhetsbrev](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` og `<SignUp/>`</h3> Autentiseringskomponenter som støtter OAuth, passordpålogging og magiske lenker, med delte utviklingsnøkler for raskere oppsett. Alle komponenter støtter mørk/lys modus. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Idiomatiske Next.js-APIer</h3> Vi bygger på serverkomponenter, React hooks og rutebehandlere. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Brukerkontrollpanel</h3> Kontrollpanel for å filtrere, analysere og redigere brukere. Erstatter det første interne verktøyet du ellers måtte bygge. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Kontoinnstillinger</h3> Lar brukere oppdatere profilen sin, verifisere e-posten sin eller endre passordet sitt. Ingen oppsett nødvendig. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Flerleietakere og team</h3> Administrer B2B-kunder med en organisasjonsstruktur som gir mening og skalerer til millioner. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Rollebasert tilgangskontroll</h3> Definer en vilkårlig tillatelsesstruktur og tildel den til brukere. Organisasjoner kan opprette organisasjonsspesifikke roller. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth-tilkoblinger</h3>Utover pålogging kan Stack Auth også administrere tilgangstokener for tredjeparts-APIer, som Outlook og Google Calendar. Den håndterer oppdatering av tokener og kontroll av omfang, slik at tilgangstokener er tilgjengelige via ett enkelt funksjonskall. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passnøkler</h3> Støtte for passordløs autentisering med passnøkler, som lar brukere logge inn sikkert med biometri eller sikkerhetsnøkler på alle enhetene sine. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Etterligning</h3> Etterlign brukere for feilsøking og support, ved å logge inn på kontoen deres som om du var dem. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Bli varslet når brukere bruker produktet ditt, bygget på Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Automatiske e-poster</h3> Send tilpassbare e-poster ved hendelser som registrering, tilbakestilling av passord og e-postverifisering, redigerbare med en WYSIWYG-editor. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Brukersesjon- og JWT-håndtering</h3> Stack Auth administrerer oppdaterings- og tilgangstokener, JWTer og informasjonskapsler, noe som gir best mulig ytelse uten implementeringskostnad. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M-autentisering</h3> Bruk kortlevde tilgangstokener for å autentisere maskinene dine mot andre maskiner. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Installasjon og oppsett

For å installere Stack Auth i Next.js-prosjektet ditt (for React, JavaScript eller andre rammeverk, se vår [fullstendige dokumentasjon](https://docs.stack-auth.com)):

1. Kjør Stack Auths installasjonsveiviser med følgende kommando:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Deretter oppretter du en konto på [Stack Auth-kontrollpanelet](https://app.stack-auth.com/projects), oppretter et nytt prosjekt med en API-nøkkel, og kopierer miljøvariablene inn i .env.local-filen i Next.js-prosjektet ditt:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Det er alt! Du kan kjøre appen din med `npm run dev` og gå til [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) for å se registreringssiden. Du kan også sjekke kontoinnstillingssiden på [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Sjekk ut [dokumentasjonen](https://docs.stack-auth.com/getting-started/setup) for en mer detaljert guide.

## 🌱 Noen fellesskapsprosjekter bygget med Stack Auth

Har du ditt eget? Vi legger det gjerne til hvis du oppretter en PR eller sender oss en melding på [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Utvikling og bidrag

Dette er for deg hvis du ønsker å bidra til Stack Auth-prosjektet eller kjøre Stack Auth-kontrollpanelet lokalt.

**Viktig**: Vennligst les [retningslinjene for bidrag](CONTRIBUTING.md) nøye og bli med i [vår Discord](https://discord.stack-auth.com) hvis du ønsker å hjelpe.

### Krav

- Node v20
- pnpm v9
- Docker

### Oppsett

Merk: 24 GB+ RAM anbefales for en smidig utviklingsopplevelse.

I en ny terminal:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# I en annen terminal, kjør tester i overvåkningsmodus
pnpm test
```

Du kan nå åpne utviklerstartsiden på [http://localhost:8100](http://localhost:8100). Derfra kan du navigere til kontrollpanelet på [http://localhost:8101](http://localhost:8101), API på port 8102, demo på port 8103, dokumentasjon på port 8104, Inbucket (e-poster) på port 8105 og Prisma Studio på port 8106. Se utviklerstartsiden for en liste over alle kjørende tjenester.

IDE-en din kan vise en feil på alle `@stackframe/XYZ`-importer. For å fikse dette, start bare TypeScript-språkserveren på nytt; for eksempel i VSCode kan du åpne kommandopaletten (Ctrl+Shift+P) og kjøre `Developer: Reload Window` eller `TypeScript: Restart TS server`.

Forhåndsutfylte .env-filer for oppsettet nedenfor er tilgjengelige og brukes som standard i `.env.development` i hver av pakkene. Hvis du imidlertid lager en produksjonsbygging (f.eks. med `pnpm run build`), må du oppgi miljøvariablene manuelt (se nedenfor).

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

Merk: Når du jobber med AI, bør du holde en terminalfane med utviklingsserveren åpen slik at AI-en kan kjøre spørringer mot den.

## ❤ Bidragsytere

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
