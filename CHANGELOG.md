# Hexclave Changelog

---

## 6/12/26

![Payments checkout page redesign](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-payments-checkout.png)
- Redesigned Payments checkout page with navigation and UI polish.
- Dashboard light-mode consistency pass and hosted-components account navigation fix.
- Improved PKCE support and fixed nested cross-domain auth redirect chain.
- New analytics overview filters on the dashboard.
- RDE stability fixes, higher SMTP password limit, and smarter local email-server options.

## 6/5/26

- CLI improvements: local dashboard in remote SSH and Codespaces, auto-update via npx re-exec, and ~154 MB bundle reduction.
- Fixes for sign-out handling, nested cross-domain auth, subscription switching, and email preview theme blanking.
- New Python & REST API setup docs, product prices clarified as decimal strings, and pnpm v11 upgrade.

## 5/29/26
 
- Per-provider OAuth callback URLs with host-derived JWT issuer and redirect URIs.
- New LLM metadata endpoints for documentation discovery.
- Fixes for SSO dialog tab switching, client retry handling, and legacy cookie mixing.

## 5/22/26

- Faster ClickHouse analytics for project metrics and previews.
- Smoother cross-domain auth handoffs and hosted-domain trust.
- Sharper Auth Methods and Users dashboard tables.
![Auth method and user table polish](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-auth-methods.png)

## 5/15/26

- Redesigned Team Management tables with cleaner action states.
- New project transfer, session replay, and team payments screens.
- Unified AI chat experience on assistant-ui threads.
![Team management table](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-teams.png)

## 5/8/26

- New TanStack Start SDK integration with refreshed OpenAPI schemas.
- Weekly active users now appear on Project Overview.
- Cleaner Project Permissions with upgraded data grids.
![Project permissions dashboard](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-rbac.png)

## 5/1/26

- Shareable Session Replay IDs across dashboard, backend, and SDKs.
- Sleeker Data Vault and overview data-grid layouts.
- Emulator updates can now auto-install dependencies.
![Data Vault dashboard](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-data-vault.png)

## 4/24/26

- Redesigned Email Server settings and managed-domain setup.
- Faster local emulator startup with RAM snapshots.
- Live secret rotation plus a simpler sign-up rules tester.
![Email server settings and logs](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-email-server.png)

## 4/17/26

- Redesigned Overview and onboarding experience.
- Crisper dashboard sidebar styling and category navigation.
- New Payments product setup flow.
![Payments product setup](https://raw.githubusercontent.com/hexclave/hexclave/dev/apps/dashboard/public/assets/changelog-payments-products.png)

---

> **Note:** All older changelogs are deprecated and have been removed. The source of truth is this single changelog file.
>
> Going forward, all changes should be documented in this file only.

---
