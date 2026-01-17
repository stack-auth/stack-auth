# StackAdminApp

Extends StackServerApp with administrative capabilities. Requires superSecretAdminKey.


## Constructor

StackAdminApp(options)

Extends StackServerApp constructor options with:

Required:
  superSecretAdminKey: string - from Stack Auth dashboard

Optional:
  projectOwnerSession: InternalSession - for internal use only


## getProject()

Returns: AdminProject

GET /projects/current [admin-only]
Route: apps/backend/src/app/api/latest/projects/current/route.ts

AdminProject extends Project with full configuration access and update methods.

Does not error.


## Permission Definition Methods


### listTeamPermissionDefinitions()

Returns: AdminTeamPermissionDefinition[]

GET /team-permission-definitions [admin-only]
Route: apps/backend/src/app/api/latest/team-permission-definitions/route.ts

Does not error.


### createTeamPermissionDefinition(options)

options.id: string - permission identifier (e.g., "read", "admin")
options.description: string?

Returns: AdminTeamPermission

POST /team-permission-definitions { id, description } [admin-only]

Does not error.


### updateTeamPermissionDefinition(permissionId, options)

permissionId: string
options.description: string?

PATCH /team-permission-definitions/{permissionId} { description } [admin-only]

Does not error.


### deleteTeamPermissionDefinition(permissionId)

permissionId: string

DELETE /team-permission-definitions/{permissionId} [admin-only]

Does not error.


### listProjectPermissionDefinitions()

Returns: AdminProjectPermissionDefinition[]

GET /project-permission-definitions [admin-only]

Does not error.


### createProjectPermissionDefinition(options)

options.id: string
options.description: string?

Returns: AdminProjectPermission

POST /project-permission-definitions { id, description } [admin-only]

Does not error.


### updateProjectPermissionDefinition(permissionId, options)

permissionId: string
options.description: string?

PATCH /project-permission-definitions/{permissionId} { description } [admin-only]

Does not error.


### deleteProjectPermissionDefinition(permissionId)

permissionId: string

DELETE /project-permission-definitions/{permissionId} [admin-only]

Does not error.


## API Key Methods


### listInternalApiKeys()

Returns: InternalApiKey[]

GET /internal/api-keys [admin-only]

InternalApiKey has:
  id: string
  description: string
  expiresAt: Date | null
  createdAt: Date
  isPublishableClientKey: bool
  isSecretServerKey: bool
  isSuperSecretAdminKey: bool
  hasPublishableClientKey: bool
  hasSecretServerKey: bool
  hasSuperSecretAdminKey: bool
  userId: string | null
  teamId: string | null

Does not error.


### createInternalApiKey(options)

options.description: string
options.expiresAt: Date?
options.isPublishableClientKey: bool?
options.isSecretServerKey: bool?
options.isSuperSecretAdminKey: bool?
options.userId: string?
options.teamId: string?

Returns: InternalApiKeyFirstView

POST /internal/api-keys { ... } [admin-only]

InternalApiKeyFirstView extends InternalApiKey with:
  publishableClientKey: string | null
  secretServerKey: string | null
  superSecretAdminKey: string | null

Does not error.


## Email Methods


### sendTestEmail(options)

options.recipientEmail: string
options.emailConfig: EmailConfig

Returns: Result<void, { errorMessage: string }>

POST /internal/email/test { recipient_email, email_config } [admin-only]

Sends a test email to verify email configuration.

Does not error (returns Result).


### sendSignInInvitationEmail(email, callbackUrl)

email: string
callbackUrl: string

POST /auth/magic-link/send { email, callback_url, type: "sign_in_invitation" } [admin-only]

Does not error.


### listSentEmails()

Returns: AdminSentEmail[]

GET /internal/sent-emails [admin-only]

Does not error.


### Email Theme Methods

listEmailThemes(): AdminEmailTheme[]
createEmailTheme(displayName): { id: string }
updateEmailTheme(id, tsxSource): void

