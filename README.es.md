> Esta traducción fue generada por Claude. Si tienes sugerencias de mejora, los PRs son bienvenidos.

[![Stack Logo](/.github/assets/logo.png)](https://stack-auth.com)

<h3 align="center">
  <a href="https://docs.stack-auth.com">📘 Documentación</a>
  | <a href="https://stack-auth.com/">☁️ Versión alojada</a>
  | <a href="https://demo.stack-auth.com/">✨ Demo</a>
  | <a href="https://discord.stack-auth.com">🎮 Discord</a>
</h4>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.ar.md">العربية</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.da.md">Dansk</a> | <a href="README.de.md">Deutsch</a> | Español | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.no.md">Norsk</a> | <a href="README.pl.md">Polski</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.ru.md">Русский</a> | <a href="README.th.md">ไทย</a> | <a href="README.vi.md">Tiếng Việt</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.km.md">ភាសាខ្មែរ</a>
</p>

# Stack Auth: La plataforma de autenticación de código abierto

Stack Auth es una solución gestionada de autenticación de usuarios. Es amigable para desarrolladores y completamente de código abierto (licenciada bajo MIT y AGPL).

Stack Auth te permite comenzar en solo cinco minutos, después de lo cual estarás listo para usar todas sus funcionalidades a medida que tu proyecto crezca. Nuestro servicio gestionado es completamente opcional y puedes exportar tus datos de usuario y alojar tú mismo, gratis, en cualquier momento.

Soportamos frontends de Next.js, React y JavaScript, junto con cualquier backend que pueda usar nuestra [API REST](https://docs.stack-auth.com/api/overview). Consulta nuestra [guía de configuración](https://docs.stack-auth.com/docs/next/getting-started/setup) para comenzar.

<div align="center">
<img alt="Stack Auth Setup" src=".github/assets/create-project.gif" width="400" />
</div>

## ¿En qué se diferencia de X?

Pregúntate sobre `X`:

- ¿Es `X` de código abierto?
- ¿Es `X` amigable para desarrolladores, está bien documentado y te permite comenzar en minutos?
- Además de autenticación, ¿`X` también ofrece autorización y gestión de usuarios (ver lista de funcionalidades abajo)?

Si respondiste "no" a alguna de estas preguntas, entonces así es como Stack Auth se diferencia de `X`.

## ✨ Funcionalidades

Para ser el primero en enterarte cuando agreguemos nuevas funcionalidades, suscríbete a [nuestro boletín](https://stack-auth.beehiiv.com/subscribe).

| | |
|-|:-:|
| <h3>`<SignIn/>` y `<SignUp/>`</h3> Componentes de autenticación que soportan OAuth, credenciales de contraseña y magic links, con claves de desarrollo compartidas para acelerar la configuración. Todos los componentes soportan modo oscuro/claro. | <img alt="Sign-in component" src=".github/assets/dark-light-mode.png" width="250px"> |
| <h3>APIs idiomáticas de Next.js</h3> Construimos sobre server components, React hooks y route handlers. | ![Dark/light mode](.github/assets/components.png) |
| <h3>Panel de usuarios</h3> Panel para filtrar, analizar y editar usuarios. Reemplaza la primera herramienta interna que tendrías que construir. | ![User dashboard](.github/assets/dashboard.png) |
| <h3>Configuración de cuenta</h3> Permite a los usuarios actualizar su perfil, verificar su correo electrónico o cambiar su contraseña. Sin configuración necesaria. | <img alt="Account settings component" src=".github/assets/account-settings.png" width="300px"> |
| <h3>Multi-tenencia y equipos</h3> Gestiona clientes B2B con una estructura organizacional que tiene sentido y escala a millones. | <img alt="Selected team switcher component" src=".github/assets/team-switcher.png" width="400px"> |
| <h3>Control de acceso basado en roles</h3> Define un grafo de permisos arbitrario y asígnalo a usuarios. Las organizaciones pueden crear roles específicos de la organización. | <img alt="RBAC" src=".github/assets/permissions.png"  width="400px"> |
| <h3>Conexiones OAuth</h3>Más allá del inicio de sesión, Stack Auth también puede gestionar tokens de acceso para APIs de terceros, como Outlook y Google Calendar. Se encarga de renovar tokens y controlar el alcance, haciendo que los tokens de acceso sean accesibles mediante una sola llamada de función. | <img alt="OAuth tokens" src=".github/assets/connected-accounts.png"  width="250px"> |
| <h3>Passkeys</h3> Soporte para autenticación sin contraseña usando passkeys, permitiendo a los usuarios iniciar sesión de forma segura con biometría o llaves de seguridad en todos sus dispositivos. | <img alt="OAuth tokens" src=".github/assets/passkeys.png"  width="400px"> |
| <h3>Suplantación de identidad</h3> Suplanta la identidad de usuarios para depuración y soporte, iniciando sesión en su cuenta como si fueras ellos. | <img alt="Webhooks" src=".github/assets/impersonate.png"  width="350px"> |
| <h3>Webhooks</h3> Recibe notificaciones cuando los usuarios usen tu producto, construido sobre Svix. | <img alt="Webhooks" src=".github/assets/stack-webhooks.png"  width="300px"> |
| <h3>Correos automáticos</h3> Envía correos personalizables ante eventos como registro, restablecimiento de contraseña y verificación de correo, editables con un editor WYSIWYG. | <img alt="Email templates" src=".github/assets/email-editor.png"  width="400px"> |
| <h3>Gestión de sesiones de usuario y JWT</h3> Stack Auth gestiona tokens de actualización y acceso, JWTs y cookies, resultando en el mejor rendimiento sin costo de implementación. | <img alt="User button" src=".github/assets/user-button.png"  width="400px"> |
| <h3>Autenticación M2M</h3> Usa tokens de acceso de corta duración para autenticar tus máquinas con otras máquinas. | <img src=".github/assets/m2m-auth.png" alt="M2M authentication"  width="400px"> |


## 📦 Instalación y configuración

Para instalar Stack Auth en tu proyecto Next.js (para React, JavaScript u otros frameworks, consulta nuestra [documentación completa](https://docs.stack-auth.com)):

1. Ejecuta el asistente de instalación de Stack Auth con el siguiente comando:
    ```bash
    npx @stackframe/stack-cli@latest init
    ```

2. Luego, crea una cuenta en el [panel de Stack Auth](https://app.stack-auth.com/projects), crea un nuevo proyecto con una clave API y copia las variables de entorno en el archivo .env.local de tu proyecto Next.js:
    ```
    NEXT_PUBLIC_STACK_PROJECT_ID=<your-project-id>
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-publishable-client-key>
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    ```
3. ¡Eso es todo! Puedes ejecutar tu app con `npm run dev` e ir a [http://localhost:3000/handler/signup](http://localhost:3000/handler/signup) para ver la página de registro. También puedes visitar la página de configuración de cuenta en [http://localhost:3000/handler/account-settings](http://localhost:3000/handler/account-settings).

Consulta la [documentación](https://docs.stack-auth.com/getting-started/setup) para una guía más detallada.

## 🌱 Algunos proyectos de la comunidad construidos con Stack Auth

¿Tienes el tuyo? Estaremos encantados de destacarlo si creas un PR o nos escribes en [Discord](https://discord.stack-auth.com).

### Templates
- [Stack Auth Template by Stack Auth Team](https://github.com/stack-auth/stack-auth-template)
- [Next SaaSkit by wolfgunblood](https://github.com/wolfgunblood/nextjs-saaskit)
- [SaaS Boilerplate by Robin Faraj](https://github.com/robinfaraj/saas-boilerplate)

### Examples
- [Stack Auth Example by career-tokens](https://github.com/career-tokens/StackYCAuth)
- [Stack Auth Demo by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/demo)
- [Stack Auth E-Commerce Example by the Stack Auth team](https://github.com/stack-auth/stack-auth/tree/dev/examples/e-commerce)

## 🏗 Desarrollo y contribución

Esto es para ti si quieres contribuir al proyecto Stack Auth o ejecutar el panel de Stack Auth localmente.

**Importante**: Por favor lee las [guías de contribución](CONTRIBUTING.md) cuidadosamente y únete a [nuestro Discord](https://discord.stack-auth.com) si deseas ayudar.

### Requisitos

- Node v20
- pnpm v9
- Docker

### Configuración

Nota: Se recomiendan 24 GB+ de RAM para una experiencia de desarrollo fluida.

En una nueva terminal:

```sh
pnpm install

# Compilar los paquetes y generar código. Solo necesitamos hacer esto una vez, ya que `pnpm dev` lo hará de ahora en adelante
pnpm build:packages
pnpm codegen

# Iniciar las dependencias (BD, Inbucket, etc.) como contenedores Docker, inicializando la BD con el esquema de Prisma
# Asegúrate de tener Docker (u OrbStack) instalado y ejecutándose
pnpm restart-deps

# Iniciar el servidor de desarrollo
pnpm dev

# En otra terminal, ejecutar tests en modo watch
pnpm test # útil: --no-watch (desactiva modo watch) y --bail 1 (se detiene tras el primer fallo)
```

Ahora puedes abrir el launchpad de desarrollo en [http://localhost:8100](http://localhost:8100). Desde allí, puedes navegar al panel en [http://localhost:8101](http://localhost:8101), la API en el puerto 8102, la demo en el puerto 8103, la documentación en el puerto 8104, Inbucket (correos) en el puerto 8105 y Prisma Studio en el puerto 8106. Consulta el launchpad de desarrollo para ver una lista de todos los servicios en ejecución.

Tu IDE puede mostrar un error en todos los imports de `@stackframe/XYZ`. Para solucionarlo, simplemente reinicia el servidor de lenguaje TypeScript; por ejemplo, en VSCode puedes abrir la paleta de comandos (Ctrl+Shift+P) y ejecutar `Developer: Reload Window` o `TypeScript: Restart TS server`.

Archivos .env pre-completados para la configuración siguiente están disponibles y se usan por defecto en `.env.development` en cada uno de los paquetes. Sin embargo, si estás creando una build de producción (ej. con `pnpm run build`), debes proporcionar las variables de entorno manualmente (ver abajo).

### Comandos útiles

```sh
# NOTA:
# Por favor consulta el launchpad de desarrollo (por defecto: http://localhost:8100) para ver una lista de todos los servicios en ejecución.

# Comandos de instalación
pnpm install: Instala dependencias

# Comandos de tipos y linting
pnpm typecheck: Ejecuta el verificador de tipos de TypeScript. Puede requerir una build o servidor de desarrollo en ejecución primero.
pnpm lint: Ejecuta el linter ESLint. Opcionalmente, pasa `--fix` para corregir algunos errores de linting. Puede requerir una build o servidor de desarrollo en ejecución primero.

# Comandos de build
pnpm build: Compila todos los proyectos, incluyendo apps, paquetes, ejemplos y documentación. También ejecuta tareas de generación de código. Antes de ejecutar esto, deberás copiar todos los archivos `.env.development` en las carpetas a `.env.production.local` o configurar las variables de entorno manualmente.
pnpm build:packages: Compila todos los paquetes npm.
pnpm codegen: Ejecuta todas las tareas de generación de código, ej. generación del cliente Prisma y documentación OpenAPI.

# Comandos de desarrollo
pnpm dev: Ejecuta los servidores de desarrollo de los proyectos principales, excluyendo la mayoría de los ejemplos. En la primera ejecución, requiere que los paquetes estén compilados y codegen ejecutado. Después, observará los cambios en archivos (incluyendo los de generación de código). Si tienes que reiniciar el servidor de desarrollo por cualquier motivo, eso es un bug que puedes reportar.
pnpm dev:full: Ejecuta los servidores de desarrollo para todos los proyectos, incluyendo ejemplos.
pnpm dev:basic: Ejecuta los servidores de desarrollo solo para los servicios necesarios (backend y panel). No recomendado para la mayoría de usuarios, mejora tu máquina en su lugar.

# Comandos de entorno
pnpm start-deps: Inicia las dependencias Docker (BD, Inbucket, etc.) como contenedores Docker, y las inicializa con el script seed y migraciones. Nota: Las dependencias iniciadas serán visibles en el launchpad de desarrollo (puerto 8100 por defecto).
pnpm stop-deps: Detiene las dependencias Docker (BD, Inbucket, etc.) y elimina sus datos.
pnpm restart-deps: Detiene e inicia las dependencias.

# Comandos de base de datos
pnpm db:migration-gen: Actualmente no se usa. Por favor genera las migraciones de Prisma manualmente (o con IA).
pnpm db:reset: Restablece la base de datos al estado inicial. Se ejecuta automáticamente con `pnpm start-deps`.
pnpm db:init: Inicializa la base de datos con el script seed y migraciones. Se ejecuta automáticamente con `pnpm db:reset`.
pnpm db:seed: Re-inicializa la base de datos con el script seed. Se ejecuta automáticamente con `pnpm db:init`.
pnpm db:migrate: Ejecuta las migraciones. Se ejecuta automáticamente con `pnpm db:init`.

# Comandos de pruebas
pnpm test <filtros-de-archivo>: Ejecuta las pruebas. Pasa `--bail 1` para que las pruebas se detengan tras el primer fallo. Pasa `--no-watch` para ejecutar las pruebas una vez en lugar de en modo watch.

# Comandos varios
pnpm explain-query: Pega una consulta SQL para obtener una explicación del plan de consulta, ayudándote a depurar problemas de rendimiento.
pnpm verify-data-integrity: Verifica la integridad de los datos en la base de datos ejecutando una serie de verificaciones de integridad. Esto nunca debería fallar en ningún momento (a menos que hayas manipulado la BD manualmente).
```

Nota: Al trabajar con IA, deberías mantener una pestaña de terminal con el servidor de desarrollo abierto para que la IA pueda ejecutar consultas contra él.

## ❤ Colaboradores

<a href="https://github.com/stack-auth/stack-auth/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stack-auth/stack&columns=9" width="100%" />
</a>
