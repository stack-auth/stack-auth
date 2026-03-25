> Esta tradução foi gerada pelo Claude. Sugestões de melhoria via PR são bem-vindas.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Documentação</a>
  | <a href="https://stack-auth.com/">☁️ Versão Hospedada</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | Português (Brasil) | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: A plataforma de autenticação open-source

Stack Auth é uma solução gerenciada de autenticação de usuários. É voltada para desenvolvedores e totalmente open-source (licenciada sob MIT e AGPL).

Stack Auth permite que você comece em apenas cinco minutos, após os quais você estará pronto para usar todos os seus recursos conforme seu projeto cresce. Nosso serviço gerenciado é completamente opcional e você pode exportar os dados dos seus usuários e fazer self-hosting, gratuitamente, a qualquer momento.

Suportamos frontends Next.js, React e JavaScript, junto com qualquer backend que possa usar nossa [REST API](https://docs.stack-auth.com/api/overview). Confira nosso [guia de configuração](https://docs.stack-auth.com/docs/next/getting-started/setup) para começar.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## Como isso é diferente de X?

Pergunte a si mesmo sobre `X`:

- `X` é open-source?
- `X` é voltado para desenvolvedores, bem documentado e permite que você comece em minutos?
- Além da autenticação, `X` também faz autorização e gerenciamento de usuários (veja a lista de recursos abaixo)?

Se você respondeu "não" a qualquer uma dessas perguntas, é assim que Stack Auth é diferente de `X`.

## ✨ Recursos

Para ser notificado primeiro quando adicionarmos novos recursos, inscreva-se na [nossa newsletter](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` e `<SignUp/>`</h3> Componentes de autenticação que suportam OAuth, credenciais com senha e magic links, com chaves de desenvolvimento compartilhadas para acelerar a configuração. Todos os componentes suportam modo escuro/claro. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>APIs idiomáticas para Next.js</h3> Construímos sobre server components, React hooks e route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Dashboard de usuários</h3> Dashboard para filtrar, analisar e editar usuários. Substitui a primeira ferramenta interna que você teria que construir. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Configurações da conta</h3> Permite que os usuários atualizem seu perfil, verifiquem seu e-mail ou alterem sua senha. Nenhuma configuração necessária. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenancy e equipes</h3> Gerencie clientes B2B com uma estrutura organizacional que faz sentido e escala para milhões. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Controle de acesso baseado em funções</h3> Defina um grafo de permissões arbitrário e atribua-o aos usuários. As organizações podem criar funções específicas para sua organização. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Conexões OAuth</h3>Além do login, Stack Auth também pode gerenciar tokens de acesso para APIs de terceiros, como Outlook e Google Calendar. Gerencia a renovação de tokens e o controle de escopo, tornando os tokens de acesso acessíveis por meio de uma única chamada de função. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Suporte para autenticação sem senha usando passkeys, permitindo que os usuários façam login com segurança usando biometria ou chaves de segurança em todos os seus dispositivos. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Personificação</h3> Personifique usuários para depuração e suporte, fazendo login na conta deles como se fosse você. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Receba notificações quando os usuários usam seu produto, construído sobre Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>E-mails automáticos</h3> Envie e-mails personalizáveis em resposta a eventos como cadastro, redefinição de senha e verificação de e-mail, editáveis com um editor WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Gerenciamento de sessões de usuário e JWT</h3> Stack Auth gerencia refresh e access tokens, JWTs e cookies, resultando no melhor desempenho sem custo de implementação. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Autenticação M2M</h3> Use tokens de acesso de curta duração para autenticar suas máquinas com outras máquinas. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Instalação e configuração

Para instalar Stack Auth no seu projeto Next.js (para React, JavaScript ou outros frameworks, consulte nossa [documentação completa](https://docs.stack-auth.com)):

1. Execute o assistente de instalação do Stack Auth com o seguinte comando:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Em seguida, crie uma conta no [dashboard do Stack Auth](https://app.stack-auth.com/projects), crie um novo projeto com uma chave de API e copie as variáveis de ambiente para o arquivo .env.local do seu projeto Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. Pronto! Você pode executar sua aplicação com `npm run dev` e acessar [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) para ver a página de cadastro. Você também pode conferir a página de configurações da conta em [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Consulte a [documentação](https://docs.stack-auth.com/getting-started/setup) para um guia mais detalhado.

## 🌱 Alguns projetos da comunidade construídos com Stack Auth

Tem o seu próprio? Ficaremos felizes em incluí-lo se você criar uma PR ou nos enviar uma mensagem no [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Desenvolvimento e contribuição

Esta seção é para você se deseja contribuir com o projeto Stack Auth ou executar o dashboard do Stack Auth localmente.

**Importante**: leia atentamente as [diretrizes de contribuição](CONTRIBUTING.md) e entre no [nosso Discord](https://discord.stack-auth.com) se quiser ajudar.

### Requisitos

- Node v20
- pnpm v9
- Docker

### Configuração

Nota: 24GB+ de RAM são recomendados para uma experiência de desenvolvimento fluida.

Em um novo terminal:

```sh
pnpm install

# Compile os pacotes e gere o código. Precisamos fazer isso apenas uma vez, pois `pnpm dev` fará isso a partir de agora
pnpm build:packages
pnpm codegen

# Inicie as dependências (DB, Inbucket, etc.) como containers Docker, inicializando o DB com o schema do Prisma
# Certifique-se de que o Docker (ou OrbStack) esteja instalado e em execução
pnpm restart-deps

# Inicie o servidor de desenvolvimento
pnpm dev

# Em outro terminal, execute os testes em modo watch
pnpm test # útil: --no-watch (desativa o modo watch) e --bail 1 (para após a primeira falha)
```

Agora você pode abrir o launchpad de desenvolvimento em [http://localhost:8100](http://localhost:8100). De lá, você pode navegar até o dashboard em [http://localhost:8101](http://localhost:8101), API na porta 8102, demo na porta 8103, documentação na porta 8104, Inbucket (e-mails) na porta 8105 e Prisma Studio na porta 8106. Consulte o launchpad de desenvolvimento para uma lista de todos os serviços em execução.

Seu IDE pode mostrar um erro em todos os imports `@stackframe/XYZ`. Para corrigir isso, basta reiniciar o servidor de linguagem TypeScript; por exemplo, no VSCode você pode abrir a paleta de comandos (Ctrl+Shift+P) e executar `Developer: Reload Window` ou `TypeScript: Restart TS server`.

Arquivos .env pré-populados para a configuração abaixo estão disponíveis e são usados por padrão em `.env.development` em cada um dos pacotes. No entanto, se você estiver criando uma build de produção (ex.: com `pnpm run build`), deve fornecer as variáveis de ambiente manualmente (veja abaixo).

### Comandos úteis

```sh
# NOTA:
# Consulte o launchpad de desenvolvimento (padrão: http://localhost:8100) para uma lista de todos os serviços em execução.

# Comandos de instalação
pnpm install: Instala as dependências

# Comandos de tipos e linting
pnpm typecheck: Executa a verificação de tipos do TypeScript. Pode exigir uma build ou servidor de desenvolvimento em execução.
pnpm lint: Executa o linter ESLint. Opcionalmente, passe `--fix` para corrigir alguns erros de linting. Pode exigir uma build ou servidor de desenvolvimento em execução.

# Comandos de build
pnpm build: Compila todos os projetos, incluindo apps, pacotes, exemplos e documentação. Também executa tarefas de geração de código. Antes de executar, você precisará copiar todos os arquivos `.env.development` nas pastas para `.env.production.local` ou definir as variáveis de ambiente manualmente.
pnpm build:packages: Compila todos os pacotes npm.
pnpm codegen: Executa todas as tarefas de geração de código, ex.: geração do cliente Prisma e da documentação OpenAPI.

# Comandos de desenvolvimento
pnpm dev: Executa os servidores de desenvolvimento dos projetos principais, excluindo a maioria dos exemplos. Na primeira execução, requer que os pacotes estejam compilados e o codegen tenha sido executado. Depois disso, monitorará alterações nos arquivos (incluindo os de geração de código). Se você precisar reiniciar o servidor de desenvolvimento por qualquer motivo, isso é um bug que você pode reportar.
pnpm dev:full: Executa os servidores de desenvolvimento para todos os projetos, incluindo exemplos.
pnpm dev:basic: Executa os servidores de desenvolvimento apenas para os serviços necessários (backend e dashboard). Não recomendado para a maioria dos usuários, prefira fazer upgrade na sua máquina.

# Comandos de ambiente
pnpm start-deps: Inicia as dependências Docker (DB, Inbucket, etc.) como containers Docker e as inicializa com o script de seed e migrações. Nota: as dependências iniciadas serão visíveis no launchpad de desenvolvimento (porta 8100 por padrão).
pnpm stop-deps: Para as dependências Docker (DB, Inbucket, etc.) e exclui os dados associados.
pnpm restart-deps: Para e reinicia as dependências.

# Comandos de banco de dados
pnpm db:migration-gen: Atualmente não utilizado. Gere migrações do Prisma manualmente (ou com IA).
pnpm db:reset: Reseta o banco de dados para o estado inicial. Executado automaticamente por `pnpm start-deps`.
pnpm db:init: Inicializa o banco de dados com o script de seed e migrações. Executado automaticamente por `pnpm db:reset`.
pnpm db:seed: Re-executa o seed do banco de dados com o script de seed. Executado automaticamente por `pnpm db:init`.
pnpm db:migrate: Executa as migrações. Executado automaticamente por `pnpm db:init`.

# Comandos de teste
pnpm test <file-filters>: Executa os testes. Passe `--bail 1` para executar os testes apenas até a primeira falha. Passe `--no-watch` para executar os testes uma única vez em vez de em modo watch.

# Comandos diversos
pnpm explain-query: Cole uma consulta SQL para obter uma explicação do plano de consulta, ajudando a depurar problemas de desempenho.
pnpm verify-data-integrity: Verifica a integridade dos dados no banco de dados executando uma série de verificações. Isso nunca deve falhar em nenhum momento (a menos que você tenha modificado o DB manualmente).
```

Nota: ao trabalhar com IA, você deve manter uma aba do terminal com o servidor de desenvolvimento aberta para que a IA possa executar consultas nele.

## ❤ Contribuidores

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
