> Cette traduction a été générée par Claude. Les suggestions d'amélioration via PR sont les bienvenues.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Documentation</a>
  | <a href="https://stack-auth.com/">☁️ Version hébergée</a>
  | <a href="https://demo.stack-auth.com/">✨ Démo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | Français | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth : La plateforme d'authentification open source

Stack Auth est une solution gérée d'authentification des utilisateurs. Elle est conçue pour les développeurs et entièrement open source (sous licence MIT et AGPL).

Stack Auth vous permet de démarrer en seulement cinq minutes, après quoi vous serez prêt à utiliser toutes ses fonctionnalités au fur et à mesure que votre projet évolue. Notre service géré est entièrement optionnel et vous pouvez exporter vos données utilisateur et héberger vous-même, gratuitement, à tout moment.

Nous prenons en charge les frontends Next.js, React et JavaScript, ainsi que tout backend pouvant utiliser notre [API REST](https://docs.stack-auth.com/api/overview). Consultez notre [guide de configuration](https://docs.stack-auth.com/docs/next/getting-started/setup) pour commencer.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## En quoi est-ce différent de X ?

Posez-vous ces questions à propos de `X` :

- `X` est-il open source ?
- `X` est-il conçu pour les développeurs, bien documenté, et permet-il de démarrer en quelques minutes ?
- En plus de l'authentification, `X` propose-t-il aussi l'autorisation et la gestion des utilisateurs (voir la liste des fonctionnalités ci-dessous) ?

Si vous avez répondu "non" à l'une de ces questions, c'est en cela que Stack Auth diffère de `X`.

## ✨ Fonctionnalités

Pour être informé en priorité des nouvelles fonctionnalités, abonnez-vous à [notre newsletter](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` et `<SignUp/>`</h3> Composants d'authentification prenant en charge OAuth, les identifiants par mot de passe et les magic links, avec des clés de développement partagées pour accélérer la configuration. Tous les composants supportent les modes sombre/clair. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>APIs idiomatiques Next.js</h3> Nous nous appuyons sur les server components, les React hooks et les route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Tableau de bord utilisateurs</h3> Tableau de bord pour filtrer, analyser et modifier les utilisateurs. Remplace le premier outil interne que vous auriez dû construire. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Paramètres du compte</h3> Permet aux utilisateurs de mettre à jour leur profil, de vérifier leur adresse e-mail ou de changer leur mot de passe. Aucune configuration requise. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy et équipes</h3> Gérez vos clients B2B avec une structure organisationnelle cohérente qui évolue jusqu'à des millions d'utilisateurs. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Contrôle d'accès basé sur les rôles</h3> Définissez un graphe de permissions arbitraire et attribuez-le aux utilisateurs. Les organisations peuvent créer des rôles spécifiques à leur organisation. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Connexions OAuth</h3>Au-delà de la connexion, Stack Auth peut également gérer les tokens d'accès pour les APIs tierces, comme Outlook et Google Calendar. Il gère le renouvellement des tokens et le contrôle des scopes, rendant les tokens d'accès accessibles via un seul appel de fonction. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Prise en charge de l'authentification sans mot de passe via les passkeys, permettant aux utilisateurs de se connecter en toute sécurité avec la biométrie ou des clés de sécurité sur tous leurs appareils. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Usurpation d'identité</h3> Prenez l'identité des utilisateurs pour le débogage et le support, en vous connectant à leur compte comme si vous étiez eux. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Soyez notifié lorsque les utilisateurs utilisent votre produit, construit sur Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>E-mails automatiques</h3> Envoyez des e-mails personnalisables déclenchés par des événements tels que l'inscription, la réinitialisation du mot de passe et la vérification d'e-mail, modifiables avec un éditeur WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Gestion des sessions utilisateur et JWT</h3> Stack Auth gère les tokens de rafraîchissement et d'accès, les JWTs et les cookies, offrant les meilleures performances sans coût d'implémentation. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Authentification M2M</h3> Utilisez des tokens d'accès à courte durée de vie pour authentifier vos machines auprès d'autres machines. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Installation et configuration

Pour installer Stack Auth dans votre projet Next.js (pour React, JavaScript ou d'autres frameworks, consultez notre [documentation complète](https://docs.stack-auth.com)) :

1. Lancez l'assistant d'installation de Stack Auth avec la commande suivante :
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Ensuite, créez un compte sur le [tableau de bord Stack Auth](https://app.stack-auth.com/projects), créez un nouveau projet avec une clé API et copiez ses variables d'environnement dans le fichier .env.local de votre projet Next.js :
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. C'est tout ! Vous pouvez lancer votre application avec `npm run dev` et accéder à [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) pour voir la page d'inscription. Vous pouvez également consulter la page de paramètres du compte sur [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Consultez la [documentation](https://docs.stack-auth.com/getting-started/setup) pour un guide plus détaillé.

## 🌱 Quelques projets communautaires construits avec Stack Auth

Vous avez le vôtre ? Nous serons ravis de le mettre en avant si vous créez une PR ou nous contactez sur [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Développement et contribution

Cette section est pour vous si vous souhaitez contribuer au projet Stack Auth ou exécuter le tableau de bord Stack Auth localement.

**Important** : Veuillez lire attentivement les [directives de contribution](CONTRIBUTING.md) et rejoindre [notre Discord](https://discord.stack-auth.com) si vous souhaitez aider.

### Prérequis

- Node v20
- pnpm v9
- Docker

### Configuration

Note : 24 Go+ de RAM sont recommandés pour une expérience de développement fluide.

Dans un nouveau terminal :

```sh
pnpm install

# Compiler les paquets et générer le code. Nous n'avons besoin de faire cela qu'une seule fois, car `pnpm dev` s'en chargera désormais
pnpm build:packages
pnpm codegen

# Démarrer les dépendances (BD, Inbucket, etc.) en tant que conteneurs Docker, en initialisant la BD avec le schéma Prisma
# Assurez-vous que Docker (ou OrbStack) est installé et en cours d'exécution
pnpm restart-deps

# Démarrer le serveur de développement
pnpm dev

# Dans un autre terminal, lancer les tests en mode watch
pnpm test # utile : --no-watch (désactive le mode watch) et --bail 1 (s'arrête après le premier échec)
```

Vous pouvez maintenant ouvrir le launchpad de développement à l'adresse [http://localhost:8100](http://localhost:8100). De là, vous pouvez naviguer vers le tableau de bord à [http://localhost:8101](http://localhost:8101), l'API sur le port 8102, la démo sur le port 8103, la documentation sur le port 8104, Inbucket (e-mails) sur le port 8105 et Prisma Studio sur le port 8106. Consultez le launchpad de développement pour la liste de tous les services en cours d'exécution.

Votre IDE peut afficher une erreur sur tous les imports `@stackframe/XYZ`. Pour corriger cela, redémarrez simplement le serveur de langage TypeScript ; par exemple, dans VSCode vous pouvez ouvrir la palette de commandes (Ctrl+Shift+P) et exécuter `Developer: Reload Window` ou `TypeScript: Restart TS server`.

Des fichiers .env pré-remplis pour la configuration ci-dessous sont disponibles et utilisés par défaut dans `.env.development` de chacun des paquets. Cependant, si vous créez un build de production (par ex. avec `pnpm run build`), vous devez fournir les variables d'environnement manuellement (voir ci-dessous).

### Commandes utiles

```sh
# NOTE :
# Veuillez consulter le launchpad de développement (par défaut : http://localhost:8100) pour la liste de tous les services en cours d'exécution.

# Commandes d'installation
pnpm install : Installe les dépendances

# Commandes de types et linting
pnpm typecheck : Exécute le vérificateur de types TypeScript. Peut nécessiter un build ou un serveur de développement en cours d'exécution.
pnpm lint : Exécute le linter ESLint. Optionnellement, passez `--fix` pour corriger certaines erreurs de linting. Peut nécessiter un build ou un serveur de développement en cours d'exécution.

# Commandes de build
pnpm build : Compile tous les projets, y compris les applications, paquets, exemples et documentation. Exécute également les tâches de génération de code. Avant de pouvoir lancer ceci, vous devrez copier tous les fichiers `.env.development` des dossiers vers `.env.production.local` ou définir les variables d'environnement manuellement.
pnpm build:packages : Compile tous les paquets npm.
pnpm codegen : Exécute toutes les tâches de génération de code, par ex. la génération du client Prisma et de la documentation OpenAPI.

# Commandes de développement
pnpm dev : Lance les serveurs de développement des projets principaux, excluant la plupart des exemples. Lors du premier lancement, nécessite que les paquets soient compilés et que codegen soit exécuté. Ensuite, il surveillera les modifications de fichiers (y compris ceux de génération de code). Si vous devez redémarrer le serveur de développement pour quelque raison que ce soit, c'est un bug que vous pouvez signaler.
pnpm dev:full : Lance les serveurs de développement pour tous les projets, y compris les exemples.
pnpm dev:basic : Lance les serveurs de développement uniquement pour les services nécessaires (backend et tableau de bord). Non recommandé pour la plupart des utilisateurs, mettez plutôt à niveau votre machine.

# Commandes d'environnement
pnpm start-deps : Démarre les dépendances Docker (BD, Inbucket, etc.) en tant que conteneurs Docker, et les initialise avec le script seed et les migrations. Note : Les dépendances démarrées seront visibles sur le launchpad de développement (port 8100 par défaut).
pnpm stop-deps : Arrête les dépendances Docker (BD, Inbucket, etc.) et supprime leurs données.
pnpm restart-deps : Arrête et redémarre les dépendances.

# Commandes de base de données
pnpm db:migration-gen : Actuellement non utilisé. Veuillez générer les migrations Prisma manuellement (ou avec l'IA).
pnpm db:reset : Réinitialise la base de données à son état initial. Exécuté automatiquement par `pnpm start-deps`.
pnpm db:init : Initialise la base de données avec le script seed et les migrations. Exécuté automatiquement par `pnpm db:reset`.
pnpm db:seed : Ré-initialise la base de données avec le script seed. Exécuté automatiquement par `pnpm db:init`.
pnpm db:migrate : Exécute les migrations. Exécuté automatiquement par `pnpm db:init`.

# Commandes de test
pnpm test <filtres-de-fichiers> : Exécute les tests. Passez `--bail 1` pour que les tests s'arrêtent après le premier échec. Passez `--no-watch` pour exécuter les tests une seule fois au lieu du mode watch.

# Commandes diverses
pnpm explain-query : Collez une requête SQL pour obtenir une explication du plan de requête, vous aidant à déboguer les problèmes de performance.
pnpm verify-data-integrity : Vérifie l'intégrité des données dans la base de données en exécutant une série de vérifications d'intégrité. Cela ne devrait jamais échouer à aucun moment (sauf si vous avez manipulé la BD manuellement).
```

Note : Lorsque vous travaillez avec l'IA, vous devriez garder un onglet de terminal avec le serveur de développement ouvert pour que l'IA puisse exécuter des requêtes contre celui-ci.

## ❤ Contributeurs

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
