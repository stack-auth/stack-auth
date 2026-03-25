> Ovaj prijevod je generisan od strane Claude. Ako imate prijedloge za poboljšanje, PR-ovi su dobrodošli.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Dokumentacija</a>
  | <a href="https://stack-auth.com/">☁️ Hostovana verzija</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | Bosanski | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: platforma za autentifikaciju otvorenog koda

Stack Auth je upravljano rješenje za autentifikaciju korisnika. Prilagođeno je programerima i potpuno je otvorenog koda (licencirano pod MIT i AGPL).

Stack Auth vam omogućava početak rada za samo pet minuta, nakon čega ćete biti spremni koristiti sve njegove mogućnosti kako vaš projekat raste. Naš upravljani servis je potpuno opcionalan i možete eksportovati podatke korisnika i hostovati ih sami, besplatno, u bilo kojem trenutku.

Podržavamo Next.js, React i JavaScript frontende, kao i bilo koji backend koji može koristiti naš [REST API](https://docs.stack-auth.com/api/overview). Pogledajte naš [vodič za postavljanje](https://docs.stack-auth.com/docs/next/getting-started/setup) da biste započeli.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Po čemu se ovo razlikuje od X?

Postavite sebi pitanja o `X`:

- Da li je `X` otvorenog koda?
- Da li je `X` prilagođen programerima, dobro dokumentovan i omogućava vam da počnete za nekoliko minuta?
- Osim autentifikacije, da li `X` također podržava autorizaciju i upravljanje korisnicima (pogledajte listu funkcija ispod)?

Ako ste na bilo koje od ovih pitanja odgovorili sa „ne", onda je to način na koji se Stack Auth razlikuje od `X`.

## ✨ Mogućnosti

Da biste prvi saznali kada dodamo nove funkcije, pretplatite se na [naš newsletter](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` i `<SignUp/>`</h3> Komponente za autentifikaciju koje podržavaju OAuth, prijavu lozinkom i magične linkove, sa dijeljenim razvojnim ključevima za bržu konfiguraciju. Sve komponente podržavaju tamni i svijetli način rada. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>Idiomatski Next.js API-ji</h3> Gradimo na serverskim komponentama, React hookovima i route handlerima. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Korisnička kontrolna tabla</h3> Kontrolna tabla za filtriranje, analizu i uređivanje korisnika. Zamjenjuje prvi interni alat koji biste morali izgraditi. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Postavke računa</h3> Omogućava korisnicima ažuriranje profila, verifikaciju e-maila ili promjenu lozinke. Nije potrebna konfiguracija. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy i timovi</h3> Upravljajte B2B klijentima sa organizacionom strukturom koja ima smisla i skalira se do miliona. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Kontrola pristupa zasnovana na ulogama</h3> Definirajte proizvoljan graf dozvola i dodijelite ga korisnicima. Organizacije mogu kreirati uloge specifične za organizaciju. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>OAuth konekcije</h3>Osim prijave, Stack Auth također može upravljati pristupnim tokenima za API-je trećih strana, kao što su Outlook i Google Calendar. Upravlja osvježavanjem tokena i kontrolom opsega, čineći pristupne tokene dostupnim putem jednog poziva funkcije. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Podrška za autentifikaciju bez lozinke korištenjem passkeys, omogućavajući korisnicima sigurnu prijavu putem biometrije ili sigurnosnih ključeva na svim njihovim uređajima. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Impersonacija</h3> Impersonirajte korisnike za debugiranje i podršku, prijavljujući se na njihov račun kao da ste oni. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhookovi</h3> Primajte obavijesti kada korisnici koriste vaš proizvod, izgrađeno na Svix-u. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Automatski e-mailovi</h3> Šaljite prilagodljive e-mailove na okidače kao što su registracija, resetovanje lozinke i verifikacija e-maila, uređive pomoću WYSIWYG editora. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Upravljanje korisničkim sesijama i JWT</h3> Stack Auth upravlja tokenima za osvježavanje i pristup, JWT-ovima i kolačićima, što rezultira najboljom performansom bez troškova implementacije. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>M2M autentifikacija</h3> Koristite kratkotrajne pristupne tokene za autentifikaciju vaših mašina prema drugim mašinama. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Instalacija i postavljanje

Da biste instalirali Stack Auth u vaš Next.js projekat (za React, JavaScript ili druge frameworke, pogledajte našu [kompletnu dokumentaciju](https://docs.stack-auth.com)):

1. Pokrenite čarobnjak za instalaciju Stack Auth-a sljedećom komandom:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Zatim kreirajte račun na [Stack Auth kontrolnoj tabli](https://app.stack-auth.com/projects), kreirajte novi projekat sa API ključem i kopirajte njegove varijable okruženja u .env.local fajl vašeg Next.js projekta:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. To je to! Možete pokrenuti aplikaciju sa `npm run dev` i otići na [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) da vidite stranicu za registraciju. Također možete pogledati stranicu postavki računa na [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Pogledajte [dokumentaciju](https://docs.stack-auth.com/getting-started/setup) za detaljniji vodič.

## 🌱 Neki projekti zajednice izgrađeni sa Stack Auth-om

Imate svoj? Rado ćemo ga predstaviti ako kreirate PR ili nam pišete na [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Razvoj i doprinos

Ovo je za vas ako želite doprinijeti projektu Stack Auth ili pokrenuti Stack Auth kontrolnu tablu lokalno.

**Važno**: molimo pažljivo pročitajte [smjernice za doprinos](CONTRIBUTING.md) i pridružite se [našem Discord-u](https://discord.stack-auth.com) ako želite pomoći.

### Zahtjevi

- Node v20
- pnpm v9
- Docker

### Postavljanje

Napomena: preporučuje se 24 GB+ RAM-a za ugodno razvojno iskustvo.

U novom terminalu:

```sh
pnpm install
pnpm build:packages
pnpm codegen
pnpm restart-deps
pnpm dev

# U drugom terminalu pokrenite testove u watch modu
pnpm test
```

Sada možete otvoriti razvojnu stranicu na [http://localhost:8100](http://localhost:8100). Odatle možete navigirati do kontrolne table na [http://localhost:8101](http://localhost:8101), API-ja na portu 8102, demo-a na portu 8103, dokumentacije na portu 8104, Inbucket-a (e-mailovi) na portu 8105 i Prisma Studio-a na portu 8106. Pogledajte razvojnu stranicu za listu svih pokrenutih servisa.

Vaš IDE može prikazivati grešku na svim `@stackframe/XYZ` importima. Da biste to popravili, jednostavno restartujte TypeScript jezički server; na primjer, u VSCode-u možete otvoriti paletu komandi (Ctrl+Shift+P) i pokrenuti `Developer: Reload Window` ili `TypeScript: Restart TS server`.

Prethodno popunjeni .env fajlovi za postavljanje ispod su dostupni i koriste se po defaultu u `.env.development` u svakom od paketa. Međutim, ako kreirate produkcijsku verziju (npr. sa `pnpm run build`), morate ručno navesti varijable okruženja (pogledajte ispod).

### Korisne komande

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

Napomena: kada radite sa AI-jem, trebali biste držati otvorenu karticu terminala sa dev serverom kako bi AI mogao izvršavati upite prema njemu.

## ❤ Doprinosioci

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
