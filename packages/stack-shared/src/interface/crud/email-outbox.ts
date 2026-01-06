import { CrudTypeOf, createCrud } from "../../crud";
import * as fieldSchema from "../../schema-fields";


// Recipient types
const recipientUserPrimaryEmailSchema = fieldSchema.yupObject({
  type: fieldSchema.yupString().oneOf(["user-primary-email"]).defined(),
  user_id: fieldSchema.yupString().defined(),
}).defined();

const recipientUserCustomEmailsSchema = fieldSchema.yupObject({
  type: fieldSchema.yupString().oneOf(["user-custom-emails"]).defined(),
  user_id: fieldSchema.yupString().defined(),
  emails: fieldSchema.yupArray(fieldSchema.yupString().defined()).defined(),
}).defined();

const recipientCustomEmailsSchema = fieldSchema.yupObject({
  type: fieldSchema.yupString().oneOf(["custom-emails"]).defined(),
  emails: fieldSchema.yupArray(fieldSchema.yupString().defined()).defined(),
}).defined();

const recipientSchema = fieldSchema.yupUnion(
  recipientUserPrimaryEmailSchema,
  recipientUserCustomEmailsSchema,
  recipientCustomEmailsSchema
);


// =============================== BASE FIELDS ===============================

// Base fields present on all emails
const emailOutboxBaseSchema = fieldSchema.yupObject({
  id: fieldSchema.yupString().defined(),
  created_at_millis: fieldSchema.yupNumber().defined(),
  updated_at_millis: fieldSchema.yupNumber().defined(),
  tsx_source: fieldSchema.yupString().defined(),
  theme_id: fieldSchema.yupString().nullable().defined(),
  to: recipientSchema.defined(),
  variables: fieldSchema.yupRecord(fieldSchema.yupString(), fieldSchema.jsonSchema).defined(),
  skip_deliverability_check: fieldSchema.yupBoolean().defined(),
  scheduled_at_millis: fieldSchema.yupNumber().defined(),

  status: fieldSchema.yupString().defined(),
  simple_status: fieldSchema.yupString().defined(),

  // These fields are overridden because we use concat to build the final schema for each state
  is_paused: fieldSchema.yupBoolean().oneOf([false]).defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([false]).defined(),
  has_delivered: fieldSchema.yupBoolean().oneOf([false]).defined(),
}).defined();

// Rendered output fields
const renderedFieldsSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  started_rendering_at_millis: fieldSchema.yupNumber().defined(),
  rendered_at_millis: fieldSchema.yupNumber().defined(),
  subject: fieldSchema.yupString().defined(),
  html: fieldSchema.yupString().nullable().defined(),
  text: fieldSchema.yupString().nullable().defined(),
  is_transactional: fieldSchema.yupBoolean().defined(),
  is_high_priority: fieldSchema.yupBoolean().defined(),
  notification_category_id: fieldSchema.yupString().nullable().defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const startedSendingFieldsSchema = renderedFieldsSchema.concat(fieldSchema.yupObject({
  started_sending_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

// Finished delivering tracking fields
const finishedDeliveringFieldsSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  delivered_at_millis: fieldSchema.yupNumber().defined(),
  has_delivered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());


// =============================== STATUS-SPECIFIC SCHEMAS ===============================

const pausedStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["paused"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
  is_paused: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const preparingStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["preparing"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
}).defined());

const renderingStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["rendering"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
  started_rendering_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const renderErrorStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["render-error"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["error"]).defined(),
  started_rendering_at_millis: fieldSchema.yupNumber().defined(),
  rendered_at_millis: fieldSchema.yupNumber().defined(),
  render_error: fieldSchema.yupString().defined(),
}).defined());

const scheduledStatusSchema = renderedFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["scheduled"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const queuedStatusSchema = renderedFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["queued"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const sendingStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["sending"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["in-progress"]).defined(),
}).defined());

const serverErrorStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["server-error"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["error"]).defined(),
  error_at_millis: fieldSchema.yupNumber().defined(),
  server_error: fieldSchema.yupString().defined(),
}).defined());

