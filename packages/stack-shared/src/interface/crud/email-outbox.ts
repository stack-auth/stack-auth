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
}).defined());


// =============================== STATUS-SPECIFIC SCHEMAS ===============================

const pausedStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["PAUSED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
  is_paused: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const preparingStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["PREPARING"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
}).defined());

const renderingStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["RENDERING"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
  started_rendering_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const renderErrorStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["RENDER_ERROR"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ERROR"]).defined(),
  started_rendering_at_millis: fieldSchema.yupNumber().defined(),
  rendered_at_millis: fieldSchema.yupNumber().defined(),
  render_error: fieldSchema.yupString().defined(),
}).defined());

const scheduledStatusSchema = renderedFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["SCHEDULED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const queuedStatusSchema = renderedFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["QUEUED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
  has_rendered: fieldSchema.yupBoolean().oneOf([true]).defined(),
}).defined());

const sendingStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["SENDING"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["IN_PROGRESS"]).defined(),
}).defined());

const serverErrorStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["SERVER_ERROR"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ERROR"]).defined(),
  error_at_millis: fieldSchema.yupNumber().defined(),
  server_error: fieldSchema.yupString().defined(),
}).defined());

// SKIPPED can happen at any time in the lifecycle (like PAUSED)
// An email can be skipped before rendering (has_rendered: false) or after rendering (has_rendered: true)
// e.g., user deleted after the email was rendered but before it was sent
const skippedStatusSchema = emailOutboxBaseSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["SKIPPED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
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
  status: fieldSchema.yupString().oneOf(["BOUNCED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["ERROR"]).defined(),
  bounced_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const deliveryDelayedStatusSchema = startedSendingFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["DELIVERY_DELAYED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
  delivery_delayed_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const sentStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["SENT"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
  has_delivered: fieldSchema.yupBoolean().oneOf([true]).defined(),
  // Whether this email's provider supports delivery tracking (opens, clicks, etc.)
  can_have_delivery_info: fieldSchema.yupBoolean().defined(),
}).defined());

const openedStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["OPENED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
  opened_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const clickedStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["CLICKED"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
  clicked_at_millis: fieldSchema.yupNumber().defined(),
}).defined());

const markedAsSpamStatusSchema = finishedDeliveringFieldsSchema.concat(fieldSchema.yupObject({
  status: fieldSchema.yupString().oneOf(["MARKED_AS_SPAM"]).defined(),
  simple_status: fieldSchema.yupString().oneOf(["OK"]).defined(),
  marked_as_spam_at_millis: fieldSchema.yupNumber().defined(),
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
      description: "Updates an email in the outbox. Can be used to edit email content, pause/resume, or cancel emails. Only emails in editable states (PAUSED, PREPARING, RENDERING, RENDER_ERROR, SCHEDULED, QUEUED, SERVER_ERROR) can be modified.",
    },
    serverList: {
      tags: ["Emails"],
      summary: "List email outbox",
      description: "Lists all emails in the outbox with optional filtering by status or simple_status.",
    },
  },
});

export type EmailOutboxCrud = CrudTypeOf<typeof emailOutboxCrud>;

