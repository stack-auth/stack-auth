# CLAUDE Knowledge Base

Q: How are the development ports derived now that NEXT_PUBLIC_STACK_PORT_PREFIX exists?
A: Host ports use `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}` plus the two-digit suffix (e.g., Postgres is `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}28`, Inbucket SMTP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}29`, POP3 `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}30`, and OTLP `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}31` by default).

Q: How can I show helper text beneath metadata text areas in the dashboard?
A: Use the shared `TextAreaField` component's `helperText` prop in `apps/dashboard/src/components/form-fields.tsx`; it now renders the helper content in a secondary Typography line under the textarea.

Q: How is the Email Template Editor structured?
A: It uses a hero-preview layout in `VibeCodeLayout` where the preview area dominates the screen. The code editor is hidden by default and accessible via a modal, while the AI assistant chat resides in a resizable right panel. Device viewport switching (Desktop/Tablet/Mobile) is integrated into the top toolbar.

Q: How can I improve AI design generations for emails?
A: Update the system prompts in the backend's chat adapters (e.g., `apps/backend/src/lib/ai-chat/email-template-adapter.ts`). Providing explicit design principles, Tailwind CSS best practices, and structured technical rules helps the AI generate more polished and consistent designs.

Q: What endpoint does the local Freestyle mock expose for script execution?
A: The mock server responds on `/execute/v1/script` and `/execute/v2/script` when built from `docker/dependencies/freestyle-mock/Dockerfile`; if the running image is older and only supports v1, backend dev can post to `/execute/v1/script` for email rendering.

Q: How can I add a small Vitest check inside a client-only file?
A: Use `import.meta.vitest?.test(...)` at the bottom of the file for lightweight, in-file tests without adding a separate test file.
Q: Why did `pnpm typecheck` fail after deleting a Next.js route?
A: The generated `.next/types/validator.ts` can keep stale imports for removed routes. Deleting that file (or regenerating Next build output) clears the outdated references so `pnpm typecheck` succeeds again.

Q: Why can auto-migrations time out and how should I mitigate it?
A: Auto-migrations run each migration inside a Prisma interactive transaction with an 80s timeout. Long-running statements (even if marked RUN_OUTSIDE_TRANSACTION_SENTINEL) still consume that time, so keep each iteration small using CONDITIONALLY_REPEAT_MIGRATION_SENTINEL and reduce batch sizes (e.g., lower LIMIT) so each transaction finishes under 80s.

Q: How should `restricted_by_admin` updates handle reason fields?
A: When setting `restricted_by_admin` to false, explicitly clear `restricted_by_admin_reason` and `restricted_by_admin_private_details` to null (even if omitted in the PATCH) to satisfy the database constraint.

Q: Where should `stackAppInternalsSymbol` be imported from in the dashboard?
A: Use the shared `apps/dashboard/src/lib/stack-app-internals.ts` export to avoid duplicating the Symbol.for definition across files.

Q: How do we control whether a project requires publishable client keys?
A: Use the project-level config override field `project.requirePublishableClientKey` via `/api/v1/internal/config/override/project` or `AdminProject.update({ requirePublishableClientKey: ... })`. It defaults to false for new projects and is set true for existing projects via DB migration.

Q: When adding new config fields, what else should be updated?
A: Update the config schema fuzzer configs in `packages/stack-shared/src/config/schema-fuzzer.test.ts` (for example, add the new field under `projectSchemaFuzzerConfig`/`branchSchemaFuzzerConfig`).

Q: Why can't `canNoLongerBeOverridden` accept dotted paths?
A: It uses `schema.getNested`, which only allows keys with alphanumerics, `_`, `$`, `:`, or `-`. Dots are rejected, so mark the parent object key (e.g., `project`) as non-overridable instead.

Q: Where is the editable-grid preview spacing controlled in the dashboard playground?
A: In `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/playground/page-client.tsx`, the `selected === "editable-grid"` branch controls the card width/padding and the main preview container now uses `isExpandedPreview` to reduce outer gray padding only for editable-grid.

Q: Why do editable-grid dropdown/boolean values sometimes not fill the full value column width?
A: In `apps/dashboard/src/components/design-components/editable-grid.tsx`, the value wrappers must be explicitly full-width (`w-full`) for boolean and dropdown fields, and the grid value cell container should also include `w-full`; otherwise controls shrink to content width.

Q: How should dashboard inline editable text fields match the new design-components style?
A: Use `DesignInput` and `DesignButton` in `apps/dashboard/src/components/editable-input.tsx` (instead of legacy `Input`/`Button`) and style accept/reject actions as subtle glassy icon buttons with muted ring/border plus semantic hover tints.

Q: What should dashboard email/project pages prefer for UI primitives?
A: Prefer `apps/dashboard/src/components/design-components/*` components (`DesignCard`, `DesignAlert`, `DesignBadge`, `DesignButton`, `DesignPillToggle`, `DesignCategoryTabs`, etc.) over page-local wrappers or repeated inline class patterns; current email surfaces still contain local patterns like custom GlassCard/SectionHeader/ViewportSelector that should be standardized.

Q: What sections are expected in the dashboard design guide beyond component mapping?
A: Include explicit best-practices plus dedicated guidance for animation, typography, light/dark color system, micro-interactions, and spacing/layout rules so the guide is actionable for both humans and AI agents.

Q: How should the project emails page cards align with the design system?
A: In `apps/dashboard/src/app/(main)/(protected)/projects/[projectId]/emails/page-client.tsx`, wrap the major sections with `DesignCard` from `@/components/design-components` (for example `gradient="default"`/`"purple"` with `glassmorphic`) instead of maintaining a local page-specific glass card wrapper.

Q: Where is the default inner spacing for shared design cards controlled?
A: `apps/dashboard/src/components/design-components/card.tsx` sets the default content padding via `bodyPaddingClass` (currently `p-5`), and compact cards use `p-5` header plus `px-5 py-4` body spacing.

Q: Why can two `DesignCard` surfaces look like they have different padding?
A: Pages can add extra local wrappers inside `DesignCard` (for example `p-5`, `px-5`, `pb-5`) which stack on top of `DesignCard` defaults; in the emails page, removing those local wrappers (`p-0`, `px-0`, `pb-0`) makes spacing match playground behavior.

Q: How can a split section inside body-only `DesignCard` match header/content card borders?
A: Inside body-only cards (which already apply `p-5`), use a second section with `-mx-5 px-5` and `border-t border-black/[0.12] dark:border-white/[0.06]` so the divider spans full card width while content alignment matches `DesignCard` header/content layout.

Q: How should cards handle header action buttons when using `title` + `subtitle`?
A: `DesignCard` now supports an `actions` prop when title/icon are provided; use `title`, `subtitle`, `icon`, and `actions` in pages like emails so header spacing and subtitle-bottom spacing exactly match playground/header variant styles without custom section-header workarounds.

Q: What should we do after changing props in a core dashboard design component?
A: Update the playground implementation (`apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/playground/page-client.tsx`) in the same change so the component controls/examples reflect the new or changed props immediately.

Q: How is the new `DesignCard` `actions` prop represented in playground?
A: The card playground now includes a `Header Actions` toggle that injects a sample `actions` slot (`DesignButton` with `Sliders` icon and "Configure") into `DesignCard` preview and generated code, only when `title` is present.

Q: What is the reliable way to lint a single dashboard file in this monorepo?
A: Run lint from `apps/dashboard` directly (for example `pnpm lint -- "src/app/(main)/(protected)/projects/[projectId]/(overview)/line-chart.tsx"`), because running root `pnpm lint -- <file>` fans out through Turbo packages where that path does not exist.
Q: How should unsubscribe-link e2e tests avoid breakage from email theme/layout changes?
A: In `apps/e2e/tests/backend/endpoints/api/v1/unsubscribe-link.test.ts`, avoid snapshotting the entire rendered HTML for transactional emails; assert stable behavior instead (email content present and `/api/v1/emails/unsubscribe-link` absent) so cosmetic wrapper/style changes do not fail the test.

Q: How should dashboard pages update project config values?
A: Do not call `project.updateConfig(...)` directly from dashboard pages; lint enforces using `useUpdateConfig()` from `apps/dashboard/src/lib/config-update.tsx` so pushable-config confirmation flows are handled consistently.

Q: How can the dashboard find resumable onboarding state without SDK type changes?
A: Query `/internal/projects` via `stackAppInternalsSymbol` and read each project's `onboarding_status`; this avoids relying on `AdminOwnedProject` fields that may lag until generated package copies are rebuilt.

Q: How should the new-project onboarding page avoid React's "Cannot update a component while rendering a different component" router error?
A: In `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`, never call `router.replace(...)` during render when an onboarding project is already completed; move that redirect into a `useEffect` and render a plain spinner while the redirect is in progress.

Q: What is the expected lightweight loading state when reopening an in-progress onboarding project?
A: On `apps/dashboard/src/app/(main)/(protected)/(outside-dashboard)/new-project/page-client.tsx`, the "loading onboarding" state should be just a centered `Spinner` with no card chrome or explanatory copy.

Q: How should dashboard project onboarding status responses be handled to avoid silently bypassing onboarding?
A: Import `ProjectOnboardingStatus`/`projectOnboardingStatusValues` from `@stackframe/stack-shared/dist/schema-fields`, validate every `onboarding_status` from `/internal/projects`, and throw on invalid/missing values instead of defaulting to `"completed"`.

Q: What E2E updates are required after adding `onboarding_status` to project API responses?
A: Update affected inline snapshots in `apps/e2e/tests/backend/endpoints/api/v1/**` to include `"onboarding_status": "completed"` in project payloads (for example projects, permissions, and integration provisioning/current endpoints), otherwise CI setup/restart E2E jobs fail with snapshot mismatches.

Q: How should `createOrUpdateProjectWithLegacyConfig` handle `onboardingStatus` for forward-compat checks?
A: Only write `onboardingStatus` when the `Project.onboardingStatus` column exists (for example by checking `information_schema.columns` in-transaction) so current code can still run against older schemas where that column is absent.

Q: How does the Docker local emulator make generated config files visible on the host filesystem?
A: In `docker/local-emulator/docker-compose.yaml`, the `stack-app` service now bind-mounts `"${HOME}:${HOME}"` and `"/tmp:/tmp"`, so local-emulator config paths under the user's home directory or `/tmp` resolve to the same absolute path inside and outside the container.

Q: Why shouldn't the Docker app entrypoint use `/tmp/processed` as its runtime working directory when `/tmp` is bind-mounted?
A: With `/tmp` bind-mounted for host-visible config files, copying the full runtime tree into `/tmp/processed` pushes that heavy startup copy onto the host filesystem and makes boot much slower. `docker/server/entrypoint.sh` should keep its scratch runtime under a non-mounted path like `/var/tmp/stack-runtime` instead.

Q: How can we verify the Docker local-emulator config-generation flow end to end?
A: POST `http://127.0.0.1:8102/api/v1/internal/local-emulator/project` with admin headers for the internal project and a body like `{"absolute_file_path":"/tmp/stack-auth-test-config-internal/stack.config.ts"}`. A successful `200` response should create `/tmp/stack-auth-test-config-internal/stack.config.ts` on the host containing `export const config = {};`.

Q: What is the measured footprint of the Docker local emulator on an arm Mac once the stack is healthy?
A: With `pnpm run start-emulator` green on port prefix `81`, `docker stats --no-stream` showed about `578.6MiB` for `stack-deps` and `552.9MiB` for `stack-app`, for roughly `1.13GiB` RAM total. `docker image inspect` showed image sizes of about `1.44GB` (`stack-local-emulator-deps`) and `2.79GB` (`stack-local-emulator-app`), roughly `3.94GiB` combined image footprint, and `docker system df -v` showed another ~`77.7MiB` across the emulator's named volumes right after startup.

Q: What made the split QEMU local-emulator build reliable on arm Macs?
A: The working path provisions two Debian arm64 guests that run the already-built `stack-local-emulator-deps` and `stack-local-emulator-app` Docker images inside the VM, instead of re-implementing the full service stack twice. The build script caches the Debian base image, reuses gzipped `docker save` bundles, and then provisions the `deps` and `dev-server` qcow images in parallel.

Q: What subtle issues mattered for the QEMU image-bundle path?
A: Two details were critical: use a short ISO-safe bundle filename like `img.tgz` instead of a longer name such as `image.tar.gz`, and use Docker volumes inside the guest for the deps container rather than bind-mounting empty guest directories into `/data/*`. The short name avoids missing-file issues after mounting the ISO in the guest, and Docker volumes preserve the ownership expectations that the deps image's PostgreSQL initialization relies on.

Q: How can we verify that the QEMU-backed local emulator is already seeded correctly?
A: Query the `stackframe` Postgres on host port `8128` and check for the local-emulator seed records directly: `ContactChannel.value='local-emulator@stack-auth.com'`, `ProjectUser.projectUserId='63abbc96-5329-454a-ba56-e0460173c6c1'` with display name `Local Emulator User`, `Team.teamId='5a0c858b-d9e9-49d4-9943-8ce385d86428'` with display name `Emulator Team`, and the matching `TeamMember` row. On the working QEMU stack these rows were all present under tenancy `3c69b8d4-55c0-4417-8a0b-2f1923d745f6`, confirming the app guest had already run migrations and seed on boot.

Q: How should the QEMU local-emulator access host `stack.config.ts` paths reliably?
A: Use a host-side file bridge plus backend helper support rather than assuming the guest can read macOS host paths directly. In this repo that means `docker/local-emulator/qemu/host-file-bridge.mjs` running on the host, `apps/backend/src/lib/local-emulator.ts` reading/writing through `STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL` and `STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN`, and `docker/local-emulator/qemu/run-emulator.sh` injecting those values into the dev-server guest runtime config.

Q: What was the subtle process-lifecycle bug with the QEMU host file bridge on macOS?
A: Starting the bridge with a plain background shell job (even with `nohup`) was not reliable; the process printed its startup line and then died after the launcher shell exited. The durable fix was to spawn it in a new session from `docker/local-emulator/qemu/run-emulator.sh` using Python's `subprocess.Popen(..., start_new_session=True)` and then wait for `http://127.0.0.1:${PORT_PREFIX}16/health` before booting the app guest.

Q: How should the QEMU image build decide whether to reuse a cached Docker image bundle?
A: Reusing `docker/local-emulator/qemu/images/*-docker-image.tar.gz` blindly causes stale guest images after the app Docker image changes. `docker/local-emulator/qemu/build-image.sh` should compare the current Docker image ID to a sidecar metadata file like `*.image-id` and only reuse the cached tarball when the IDs match; otherwise it must regenerate the bundle before provisioning the qcow image.

Q: Why does the QEMU emulator's app container take so long to start, and what optimizations help?
A: The app container runs `docker/server/entrypoint.sh` which by default: (1) runs DB migrations, (2) runs seed, (3) copies the entire /app to a working directory (`cp -r /app/. /var/tmp/stack-runtime/.`), and (4) does find+sed sentinel replacement on all files. Migrations/seed cannot be skipped because they're never pre-run during the QEMU build (the STACKCFG ISO isn't present during build, so the app container fails to start during provisioning). Two optimizations cut startup from ~92s to ~62s: (a) use qcow2 backing files (`qemu-img create -f qcow2 -b base -F qcow2 overlay`) instead of copying the full 2.2GB base image, and (b) set `STACK_RUNTIME_WORK_DIR=/app` in the emulator env so the entrypoint skips the ~2.6GB app copy and does sentinel replacement in-place (safe since the container is ephemeral with `--rm`).

Q: Why can't STACK_SKIP_MIGRATIONS be set in the QEMU cloud-init user-data?
A: During the QEMU image build, cloud-init provisions the VM using the same `render-stack-env` script as runtime. If `STACK_SKIP_MIGRATIONS=true` is hardcoded there, the build's container start also skips migrations (when the DB is actually empty). Since there's no STACKCFG ISO during build, the render-stack-env script fails anyway, but if it were fixed, the skip flag would prevent DB setup. Runtime-only flags should go in the runtime.env on the STACKCFG ISO (created by `run-emulator.sh`'s `prepare_runtime_config_iso`).

Q: How does the QEMU emulator snapshot restore work?
A: After a successful cold boot where all services are green, `run-emulator.sh` saves a QEMU `savevm` snapshot (named "ready") for both the deps and dev-server VMs via QMP. The snapshot includes full CPU/RAM/device state. On subsequent starts, if both overlays contain a "ready" snapshot, QEMU is launched with `-loadvm ready` which restores the entire VM state instantly (no Linux boot, no Docker start, no migrations). This reduces restart from ~62s to ~4s. If snapshot restore fails (services don't come up within 30s), the script automatically falls back to a fresh boot. Use `pnpm emulator-qemu:reset` to clear snapshots and force a fresh boot.

Q: Why does the QEMU emulator use a deterministic file bridge token instead of a random one?
A: The file bridge token is baked into the VM's environment when the container starts. When restoring from a snapshot, the VM resumes with the old token. If the host bridge generates a new random token each time, the VM's token won't match and file bridge requests will fail. Using a deterministic token derived from the port prefix (`shasum -a 256` of `stack-local-emulator-$PORT_PREFIX`) ensures the same token on every start, making snapshot restore work seamlessly.

Q: Why can't `qemu-img snapshot -l` be used to check snapshots while QEMU is running?
A: QEMU holds an exclusive write lock on the qcow2 file. `qemu-img` commands (including `snapshot -l`) fail with "Failed to get shared write lock". To check snapshots while QEMU runs, use QMP: `{"execute":"human-monitor-command","arguments":{"command-line":"info snapshots"}}`. To check snapshots when QEMU is stopped (e.g., in `role_has_snapshot`), `qemu-img snapshot -l` works fine.
