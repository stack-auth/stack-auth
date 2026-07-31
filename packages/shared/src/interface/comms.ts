import type { InferType } from "yup";
import * as yup from "yup";
import {
  jsonSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "../schema-fields";

// ---------------------------------------------------------------------------
// Contact channel types (API uses lowercase; Prisma stores EMAIL/PHONE/...)
// ---------------------------------------------------------------------------

export const contactChannelTypeValues = ["email", "phone", "discord", "slack", "push"] as const;
export type ContactChannelTypeValue = (typeof contactChannelTypeValues)[number];

export const pushProviderValues = ["apns", "fcm"] as const;
export type PushProvider = (typeof pushProviderValues)[number];

export const pushEnvironmentValues = ["development", "production"] as const;
export type PushEnvironment = (typeof pushEnvironmentValues)[number];

const contactChannelBaseFields = {
  id: yupString().uuid().defined(),
  contact_id: yupString().uuid().defined(),
  /** Canonical, type-normalized identifier used for lookup and delivery. */
  value: yupString().defined(),
  /**
   * Computed by the channel type implementation on read.
   * Never persisted and never accepted on writes.
   */
  display_value: yupString().defined(),
  is_primary: yupBoolean().defined(),
  is_verified: yupBoolean().defined(),
  verified_at_millis: yupNumber().nullable().defined(),
  metadata: jsonSchema,
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
};

export const contactChannelEmailSchema = yupObject({
  ...contactChannelBaseFields,
  type: yupString().oneOf(["email"]).defined(),
}).defined();

export const contactChannelPhoneSchema = yupObject({
  ...contactChannelBaseFields,
  type: yupString().oneOf(["phone"]).defined(),
  extension: yupString().nullable().defined(),
}).defined();

export const contactChannelDiscordSchema = yupObject({
  ...contactChannelBaseFields,
  type: yupString().oneOf(["discord"]).defined(),
}).defined();

export const contactChannelSlackSchema = yupObject({
  ...contactChannelBaseFields,
  type: yupString().oneOf(["slack"]).defined(),
  workspace_id: yupString().defined(),
}).defined();

export const contactChannelPushSchema = yupObject({
  ...contactChannelBaseFields,
  type: yupString().oneOf(["push"]).defined(),
  provider: yupString().oneOf(pushProviderValues).defined(),
  app_id: yupString().defined(),
  environment: yupString().oneOf(pushEnvironmentValues).defined(),
}).defined();

export const contactChannelSchema = yupUnion(
  contactChannelEmailSchema,
  contactChannelPhoneSchema,
  contactChannelDiscordSchema,
  contactChannelSlackSchema,
  contactChannelPushSchema,
).defined();

export type ContactChannel = InferType<typeof contactChannelSchema>;

// Write inputs omit id/display_value/timestamps (server-assigned / computed).
const contactChannelWriteBaseFields = {
  value: yupString().defined(),
  is_primary: yupBoolean().optional(),
  is_verified: yupBoolean().optional(),
  metadata: jsonSchema.optional(),
};

export const contactChannelEmailWriteSchema = yupObject({
  ...contactChannelWriteBaseFields,
  type: yupString().oneOf(["email"]).defined(),
}).defined();

export const contactChannelPhoneWriteSchema = yupObject({
  ...contactChannelWriteBaseFields,
  type: yupString().oneOf(["phone"]).defined(),
  extension: yupString().nullable().optional(),
}).defined();

export const contactChannelDiscordWriteSchema = yupObject({
  ...contactChannelWriteBaseFields,
  type: yupString().oneOf(["discord"]).defined(),
}).defined();

export const contactChannelSlackWriteSchema = yupObject({
  ...contactChannelWriteBaseFields,
  type: yupString().oneOf(["slack"]).defined(),
  workspace_id: yupString().defined(),
}).defined();

export const contactChannelPushWriteSchema = yupObject({
  ...contactChannelWriteBaseFields,
  type: yupString().oneOf(["push"]).defined(),
  provider: yupString().oneOf(pushProviderValues).defined(),
  app_id: yupString().defined(),
  environment: yupString().oneOf(pushEnvironmentValues).defined(),
}).defined();

export const contactChannelWriteSchema = yupUnion(
  contactChannelEmailWriteSchema,
  contactChannelPhoneWriteSchema,
  contactChannelDiscordWriteSchema,
  contactChannelSlackWriteSchema,
  contactChannelPushWriteSchema,
).defined();

export type ContactChannelWrite = InferType<typeof contactChannelWriteSchema>;

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export const contactSchema = yupObject({
  id: yupString().uuid().defined(),
  display_name: yupString().nullable().defined(),
  profile_image_url: yupString().nullable().defined(),
  client_metadata: jsonSchema,
  client_read_only_metadata: jsonSchema,
  server_metadata: jsonSchema,
  merged_into_contact_id: yupString().uuid().nullable().defined(),
  merged_at_millis: yupNumber().nullable().defined(),
  is_user_backed: yupBoolean().defined(),
  channels: yupArray(contactChannelSchema).defined(),
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
}).defined();

export type Contact = InferType<typeof contactSchema>;

export const contactCreateSchema = yupObject({
  id: yupString().uuid().optional(),
  display_name: yupString().nullable().optional(),
  profile_image_url: yupString().nullable().optional(),
  client_metadata: jsonSchema.optional(),
  client_read_only_metadata: jsonSchema.optional(),
  server_metadata: jsonSchema.optional(),
  channels: yupArray(contactChannelWriteSchema).optional(),
}).defined();

export type ContactCreate = InferType<typeof contactCreateSchema>;

export const contactUpdateSchema = yupObject({
  display_name: yupString().nullable().optional(),
  profile_image_url: yupString().nullable().optional(),
  client_metadata: jsonSchema.optional(),
  client_read_only_metadata: jsonSchema.optional(),
  server_metadata: jsonSchema.optional(),
}).defined();

export type ContactUpdate = InferType<typeof contactUpdateSchema>;

export const contactMergeRequestSchema = yupObject({
  source_contact_id: yupString().uuid().defined(),
  target_contact_id: yupString().uuid().defined(),
  idempotency_key: yupString().min(1).defined(),
  actor_user_id: yupString().uuid().nullable().optional(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

export type ContactMergeRequest = InferType<typeof contactMergeRequestSchema>;

// ---------------------------------------------------------------------------
// Comms message payload (closed union — no custom)
// ---------------------------------------------------------------------------

export const emailHeaderSchema = yupObject({
  /** Original header name/casing; duplicates and order are preserved by the array. */
  name: yupString().defined(),
  value: yupString().defined(),
}).defined();

export const commsMessagePayloadEmailSchema = yupObject({
  type: yupString().oneOf(["email"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  subject: yupString().nullable().defined(),
  text_body: yupString().nullable().defined(),
  html_body: yupString().nullable().defined(),
  amp_html_body: yupString().nullable().defined(),
  headers: yupArray(emailHeaderSchema).defined(),
}).defined();

export const commsMessagePayloadSlackSchema = yupObject({
  type: yupString().oneOf(["slack"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  text: yupString().defined(),
  blocks: jsonSchema,
  workspace_id: yupString().defined(),
  channel_id: yupString().defined(),
  thread_id: yupString().nullable().defined(),
}).defined();

export const commsMessagePayloadDiscordSchema = yupObject({
  type: yupString().oneOf(["discord"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  content: yupString().defined(),
  embeds: yupArray(jsonSchema.nonNullable().defined()).defined(),
  guild_id: yupString().nullable().defined(),
  channel_id: yupString().defined(),
  thread_id: yupString().nullable().defined(),
}).defined();

export const commsMessagePayloadPushSchema = yupObject({
  type: yupString().oneOf(["push"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  title: yupString().nullable().defined(),
  body: yupString().defined(),
  data: jsonSchema,
}).defined();

export const commsMessagePayloadSchema = yupUnion(
  commsMessagePayloadEmailSchema,
  commsMessagePayloadSlackSchema,
  commsMessagePayloadDiscordSchema,
  commsMessagePayloadPushSchema,
).defined();

export type CommsMessagePayload = InferType<typeof commsMessagePayloadSchema>;

// ---------------------------------------------------------------------------
// Participants / attachments / relations
// ---------------------------------------------------------------------------

export const commsParticipantRoleValues = [
  "author",
  "from",
  "sender",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "envelope-from",
  "envelope-to",
  "audience",
] as const;
export type CommsParticipantRole = (typeof commsParticipantRoleValues)[number];

export const commsMessageParticipantSchema = yupObject({
  id: yupString().uuid().defined(),
  role: yupString().oneOf(commsParticipantRoleValues).defined(),
  position: yupNumber().integer().min(0).defined(),
  contact_id: yupString().uuid().nullable().defined(),
  contact_channel_id: yupString().uuid().nullable().defined(),
  address_snapshot: yupString().defined(),
  display_name_snapshot: yupString().nullable().defined(),
}).defined();

export type CommsMessageParticipant = InferType<typeof commsMessageParticipantSchema>;

export const commsMessageParticipantWriteSchema = yupObject({
  role: yupString().oneOf(commsParticipantRoleValues).defined(),
  position: yupNumber().integer().min(0).optional(),
  contact_id: yupString().uuid().nullable().optional(),
  contact_channel_id: yupString().uuid().nullable().optional(),
  /**
   * Identity used to resolve or create a participant snapshot.
   * When type+value(+scope fields) are provided, the domain layer resolves a contact.
   */
  channel: contactChannelWriteSchema.optional(),
  address_snapshot: yupString().optional(),
  display_name_snapshot: yupString().nullable().optional(),
}).defined();

export type CommsMessageParticipantWrite = InferType<typeof commsMessageParticipantWriteSchema>;

export const commsMessageAttachmentSchema = yupObject({
  id: yupString().uuid().defined(),
  filename: yupString().nullable().defined(),
  content_type: yupString().nullable().defined(),
  size_bytes: yupNumber().integer().nullable().defined(),
  content_id: yupString().nullable().defined(),
  is_inline: yupBoolean().defined(),
  storage_key: yupString().nullable().defined(),
  metadata: jsonSchema,
}).defined();

export type CommsMessageAttachment = InferType<typeof commsMessageAttachmentSchema>;

export const commsMessageAttachmentWriteSchema = yupObject({
  filename: yupString().nullable().optional(),
  content_type: yupString().nullable().optional(),
  size_bytes: yupNumber().integer().min(0).nullable().optional(),
  content_id: yupString().nullable().optional(),
  is_inline: yupBoolean().optional(),
  storage_key: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

export type CommsMessageAttachmentWrite = InferType<typeof commsMessageAttachmentWriteSchema>;

export const commsMessageRelationTypeValues = ["in-reply-to", "references", "quote", "other"] as const;
export type CommsMessageRelationType = (typeof commsMessageRelationTypeValues)[number];

export const commsMessageRelationSchema = yupObject({
  id: yupString().uuid().defined(),
  relation_type: yupString().oneOf(commsMessageRelationTypeValues).defined(),
  to_message_id: yupString().uuid().nullable().defined(),
  external_message_id: yupString().nullable().defined(),
  position: yupNumber().integer().min(0).defined(),
}).defined();

export type CommsMessageRelation = InferType<typeof commsMessageRelationSchema>;

export const commsMessageRelationWriteSchema = yupObject({
  relation_type: yupString().oneOf(commsMessageRelationTypeValues).defined(),
  to_message_id: yupString().uuid().nullable().optional(),
  external_message_id: yupString().min(1).nullable().optional(),
  position: yupNumber().integer().min(0).optional(),
}).defined();

export type CommsMessageRelationWrite = InferType<typeof commsMessageRelationWriteSchema>;

// ---------------------------------------------------------------------------
// Conversations / messages
// ---------------------------------------------------------------------------

export const commsMessageDirectionValues = ["inbound", "outbound"] as const;
export type CommsMessageDirection = (typeof commsMessageDirectionValues)[number];

export const commsConversationSchema = yupObject({
  id: yupString().uuid().defined(),
  title: yupString().nullable().defined(),
  merged_into_conversation_id: yupString().uuid().nullable().defined(),
  merged_at_millis: yupNumber().nullable().defined(),
  first_message_at_millis: yupNumber().nullable().defined(),
  last_message_at_millis: yupNumber().nullable().defined(),
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
}).defined();

export type CommsConversation = InferType<typeof commsConversationSchema>;

export const commsMessageSchema = yupObject({
  id: yupString().uuid().defined(),
  conversation_id: yupString().uuid().defined(),
  direction: yupString().oneOf(commsMessageDirectionValues).defined(),
  adapter_key: yupString().defined(),
  external_message_id: yupString().nullable().defined(),
  external_thread_id: yupString().nullable().defined(),
  reply_to_message_id: yupString().uuid().nullable().defined(),
  occurred_at_millis: yupNumber().defined(),
  ingested_at_millis: yupNumber().defined(),
  payload: commsMessagePayloadSchema,
  participants: yupArray(commsMessageParticipantSchema).defined(),
  attachments: yupArray(commsMessageAttachmentSchema).defined(),
  relations: yupArray(commsMessageRelationSchema).defined(),
  raw_blob_key: yupString().nullable().defined(),
}).defined();

export type CommsMessage = InferType<typeof commsMessageSchema>;

export const commsMessageIngestSchema = yupObject({
  direction: yupString().oneOf(commsMessageDirectionValues).defined(),
  adapter_key: yupString().min(1).defined(),
  external_message_id: yupString().min(1).nullable().optional(),
  external_thread_id: yupString().min(1).nullable().optional(),
  reply_to_message_id: yupString().uuid().nullable().optional(),
  occurred_at_millis: yupNumber().defined(),
  payload: commsMessagePayloadSchema,
  participants: yupArray(commsMessageParticipantWriteSchema).min(1).defined(),
  attachments: yupArray(commsMessageAttachmentWriteSchema).optional(),
  relations: yupArray(commsMessageRelationWriteSchema).optional(),
  raw_blob_key: yupString().nullable().optional(),
  conversation_id: yupString().uuid().nullable().optional(),
}).defined();

export type CommsMessageIngest = InferType<typeof commsMessageIngestSchema>;

// ---------------------------------------------------------------------------
// Assignment / merge / split / reassign
// ---------------------------------------------------------------------------

export const commsAssignmentReasonValues = [
  "reply",
  "external-thread",
  "rules",
  "ai",
  "manual",
  "merge",
  "split",
] as const;
export type CommsAssignmentReason = (typeof commsAssignmentReasonValues)[number];

export const commsMessageAssignmentSchema = yupObject({
  id: yupString().uuid().defined(),
  message_id: yupString().uuid().defined(),
  from_conversation_id: yupString().uuid().nullable().defined(),
  to_conversation_id: yupString().uuid().defined(),
  reason: yupString().oneOf(commsAssignmentReasonValues).defined(),
  confidence: yupNumber().nullable().defined(),
  operation_id: yupString().uuid().defined(),
  created_at_millis: yupNumber().defined(),
}).defined();

export type CommsMessageAssignment = InferType<typeof commsMessageAssignmentSchema>;

export const commsConversationOperationTypeValues = ["merge", "split", "reassign"] as const;
export type CommsConversationOperationType = (typeof commsConversationOperationTypeValues)[number];

export const commsMergeConversationsRequestSchema = yupObject({
  source_conversation_id: yupString().uuid().defined(),
  target_conversation_id: yupString().uuid().defined(),
  idempotency_key: yupString().min(1).defined(),
  actor_user_id: yupString().uuid().nullable().optional(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

export type CommsMergeConversationsRequest = InferType<typeof commsMergeConversationsRequestSchema>;

export const commsSplitConversationRequestSchema = yupObject({
  source_conversation_id: yupString().uuid().defined(),
  message_ids: yupArray(yupString().uuid().defined()).min(1).defined(),
  idempotency_key: yupString().min(1).defined(),
  title: yupString().nullable().optional(),
  actor_user_id: yupString().uuid().nullable().optional(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

export type CommsSplitConversationRequest = InferType<typeof commsSplitConversationRequestSchema>;

export const commsReassignMessagesRequestSchema = yupObject({
  message_ids: yupArray(yupString().uuid().defined()).min(1).defined(),
  target_conversation_id: yupString().uuid().defined(),
  idempotency_key: yupString().min(1).defined(),
  actor_user_id: yupString().uuid().nullable().optional(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

export type CommsReassignMessagesRequest = InferType<typeof commsReassignMessagesRequestSchema>;

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

export const commsDeliveryStatusValues = [
  "pending",
  "queued",
  "sending",
  "sent",
  "delivered",
  "delayed",
  "bounced",
  "failed",
  "skipped",
] as const;
export type CommsDeliveryStatus = (typeof commsDeliveryStatusValues)[number];

export const commsDeliveryAttemptOutcomeValues = ["success", "failure", "deferred"] as const;
export type CommsDeliveryAttemptOutcome = (typeof commsDeliveryAttemptOutcomeValues)[number];

export const commsDeliveryAttemptSchema = yupObject({
  id: yupString().uuid().defined(),
  attempt_number: yupNumber().integer().min(1).defined(),
  outcome: yupString().oneOf(commsDeliveryAttemptOutcomeValues).defined(),
  attempted_at_millis: yupNumber().defined(),
  finished_at_millis: yupNumber().nullable().defined(),
  provider_response: jsonSchema,
  error_public: yupString().nullable().defined(),
  error_internal: yupString().nullable().defined(),
}).defined();

export type CommsDeliveryAttempt = InferType<typeof commsDeliveryAttemptSchema>;

export const commsDeliverySchema = yupObject({
  id: yupString().uuid().defined(),
  message_id: yupString().uuid().defined(),
  participant_id: yupString().uuid().nullable().defined(),
  address_snapshot: yupString().defined(),
  status: yupString().oneOf(commsDeliveryStatusValues).defined(),
  provider_message_id: yupString().nullable().defined(),
  skipped_reason: yupString().nullable().defined(),
  last_error_public: yupString().nullable().defined(),
  last_error_internal: yupString().nullable().defined(),
  sent_at_millis: yupNumber().nullable().defined(),
  delivered_at_millis: yupNumber().nullable().defined(),
  bounced_at_millis: yupNumber().nullable().defined(),
  failed_at_millis: yupNumber().nullable().defined(),
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
  attempts: yupArray(commsDeliveryAttemptSchema).optional(),
}).defined();

export type CommsDelivery = InferType<typeof commsDeliverySchema>;

export const commsDeliveryCreateSchema = yupObject({
  address_snapshot: yupString().min(1).defined(),
  participant_id: yupString().uuid().nullable().optional(),
  status: yupString().oneOf(commsDeliveryStatusValues).optional(),
}).defined();

export type CommsDeliveryCreate = InferType<typeof commsDeliveryCreateSchema>;

export const commsDeliveryStatusUpdateSchema = yupObject({
  status: yupString().oneOf(commsDeliveryStatusValues).defined(),
  provider_message_id: yupString().nullable().optional(),
  skipped_reason: yupString().nullable().optional(),
  last_error_public: yupString().nullable().optional(),
  last_error_internal: yupString().nullable().optional(),
}).defined();

export type CommsDeliveryStatusUpdate = InferType<typeof commsDeliveryStatusUpdateSchema>;

export const commsDeliveryAttemptCreateSchema = yupObject({
  outcome: yupString().oneOf(commsDeliveryAttemptOutcomeValues).defined(),
  provider_response: jsonSchema.optional(),
  error_public: yupString().nullable().optional(),
  error_internal: yupString().nullable().optional(),
  finished_at_millis: yupNumber().nullable().optional(),
  status: yupString().oneOf(commsDeliveryStatusValues).optional(),
  provider_message_id: yupString().nullable().optional(),
}).defined();

export type CommsDeliveryAttemptCreate = InferType<typeof commsDeliveryAttemptCreateSchema>;

export const contactChannelUpdateSchema = yupObject({
  is_primary: yupBoolean().optional(),
  is_verified: yupBoolean().optional(),
  metadata: jsonSchema.optional(),
  // Type-specific optional updates. Value/identity changes require delete+create.
  extension: yupString().nullable().optional(),
}).defined();

export type ContactChannelUpdate = InferType<typeof contactChannelUpdateSchema>;