### Email Template Methods

listEmailTemplates(): AdminEmailTemplate[]
createEmailTemplate(displayName): { id: string }
updateEmailTemplate(id, tsxSource, themeId): { renderedHtml: string }

### Email Draft Methods

listEmailDrafts(): AdminEmailDraft[]
createEmailDraft(options): { id: string }
updateEmailDraft(id, data): void

### Email Preview

getEmailPreview(options): string (rendered HTML)


## Email Outbox Methods


### listOutboxEmails(options?)

options.status: string? - filter by status
options.simpleStatus: string? - filter by simple status
options.limit: number?
options.cursor: string?

Returns: { items: AdminEmailOutbox[], nextCursor: string | null }

GET /internal/email-outbox [admin-only]

Does not error.


### getOutboxEmail(id)

id: string

Returns: AdminEmailOutbox

GET /internal/email-outbox/{id} [admin-only]

Does not error.


### updateOutboxEmail(id, options)

id: string
options.isPaused: bool?
options.scheduledAtMillis: number?
options.cancel: bool?

Returns: AdminEmailOutbox

PATCH /internal/email-outbox/{id} { is_paused, scheduled_at_millis, cancel } [admin-only]

Does not error.


### pauseOutboxEmail(id)

id: string

Shorthand for updateOutboxEmail(id, { isPaused: true })


### unpauseOutboxEmail(id)

id: string

Shorthand for updateOutboxEmail(id, { isPaused: false })


### cancelOutboxEmail(id)

id: string

Shorthand for updateOutboxEmail(id, { cancel: true })


## Webhook Methods


### sendTestWebhook(options)

options.endpointId: string

Returns: Result<void, { errorMessage: string }>

POST /internal/webhooks/test { endpoint_id } [admin-only]

Does not error (returns Result).


## Payment Methods


### setupPayments()

Returns: { url: string }

POST /internal/payments/setup [admin-only]

Returns Stripe onboarding URL.

Does not error.


### getStripeAccountInfo()

Returns: StripeAccountInfo | null

GET /internal/payments/stripe-account [admin-only]

StripeAccountInfo has:
  account_id: string
  charges_enabled: bool
  details_submitted: bool
  payouts_enabled: bool

Does not error.


### createStripeWidgetAccountSession()

Returns: { client_secret: string }

POST /internal/payments/stripe-widget-session [admin-only]

For embedded Stripe dashboard components.

Does not error.


### createItemQuantityChange(options)

Customer identification (one of):
  options.userId: string
  options.teamId: string
  options.customCustomerId: string

options.itemId: string
options.quantity: number - positive to add, negative to subtract
options.expiresAt: string? - ISO date for expiration
options.description: string?

POST /internal/items/quantity-changes { ... } [admin-only]

Does not error.


### refundTransaction(options)

options.type: "subscription" | "one-time-purchase"
options.id: string

POST /internal/transactions/{type}/{id}/refund [admin-only]

Does not error.


### listTransactions(options?)

options.cursor: string?
options.limit: number?
options.type: TransactionType?
options.customerType: "user" | "team" | "custom"?

Returns: { transactions: Transaction[], nextCursor: string | null }

GET /internal/transactions [admin-only]

Does not error.


## Chat Methods (Email Editor AI)


### sendChatMessage(threadId, contextType, messages, abortSignal?)

threadId: string
contextType: "email-theme" | "email-template" | "email-draft"
messages: Array<{ role: string, content: any }>
abortSignal: AbortSignal?

Returns: { content: ChatContent }

POST /internal/chat/send { thread_id, context_type, messages } [admin-only]

For AI-assisted email editing.

Does not error.


### saveChatMessage(threadId, message)

POST /internal/chat/messages { thread_id, message } [admin-only]

Does not error.


### listChatMessages(threadId)

Returns: { messages: Array<any> }

GET /internal/chat/messages?thread_id={threadId} [admin-only]

Does not error.
