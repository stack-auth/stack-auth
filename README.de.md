> Diese Übersetzung wurde von Claude generiert. Verbesserungsvorschläge sind als PRs willkommen.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokumentation</a>
  | <a href="https://stack-auth.com/">☁️ Gehostete Version</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | Deutsch | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: Die Open-Source-Authentifizierungsplattform

Stack Auth ist eine verwaltete Lösung zur Benutzerauthentifizierung. Sie ist entwicklerfreundlich und vollständig Open Source (lizenziert unter MIT und AGPL).

Stack Auth bringt Sie in nur fünf Minuten zum Laufen, danach können Sie alle Funktionen nutzen, während Ihr Projekt wächst. Unser verwalteter Dienst ist vollständig optional und Sie können Ihre Benutzerdaten jederzeit kostenlos exportieren und selbst hosten.

Wir unterstützen Next.js, React und JavaScript-Frontends sowie jedes Backend, das unsere [REST API](https://docs.stack-auth.com/api/overview) nutzen kann. Schauen Sie sich unseren [Einrichtungsleitfaden](https://docs.stack-auth.com/docs/next/getting-started/setup) an, um loszulegen.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Wie unterscheidet sich das von X?

Stellen Sie sich folgende Fragen über `X`:

- Ist `X` Open Source?
- Ist `X` entwicklerfreundlich, gut dokumentiert und ermöglicht es Ihnen, in Minuten loszulegen?
- Bietet `X` neben Authentifizierung auch Autorisierung und Benutzerverwaltung (siehe Funktionsliste unten)?

Wenn Sie eine dieser Fragen mit "Nein" beantwortet haben, dann ist das der Unterschied zwischen Stack Auth und `X`.

## ✨ Funktionen

Um als Erster über neue Funktionen informiert zu werden, abonnieren Sie bitte [unseren Newsletter](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` und `<SignUp/>`</h3> Authentifizierungskomponenten, die OAuth, Passwort-Anmeldedaten und Magic Links unterstützen, mit gemeinsamen Entwicklungsschlüsseln für eine schnellere Einrichtung. Alle Komponenten unterstützen Dunkel-/Hellmodus. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Idiomatische Next.js-APIs</h3> Wir bauen auf Server Components, React Hooks und Route Handlers auf. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Benutzer-Dashboard</h3> Dashboard zum Filtern, Analysieren und Bearbeiten von Benutzern. Ersetzt das erste interne Tool, das Sie sonst bauen müssten. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Kontoeinstellungen</h3> Ermöglicht Benutzern, ihr Profil zu aktualisieren, ihre E-Mail zu verifizieren oder ihr Passwort zu ändern. Keine Einrichtung erforderlich. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Mandantenfähigkeit & Teams</h3> Verwalten Sie B2B-Kunden mit einer Organisationsstruktur, die sinnvoll ist und auf Millionen skaliert. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Rollenbasierte Zugriffskontrolle</h3> Definieren Sie einen beliebigen Berechtigungsgraphen und weisen Sie ihn Benutzern zu. Organisationen können organisationsspezifische Rollen erstellen. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth-Verbindungen</h3>Über die Anmeldung hinaus kann Stack Auth auch Zugriffstoken für Drittanbieter-APIs wie Outlook und Google Calendar verwalten. Es übernimmt die Token-Aktualisierung und Bereichssteuerung und macht Zugriffstoken über einen einzigen Funktionsaufruf verfügbar. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Unterstützung für passwortlose Authentifizierung mit Passkeys, die es Benutzern ermöglicht, sich sicher mit Biometrie oder Sicherheitsschlüsseln auf allen ihren Geräten anzumelden. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Identitätswechsel</h3> Nehmen Sie die Identität von Benutzern für Debugging und Support an, indem Sie sich in deren Konto einloggen, als wären Sie sie. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Erhalten Sie Benachrichtigungen, wenn Benutzer Ihr Produkt nutzen, basierend auf Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Automatische E-Mails</h3> Senden Sie anpassbare E-Mails bei Ereignissen wie Registrierung, Passwortzurücksetzung und E-Mail-Verifizierung, bearbeitbar mit einem WYSIWYG-Editor. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Benutzersitzungs- & JWT-Verwaltung</h3> Stack Auth verwaltet Refresh- und Access-Token, JWTs und Cookies, was zu bester Leistung ohne Implementierungsaufwand führt. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M-Authentifizierung</h3> Verwenden Sie kurzlebige Zugriffstoken, um Ihre Maschinen bei anderen Maschinen zu authentifizieren. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Installation & Einrichtung

Um Stack Auth in Ihrem Next.js-Projekt zu installieren (für React, JavaScript oder andere Frameworks siehe unsere [vollständige Dokumentation](https://docs.stack-auth.com)):

1. Führen Sie den Installationsassistenten von Stack Auth mit folgendem Befehl aus:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Erstellen Sie dann ein Konto auf dem [Stack Auth Dashboard](https://app.stack-auth.com/projects), erstellen Sie ein neues Projekt mit einem API-Schlüssel und kopieren Sie die Umgebungsvariablen in die .env.local-Datei Ihres Next.js-Projekts:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Das war's! Sie können Ihre App mit `npm run dev` starten und [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) aufrufen, um die Registrierungsseite zu sehen. Sie können auch die Kontoeinstellungsseite unter [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings) besuchen.

Schauen Sie sich die [Dokumentation](https://docs.stack-auth.com/getting-started/setup) für eine ausführlichere Anleitung an.

## 🌱 Einige Community-Projekte mit Stack Auth

Haben Sie ein eigenes? Wir stellen es gerne vor, wenn Sie einen PR erstellen oder uns auf [Discord](https://discord.stack-auth.com) schreiben.

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Entwicklung & Mitwirkung

Dieser Abschnitt ist für Sie, wenn Sie zum Stack Auth-Projekt beitragen oder das Stack Auth-Dashboard lokal ausführen möchten.

**Wichtig**: Bitte lesen Sie die [Mitwirkungsrichtlinien](CONTRIBUTING.md) sorgfältig und treten Sie [unserem Discord](https://discord.stack-auth.com) bei, wenn Sie helfen möchten.

### Voraussetzungen

- Node v20
- pnpm v9
- Docker

### Einrichtung

Hinweis: 24 GB+ RAM werden für eine reibungslose Entwicklungserfahrung empfohlen.

In einem neuen Terminal:

```sh
pnpm install

# Pakete bauen und Code generieren. Dies müssen wir nur einmal tun, da `pnpm dev` dies ab jetzt übernimmt
pnpm build:packages
pnpm codegen

# Abhängigkeiten (DB, Inbucket, etc.) als Docker-Container starten und die DB mit dem Prisma-Schema initialisieren
# Stellen Sie sicher, dass Docker (oder OrbStack) installiert ist und läuft
pnpm restart-deps

# Entwicklungsserver starten
pnpm dev

# In einem anderen Terminal Tests im Watch-Modus ausführen
pnpm test # nützlich: --no-watch (deaktiviert Watch-Modus) und --bail 1 (stoppt nach dem ersten Fehler)
```

Sie können jetzt das Dev-Launchpad unter [http://localhost:8100](http://localhost:8100) öffnen. Von dort können Sie zum Dashboard unter [http://localhost:8101](http://localhost:8101) navigieren, zur API auf Port 8102, zur Demo auf Port 8103, zur Dokumentation auf Port 8104, zu Inbucket (E-Mails) auf Port 8105 und zu Prisma Studio auf Port 8106. Siehe das Dev-Launchpad für eine Liste aller laufenden Dienste.

Ihre IDE zeigt möglicherweise einen Fehler bei allen `@stackframe/XYZ`-Imports an. Um dies zu beheben, starten Sie einfach den TypeScript Language Server neu; z.B. können Sie in VSCode die Befehlspalette (Strg+Umschalt+P) öffnen und `Developer: Reload Window` oder `TypeScript: Restart TS server` ausführen.

Vorab ausgefüllte .env-Dateien für die untenstehende Einrichtung sind verfügbar und werden standardmäßig in `.env.development` in jedem der Pakete verwendet. Wenn Sie jedoch einen Produktions-Build erstellen (z.B. mit `pnpm run build`), müssen Sie die Umgebungsvariablen manuell bereitstellen (siehe unten).

### Nützliche Befehle

```sh
# HINWEIS:
# Bitte sehen Sie sich das Dev-Launchpad (Standard: http://localhost:8100) für eine Liste aller laufenden Dienste an.

# Installationsbefehle
pnpm install: Installiert Abhängigkeiten

# Typ- & Linting-Befehle
pnpm typecheck: Führt den TypeScript-Typprüfer aus. Erfordert möglicherweise einen Build oder laufenden Dev-Server.
pnpm lint: Führt den ESLint-Linter aus. Optional `--fix` übergeben, um einige Linting-Fehler zu beheben. Erfordert möglicherweise einen Build oder laufenden Dev-Server.

# Build-Befehle
pnpm build: Baut alle Projekte, einschließlich Apps, Pakete, Beispiele und Dokumentation. Führt auch Code-Generierungsaufgaben aus. Bevor Sie dies ausführen können, müssen Sie alle `.env.development`-Dateien in den Ordnern nach `.env.production.local` kopieren oder die Umgebungsvariablen manuell setzen.
pnpm build:packages: Baut alle npm-Pakete.
pnpm codegen: Führt alle Code-Generierungsaufgaben aus, z.B. Prisma-Client- und OpenAPI-Dokumentationsgenerierung.

# Entwicklungsbefehle
pnpm dev: Führt die Entwicklungsserver der Hauptprojekte aus, ohne die meisten Beispiele. Beim ersten Ausführen müssen die Pakete gebaut und Codegen ausgeführt sein. Danach überwacht es Dateiänderungen (einschließlich Code-Generierungsdateien). Wenn Sie den Entwicklungsserver aus irgendeinem Grund neu starten müssen, ist das ein Bug, den Sie melden können.
pnpm dev:full: Führt die Entwicklungsserver für alle Projekte aus, einschließlich Beispiele.
pnpm dev:basic: Führt die Entwicklungsserver nur für die notwendigen Dienste (Backend und Dashboard) aus. Für die meisten Benutzer nicht empfohlen, upgraden Sie stattdessen Ihre Hardware.

# Umgebungsbefehle
pnpm start-deps: Startet die Docker-Abhängigkeiten (DB, Inbucket, etc.) als Docker-Container und initialisiert sie mit dem Seed-Skript & Migrationen. Hinweis: Die gestarteten Abhängigkeiten sind im Dev-Launchpad (standardmäßig Port 8100) sichtbar.
pnpm stop-deps: Stoppt die Docker-Abhängigkeiten (DB, Inbucket, etc.) und löscht deren Daten.
pnpm restart-deps: Stoppt und startet die Abhängigkeiten.

# Datenbankbefehle
pnpm db:migration-gen: Derzeit nicht verwendet. Bitte generieren Sie Prisma-Migrationen manuell (oder mit KI).
pnpm db:reset: Setzt die Datenbank auf den Ausgangszustand zurück. Wird automatisch von `pnpm start-deps` ausgeführt.
pnpm db:init: Initialisiert die Datenbank mit dem Seed-Skript & Migrationen. Wird automatisch von `pnpm db:reset` ausgeführt.
pnpm db:seed: Befüllt die Datenbank erneut mit dem Seed-Skript. Wird automatisch von `pnpm db:init` ausgeführt.
pnpm db:migrate: Führt die Migrationen aus. Wird automatisch von `pnpm db:init` ausgeführt.

# Testbefehle
pnpm test <datei-filter>: Führt die Tests aus. `--bail 1` übergeben, damit der Test nach dem ersten Fehler stoppt. `--no-watch` übergeben, um die Tests einmal statt im Watch-Modus auszuführen.

# Verschiedene Befehle
pnpm explain-query: Fügen Sie eine SQL-Abfrage ein, um eine Erklärung des Abfrageplans zu erhalten, die Ihnen beim Debuggen von Leistungsproblemen hilft.
pnpm verify-data-integrity: Überprüft die Integrität der Daten in der Datenbank durch eine Reihe von Integritätsprüfungen. Dies sollte zu keinem Zeitpunkt fehlschlagen (es sei denn, Sie haben manuell an der DB herumgespielt).
```

Hinweis: Bei der Arbeit mit KI sollten Sie einen Terminal-Tab mit dem Dev-Server offen halten, damit die KI Abfragen dagegen ausführen kann.

## ❤ Mitwirkende

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