// SKIPPED can happen at any time in the lifecycle (like PAUSED)
// An email can be skipped before rendering (has_rendered: false) or after rendering (has_rendered: true)
// e.g., user deleted after the email was rendered but before it was sent
const skippedStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["skipped"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  skipped_at_millis: fieldSchema.yupNumber().defined(),
  skipped_reason: fieldSchema.yupString().defined(),
  skipped_details: fieldSchema.yupRecord(fieldSchema.yupString(), fieldSchema.jsonSchema).defined(),
  // Override has_rendered to allow both true and false since email can be skipped at any time
  has_rendered: fieldSchema.yupBoolean().defined(),
  // These fields may or may not be present depending on when the email was skipped
  started_rendering_at_millis: fieldSchema.yupNumber().optional(),
  rendered_at_millis: fieldSchema.yupNumber().optional(),
  subject: fieldSchema.yupString().optional(),
  html: fieldSchema.yupString().nullable().optional(),
  text: fieldSchema.yupString().nullable().optional(),
  is_transactional: fieldSchema.yupBoolean().optional(),
  is_high_priority: fieldSchema.yupBoolean().optional(),
  notification_category_id: fieldSchema.yupString().nullable().optional(),
  started_sending_at_millis: fieldSchema.yupNumber().optional(),
}).defined());

const bouncedStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["bounced"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["error"]).defined(),
  bounced_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const deliveryDelayedStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["delivery-delayed"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  delivery_delayed_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const sentStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["sent"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  // Whether this email's provider supports delivery tracking (opens, clicks, etc.)
  can_have_delivery_info: fieldSchema.yupBoolean().defined(),
}).defined());

const openedStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["opened"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  opened_at_millis: fieldSchema.yupNumber().defined(),
  can_have_delivery_info: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const clickedStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["clicked"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  clicked_at_millis: fieldSchema.yupNumber().defined(),
  can_have_delivery_info: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const markedAsSpamStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["marked-as-spam"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ok"]).defined(),
  marked_as_spam_at_millis: fieldSchema.yupNumber().defined(),
  can_have_delivery_info: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

// Combined read schema using union
export const emailOutboxReadSchema = fieldSchema.yupUnion(
  pausedStatusSchema,
  preparingStatusSchema,
  renderingStatusSchema,
  renderErrorStatusSchema,
  scheduledStatusSchema,
  queuedStatusSchema,
  sendingStatusSchema,
  serverErrorStatusSchema,
  skippedStatusSchema,
  bouncedStatusSchema,
  deliveryDelayedStatusSchema,
  sentStatusSchema,
  openedStatusSchema,
  clickedStatusSchema,
  markedAsSpamStatusSchema
);

// Update schema for PATCH endpoint
export const emailOutboxUpdateSchema = fieldSchema.yupObject({
  tsx_source: fieldSchema.yupString().optional(),
  theme_id: fieldSchema.yupString().nullable().optional(),
  to: recipientSchema.optional(),
  variables: fieldSchema.yupRecord(fieldSchema.yupString(), fieldSchema.jsonSchema).optional(),
  skip_deliverability_check: fieldSchema.yupBoolean().optional(),
  scheduled_at_millis: fieldSchema.yupNumber().optional(),
  is_paused: fieldSchema.yupBoolean().optional(),
  cancel: fieldSchema.yupBoolean().oneOf([true]).optional(),
}).defined();

export const emailOutboxCrud = createCrud({
  serverReadSchema: emailOutboxReadSchema,
  serverUpdateSchema: emailOutboxUpdateSchema,
  docs: {
    serverRead: {
      tags: ["Emails"],
      summary: "Get email outbox entry",
      description: "Gets a single email from the outbox by ID.",
    },
    serverUpdate: {
      tags: ["Emails"],
      summary: "Update email outbox entry",
      description: "Updates an email in the outbox. Can be used to edit email content, pause/resume, or cancel emails. Only emails in editable states (`paused`, `preparing`, `rendering`, `render-error`, `scheduled`, `queued`, `server-error`) can be modified.",
    },
    serverList: {
      tags: ["Emails"],
      summary: "List email outbox",
      description: "Lists all emails in the outbox with optional filtering by status or simple_status.",
    },
  },
});

export type EmailOutboxCrud = CrudTypeOf<typeof emailOutboxCrud>;

