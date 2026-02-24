# Resend Email Onboarding (Condensed)

## Goal
Auto-provision project-specific email infrastructure using Resend + Cloudflare delegated subzones, then store only project-specific credentials/metadata in config.

## Scope
- Trigger on project create only.
- Backend automation only (no new dashboard onboarding UI).
- Keep existing SMTP send pipeline, but infer fixed Resend SMTP fields for `managed`.

## Flow
1. Create Resend domain for project subdomain under `STACK_RESEND_BASE_DOMAIN`, notifications@<project-id>.<stack-auth-domain>
2. Create a Cloudflare zone for the exact customer subdomain and return Cloudflare nameservers.
3. User adds NS delegation for the subdomain at their DNS provider.
4. Create required DNS records in Cloudflare using Resend-provided records.
5. Verify domain with Resend (required).
6. Update `packages/stack-shared/src/config/schema.ts`:
   - add a new email provider type: `managed`
   - add a new property on `emails.server` for this provider: `domainProviderId`
7. Create Resend API key with `sending_access` for domain.
8. Persist config at `emails.server`:
   - `isShared: false`
   - `provider: "managed"`
   - `password: <resend api key value>`
   - `domainProviderId`

## Files to Add
- `apps/backend/src/lib/email-domain-provisioning.tsx`

## Files to Update
- `apps/backend/src/lib/projects.tsx` (hook provisioning into create path)
- `packages/stack-shared/src/config/schema.ts` (add new email provider type + keep only required Resend metadata fields + defaults)
- `apps/backend/src/lib/emails.tsx` (resolve fixed SMTP host/port/username for `managed`)
- `apps/backend/src/lib/config.tsx` (ensure compatibility on legacy transforms)

## New Env Vars
- `STACK_RESEND_API_KEY`
- `STACK_RESEND_BASE_DOMAIN`
- `STACK_CLOUDFLARE_API_TOKEN`
- `STACK_CLOUDFLARE_ACCOUNT_ID`
- `STACK_CLOUDFLARE_API_BASE_URL` (defaults to `https://api.cloudflare.com/client/v4`)

## Fallback/Failure Rules
- `development/test`: dev provisioning envs => fallback to shared email config.
- production: provisioning envs required; failures abort project creation.
