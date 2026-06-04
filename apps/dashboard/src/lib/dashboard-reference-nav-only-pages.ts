/**
 * Dashboard reference docs for apps that appear in the sidebar but do not have a
 * dedicated `page-client.tsx` under the project route yet.
 */

/**
 * @dashboardReference neon/neon-integration
 * @dashboardReferenceDescription Connect a Neon Postgres project to Hexclave (OAuth + API key provisioning).
 *
 * ## Dashboard entry
 *
 * Enabling the **Neon** app in the app store opens the Neon OAuth flow. After authorization, Hexclave creates a project API key scoped to your selected Stack project and links it to the Neon database.
 *
 * ## In-product flow
 *
 * - **OAuth confirm** (`/integrations/neon/confirm`) — pick or create the Hexclave project to link
 * - **Transfer confirm** (`/integrations/neon/projects/transfer/confirm`) — approve moving an existing Neon-linked project
 *
 * ## Operator notes
 *
 * The integration grants Neon read/write access to users, teams, and permissions for the linked project. Revoke keys under **Project Settings → Project Keys** if you disconnect Neon.
 *
 * Public guide: [Neon integration](https://docs.hexclave.com/guides/integrations/neon/overview).
 */

/**
 * @dashboardReference catalyst/catalyst
 * @dashboardReferenceDescription Hexclave Catalyst — AI-assisted project setup (app store entry).
 *
 * ## Dashboard entry
 *
 * **Catalyst** is listed in the app store. Enabling it routes operators to Catalyst-powered onboarding flows (experimental). There is no separate project-scoped configuration screen in the dashboard today.
 *
 * Use the app store card to enable/disable the app for the project (`apps.installed.catalyst`).
 */

/**
 * @dashboardReference tv-mode/tv-mode
 * @dashboardReferenceDescription Full-screen dashboard display for office TVs and status walls.
 *
 * ## Dashboard entry
 *
 * **TV mode** is a navigable app with a dedicated route (`tv-mode`). It is intended for read-only, large-format views of project metrics and health — not day-to-day configuration.
 *
 * Enable the app from the app store, then open **TV mode** from the sidebar to launch the display UI.
 */

/**
 * @dashboardReference email-api/email-api
 * @dashboardReferenceDescription Programmatic email sending via the Hexclave server SDK.
 *
 * ## Dashboard entry
 *
 * The **Email API** app documents how to send transactional email from server code using templates and themes configured in the **Emails** app. The sidebar entry points at the Email API overview; delivery logs live under **Emails → Sent**.
 *
 * ## Typical workflow
 *
 * 1. Configure SMTP or managed delivery in **Emails → Email Settings**
 * 2. Author templates in **Emails → Templates** (and themes in Email Settings)
 * 3. Call the Email API from your backend with the secret server key
 *
 * Public guide: [Email API](https://docs.hexclave.com/docs/apps/email-api).
 */

export {};
