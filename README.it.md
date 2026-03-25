> Questa traduzione è stata generata da Claude. Se hai suggerimenti per migliorarla, le PR sono benvenute.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Documentazione</a>
  | <a href="https://stack-auth.com/">☁️ Versione Hosted</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | Italiano | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: La piattaforma di autenticazione open-source

Stack Auth è una soluzione gestita per l'autenticazione degli utenti. È pensata per gli sviluppatori e completamente open-source (con licenza MIT e AGPL).

Stack Auth ti permette di iniziare in soli cinque minuti, dopodiché sarai pronto a utilizzare tutte le sue funzionalità man mano che il tuo progetto cresce. Il nostro servizio gestito è completamente opzionale e puoi esportare i dati dei tuoi utenti e fare self-hosting, gratuitamente, in qualsiasi momento.

Supportiamo frontend Next.js, React e JavaScript, insieme a qualsiasi backend che possa utilizzare la nostra [REST API](https://docs.stack-auth.com/api/overview). Consulta la nostra [guida alla configurazione](https://docs.stack-auth.com/docs/next/getting-started/setup) per iniziare.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## In cosa è diverso da X?

Chiediti riguardo a `X`:

- `X` è open-source?
- `X` è pensato per gli sviluppatori, ben documentato e ti permette di iniziare in pochi minuti?
- Oltre all'autenticazione, `X` gestisce anche l'autorizzazione e la gestione degli utenti (vedi l'elenco delle funzionalità qui sotto)?

Se hai risposto "no" a una qualsiasi di queste domande, ecco in cosa Stack Auth è diverso da `X`.

## ✨ Funzionalità

Per ricevere per primo le notifiche sulle nuove funzionalità, iscriviti alla [nostra newsletter](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` e `<SignUp/>`</h3> Componenti di autenticazione che supportano OAuth, credenziali con password e magic link, con chiavi di sviluppo condivise per velocizzare la configurazione. Tutti i componenti supportano la modalità scura/chiara. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>API idiomatiche per Next.js</h3> Costruiamo su server component, React hook e route handler. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Dashboard utenti</h3> Dashboard per filtrare, analizzare e modificare gli utenti. Sostituisce il primo strumento interno che avresti dovuto costruire. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Impostazioni account</h3> Permette agli utenti di aggiornare il proprio profilo, verificare la propria e-mail o cambiare la password. Nessuna configurazione necessaria. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy e team</h3> Gestisci i clienti B2B con una struttura organizzativa logica e scalabile fino a milioni di utenti. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Controllo degli accessi basato sui ruoli</h3> Definisci un grafo di permessi arbitrario e assegnalo agli utenti. Le organizzazioni possono creare ruoli specifici per la propria organizzazione. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Connessioni OAuth</h3>Oltre al login, Stack Auth può anche gestire i token di accesso per API di terze parti, come Outlook e Google Calendar. Gestisce il rinnovo dei token e il controllo degli scope, rendendo i token di accesso accessibili tramite una singola chiamata di funzione. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkey</h3> Supporto per l'autenticazione senza password tramite passkey, che consente agli utenti di accedere in modo sicuro con dati biometrici o chiavi di sicurezza su tutti i loro dispositivi. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Impersonificazione</h3> Impersona gli utenti per il debug e il supporto, accedendo al loro account come se fossi loro. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhook</h3> Ricevi notifiche quando gli utenti utilizzano il tuo prodotto, basato su Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Email automatiche</h3> Invia email personalizzabili in risposta a eventi come la registrazione, il reset della password e la verifica dell'email, modificabili con un editor WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Gestione sessioni utente e JWT</h3> Stack Auth gestisce refresh e access token, JWT e cookie, garantendo le migliori prestazioni senza costi di implementazione. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Autenticazione M2M</h3> Usa token di accesso a breve durata per autenticare le tue macchine con altre macchine. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Installazione e configurazione

Per installare Stack Auth nel tuo progetto Next.js (per React, JavaScript o altri framework, consulta la nostra [documentazione completa](https://docs.stack-auth.com)):

1. Esegui la procedura guidata di installazione di Stack Auth con il seguente comando:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Quindi, crea un account sulla [dashboard di Stack Auth](https://app.stack-auth.com/projects), crea un nuovo progetto con una chiave API e copia le variabili d'ambiente nel file .env.local del tuo progetto Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Ecco fatto! Puoi avviare la tua app con `npm run dev` e andare su [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) per vedere la pagina di registrazione. Puoi anche consultare la pagina delle impostazioni dell'account su [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Consulta la [documentazione](https://docs.stack-auth.com/getting-started/setup) per una guida più dettagliata.

## 🌱 Alcuni progetti della community realizzati con Stack Auth

Hai il tuo progetto? Saremo felici di includerlo se crei una PR o ci scrivi su [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Sviluppo e contributi

Questa sezione è per te se vuoi contribuire al progetto Stack Auth o eseguire la dashboard di Stack Auth in locale.

**Importante**: leggi attentamente le [linee guida per i contributi](CONTRIBUTING.md) e unisciti al [nostro Discord](https://discord.stack-auth.com) se vuoi aiutare.

### Requisiti

- Node v20
- pnpm v9
- Docker

### Configurazione

Nota: sono consigliati 24GB+ di RAM per un'esperienza di sviluppo fluida.

In un nuovo terminale:

```sh
pnpm install

# Compila i pacchetti e genera il codice. Dobbiamo farlo solo una volta, poiché `pnpm dev` lo farà da ora in poi
pnpm build:packages
pnpm codegen

# Avvia le dipendenze (DB, Inbucket, ecc.) come container Docker, inizializzando il DB con lo schema Prisma
# Assicurati di avere Docker (o OrbStack) installato e in esecuzione
pnpm restart-deps

# Avvia il server di sviluppo
pnpm dev

# In un altro terminale, esegui i test in modalità watch
pnpm test # utile: --no-watch (disabilita la modalità watch) e --bail 1 (si ferma dopo il primo errore)
```

Ora puoi aprire il launchpad di sviluppo su [http://localhost:8100](http://localhost:8100). Da lì, puoi navigare alla dashboard su [http://localhost:8101](http://localhost:8101), all'API sulla porta 8102, alla demo sulla porta 8103, alla documentazione sulla porta 8104, a Inbucket (e-mail) sulla porta 8105 e a Prisma Studio sulla porta 8106. Consulta il launchpad di sviluppo per un elenco di tutti i servizi in esecuzione.

Il tuo IDE potrebbe mostrare un errore su tutti gli import `@stackframe/XYZ`. Per risolvere, riavvia semplicemente il server del linguaggio TypeScript; ad esempio, in VSCode puoi aprire la palette dei comandi (Ctrl+Shift+P) ed eseguire `Developer: Reload Window` o `TypeScript: Restart TS server`.

I file .env precompilati per la configurazione seguente sono disponibili e utilizzati per impostazione predefinita in `.env.development` in ciascuno dei pacchetti. Tuttavia, se stai creando una build di produzione (ad es. con `pnpm run build`), devi fornire le variabili d'ambiente manualmente (vedi sotto).

### Comandi utili

```sh
# NOTA:
# Consulta il launchpad di sviluppo (default: http://localhost:8100) per un elenco di tutti i servizi in esecuzione.

# Comandi di installazione
pnpm install: Installa le dipendenze

# Comandi per tipi e linting
pnpm typecheck: Esegue il controllo dei tipi TypeScript. Potrebbe richiedere una build o un server di sviluppo in esecuzione.
pnpm lint: Esegue il linter ESLint. Opzionalmente, passa `--fix` per correggere alcuni errori di linting. Potrebbe richiedere una build o un server di sviluppo in esecuzione.

# Comandi di build
pnpm build: Compila tutti i progetti, incluse app, pacchetti, esempi e documentazione. Esegue anche le attività di generazione del codice. Prima di eseguirlo, dovrai copiare tutti i file `.env.development` nelle cartelle in `.env.production.local` o impostare le variabili d'ambiente manualmente.
pnpm build:packages: Compila tutti i pacchetti npm.
pnpm codegen: Esegue tutte le attività di generazione del codice, ad es. la generazione del client Prisma e della documentazione OpenAPI.

# Comandi di sviluppo
pnpm dev: Avvia i server di sviluppo dei progetti principali, escludendo la maggior parte degli esempi. Alla prima esecuzione, richiede che i pacchetti siano compilati e il codegen sia stato eseguito. Successivamente, controllerà le modifiche ai file (inclusi quelli di generazione del codice). Se devi riavviare il server di sviluppo per qualsiasi motivo, è un bug che puoi segnalare.
pnpm dev:full: Avvia i server di sviluppo per tutti i progetti, inclusi gli esempi.
pnpm dev:basic: Avvia i server di sviluppo solo per i servizi necessari (backend e dashboard). Non consigliato per la maggior parte degli utenti, piuttosto aggiorna la tua macchina.

# Comandi per l'ambiente
pnpm start-deps: Avvia le dipendenze Docker (DB, Inbucket, ecc.) come container Docker e le inizializza con lo script di seed e le migrazioni. Nota: le dipendenze avviate saranno visibili nel launchpad di sviluppo (porta 8100 per impostazione predefinita).
pnpm stop-deps: Ferma le dipendenze Docker (DB, Inbucket, ecc.) e cancella i dati associati.
pnpm restart-deps: Ferma e riavvia le dipendenze.

# Comandi per il database
pnpm db:migration-gen: Attualmente non utilizzato. Genera le migrazioni Prisma manualmente (o con l'AI).
pnpm db:reset: Resetta il database allo stato iniziale. Eseguito automaticamente da `pnpm start-deps`.
pnpm db:init: Inizializza il database con lo script di seed e le migrazioni. Eseguito automaticamente da `pnpm db:reset`.
pnpm db:seed: Re-esegue il seed del database con lo script di seed. Eseguito automaticamente da `pnpm db:init`.
pnpm db:migrate: Esegue le migrazioni. Eseguito automaticamente da `pnpm db:init`.

# Comandi di test
pnpm test <file-filters>: Esegue i test. Passa `--bail 1` per far eseguire i test solo fino al primo errore. Passa `--no-watch` per eseguire i test una sola volta anziché in modalità watch.

# Comandi vari
pnpm explain-query: Incolla una query SQL per ottenere una spiegazione del piano di query, utile per il debug dei problemi di prestazioni.
pnpm verify-data-integrity: Verifica l'integrità dei dati nel database eseguendo una serie di controlli. Questo non dovrebbe mai fallire in nessun momento (a meno che tu non abbia modificato il DB manualmente).
```

Nota: quando lavori con l'AI, dovresti tenere aperta una scheda del terminale con il server di sviluppo in modo che l'AI possa eseguire query su di esso.

## ❤ Contributori

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
