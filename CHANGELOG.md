# Hexclave Changelog

---

## 7/10/26

- New CLI Auth dashboard app and a browser `<script>` setup path that works without a bundler.
- The project overview globe now centers on the viewer, and the onboarding auth preview is interactive.
- Payments customers now support manual item quantity adjustments directly from the dashboard.
- Fixes for user-page syncing, session replay playback freezes, and runaway infinite scrolling.
- Improved docs discoverability and dashboard resilience when internal billing data is temporarily unavailable.

## 7/3/26

- New navigation funnel graph, recent sign-up rule activity, and project IDs in platform analytics.
- Payments checkout now surfaces errors clearly, with a more polished onboarding flow.
- Expanded email delivery to arbitrary recipients on managed domains, plus filtered user exports and safer user dialogs.
- Leaner dashboard downloads and local-dashboard support for `hexclave exec`, with one unified development environment workflow.
- Large session replays are compressed to avoid dropped recordings, alongside faster analytics and Payments data processing.

## 6/26/26

- Unified payments customers table with "Create checkout" available everywhere and idempotent webhook handling.
- Faster project onboarding with a preview project pool for instant creation and prefetched email themes.
- New Usage settings page with performance improvements and a "View usage" shortcut from limit banners.
- TypeScript 6.0 upgrade, STACK_* → HEXCLAVE_* env-var rename, and devtool indicator auto-visibility.
- Stability fixes for session recording flush limits, duplicate-email sign-up errors, and recurring production errors.

## 6/19/26

- New clickmap heatmaps for route analytics — visualize where users click on any page.
- Custom OIDC provider support (team plan+) with improved OAuth sign-up errors and Apple OAuth fixes.
- Redesigned hosted components, new Emails tab on the User Detail page, and purchase page loading state.
- CLI auth no longer requires a publishable key, plus stability fixes for ENOTEMPTY races and RDE source maps.
- AI-aware config editing and new skill context for Ask Hexclave.

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
