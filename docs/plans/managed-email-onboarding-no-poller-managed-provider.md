## New email managed provider setup

### `config/schema.ts` Changes
Update `packages/stack-shared/src/config/schema.ts` in `emails.server`:

1. Extend provider enum:
- from `oneOf(['resend', 'smtp'])`
- to `oneOf(['resend', 'smtp', 'managed'])`

2. Add managed metadata fields under `emails.server`:
- `managedSubdomain?: string` (e.g. `mail.example.com`)
- `managedSenderLocalPart?: string` (e.g. `noreply`)

3. Validation rules:
- When `provider === 'managed'` and `isShared === false`, require:
  - `password` (created resend api key)
  - plus all managed metadata fields above.
- For `provider !== 'managed'`, managed metadata fields optional/undefined.

4. Defaults:
- Keep default provider as `"smtp"` (existing behavior).
- Managed metadata defaults to `undefined`.


### Backend/API Plan
Add 2 internal routes:
1. `POST /api/latest/internal/emails/managed-onboarding/setup`
- Input: `subdomain`, `sender_local_part`
- Creates a dedicated Cloudflare zone for that exact subdomain
- Creates new domain in Resend and writes required DNS records into the Cloudflare zone
- Returns Cloudflare NS records for user to set at their existing DNS provider, plus `domainId`.

2. `POST /api/latest/internal/emails/managed-onboarding/check`
- Verifies that NS records are set. If not, return early
- Creates scoped Resend key.
- Writes `emails.server` with:
  - `provider: "managed"`
  - resend api key
  - managed metadata fields.

### Dashboard / SDK
- Add 2 admin SDK methods (`checkManagedEmailStatus`, `setupManagedEmailProvider`).
- Emails page:
  - managed setup button
    - Opens dialog with inputs for subdomain, sender_local_part
    - Calls setupManagedEmailProvider with values and shows user NS records to set
    - Polls checkManagedEmailStatus until complete
  - If current provider is `managed`, show stored subdomain + sender values from config.
