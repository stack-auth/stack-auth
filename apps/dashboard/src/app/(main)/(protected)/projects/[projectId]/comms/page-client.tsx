"use client";

import { useServerApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Spinner, Textarea } from "@/components/ui";
import {
  createDefaultDataGridState,
  DataGrid,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import type {
  HexclaveServerApp,
  ServerCommsConversation,
  ServerCommsDelivery,
  ServerCommsMessage,
  ServerCommsMessageCreateOptions,
  ServerContact,
} from "@hexclave/next";
import {
  jsonSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupUnion,
} from "@hexclave/shared/dist/schema-fields";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { use } from "@hexclave/shared/dist/utils/react";
import {
  ArrowsClockwiseIcon,
  ChatCircleDotsIcon,
  IdentificationCardIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { Suspense, useState, useTransition } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

type View = "messages" | "conversations" | "contacts";

type LoadState = {
  status: "error" | "ok",
  contacts: ServerContact[],
  conversations: ServerCommsConversation[],
  messages: ServerCommsMessage[],
  nextCursor: string | null,
  error?: string,
};

type PageRequest = {
  requestId: string,
  cursor: string | undefined,
  previousCursors: Array<string | undefined>,
  promise: Promise<LoadState>,
};

function createFirstPageRequest(serverApp: HexclaveServerApp<false>, view: View): PageRequest {
  return {
    requestId: crypto.randomUUID(),
    cursor: undefined,
    previousCursors: [],
    promise: loadCommsPage(serverApp, view),
  };
}

async function loadCommsPage(
  serverApp: HexclaveServerApp<false>,
  view: View,
  cursor?: string,
): Promise<LoadState> {
  try {
    if (view === "contacts") {
      const contacts = await serverApp.listContacts({ cursor, limit: 100, includeMerged: true });
      return { status: "ok", contacts, conversations: [], messages: [], nextCursor: contacts.nextCursor };
    }
    if (view === "conversations") {
      const conversations = await serverApp.listCommsConversations({ cursor, limit: 100, includeMerged: true });
      return { status: "ok", contacts: [], conversations, messages: [], nextCursor: conversations.nextCursor };
    }
    const messages = await serverApp.listCommsMessages({ cursor, limit: 100 });
    return { status: "ok", contacts: [], conversations: [], messages, nextCursor: messages.nextCursor };
  } catch (error) {
    captureError("comms-alpha-load", error);
    return {
      status: "error",
      contacts: [],
      conversations: [],
      messages: [],
      nextCursor: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function withoutClientSorting<TRow>(columns: DataGridColumnDef<TRow>[]): DataGridColumnDef<TRow>[] {
  return columns.map((column) => ({ ...column, sortable: false }));
}

const contactColumns = withoutClientSorting<ServerContact>([
  { id: "displayName", header: "Display name", accessor: "displayName", width: 220 },
  { id: "id", header: "Contact ID", accessor: "id", width: 260 },
  {
    id: "kind",
    header: "Kind",
    width: 100,
    renderCell: ({ row }) => <DesignBadge label={row.isUserBacked ? "User" : "CRM"} color={row.isUserBacked ? "blue" : "purple"} size="sm" />,
  },
  {
    id: "channels",
    header: "Channels",
    width: 240,
    renderCell: ({ row }) => row.contactChannels.map((channel) => `${channel.type}:${channel.displayValue}`).join(", "),
  },
  {
    id: "merged",
    header: "State",
    width: 110,
    renderCell: ({ row }) => <DesignBadge label={row.mergedIntoContactId == null ? "Canonical" : "Merged"} color={row.mergedIntoContactId == null ? "green" : "orange"} size="sm" />,
  },
  { id: "updatedAt", header: "Updated", width: 180, renderCell: ({ row }) => row.updatedAt.toLocaleString() },
]);

const conversationColumns = withoutClientSorting<ServerCommsConversation>([
  { id: "title", header: "Title", accessor: "title", width: 260 },
  { id: "id", header: "Conversation ID", accessor: "id", width: 260 },
  {
    id: "state",
    header: "State",
    width: 110,
    renderCell: ({ row }) => <DesignBadge label={row.mergedIntoConversationId == null ? "Canonical" : "Merged"} color={row.mergedIntoConversationId == null ? "green" : "orange"} size="sm" />,
  },
  { id: "firstMessageAt", header: "First message", width: 180, renderCell: ({ row }) => row.firstMessageAt?.toLocaleString() ?? "—" },
  { id: "lastMessageAt", header: "Last message", width: 180, renderCell: ({ row }) => row.lastMessageAt?.toLocaleString() ?? "—" },
  { id: "updatedAt", header: "Updated", width: 180, renderCell: ({ row }) => row.updatedAt.toLocaleString() },
]);

const messageColumns = withoutClientSorting<ServerCommsMessage>([
  { id: "occurredAt", header: "Occurred", width: 180, renderCell: ({ row }) => row.occurredAt.toLocaleString() },
  {
    id: "direction",
    header: "Direction",
    width: 110,
    renderCell: ({ row }) => <DesignBadge label={row.direction} color={row.direction === "inbound" ? "cyan" : "blue"} size="sm" />,
  },
  { id: "type", header: "Type", width: 100, renderCell: ({ row }) => row.payload.type },
  { id: "adapterKey", header: "Adapter", accessor: "adapterKey", width: 180 },
  { id: "id", header: "Message ID", accessor: "id", width: 260 },
  { id: "conversationId", header: "Conversation ID", accessor: "conversationId", width: 260 },
  {
    id: "participants",
    header: "Participants",
    width: 300,
    renderCell: ({ row }) => row.participants.map((participant) => `${participant.role}:${participant.addressSnapshot}`).join(", "),
  },
]);

const channelCreateSchema = yupUnion(
  yupObject({ type: yupString().oneOf(["email"]).defined(), value: yupString().defined(), isPrimary: yupBoolean().optional(), isVerified: yupBoolean().optional(), metadata: jsonSchema.optional() }).defined(),
  yupObject({ type: yupString().oneOf(["phone"]).defined(), value: yupString().defined(), extension: yupString().nullable().optional(), isPrimary: yupBoolean().optional(), isVerified: yupBoolean().optional(), metadata: jsonSchema.optional() }).defined(),
  yupObject({ type: yupString().oneOf(["discord"]).defined(), value: yupString().defined(), isPrimary: yupBoolean().optional(), isVerified: yupBoolean().optional(), metadata: jsonSchema.optional() }).defined(),
  yupObject({ type: yupString().oneOf(["slack"]).defined(), value: yupString().defined(), workspaceId: yupString().defined(), isPrimary: yupBoolean().optional(), isVerified: yupBoolean().optional(), metadata: jsonSchema.optional() }).defined(),
  yupObject({ type: yupString().oneOf(["push"]).defined(), value: yupString().defined(), provider: yupString().oneOf(["apns", "fcm"]).defined(), appId: yupString().defined(), environment: yupString().oneOf(["development", "production"]).defined(), isPrimary: yupBoolean().optional(), isVerified: yupBoolean().optional(), metadata: jsonSchema.optional() }).defined(),
).defined();

const contactCreateSchema = yupObject({
  displayName: yupString().nullable().optional(),
  profileImageUrl: yupString().nullable().optional(),
  clientMetadata: jsonSchema.optional(),
  clientReadOnlyMetadata: jsonSchema.optional(),
  serverMetadata: jsonSchema.optional(),
  contactChannels: yupArray(channelCreateSchema).optional(),
}).defined();

const contactUpdateSchema = contactCreateSchema.omit(["contactChannels"]);
const mergeSchema = yupObject({
  targetId: yupString().uuid().defined(),
  idempotencyKey: yupString().min(1).defined(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();
const channelMutationSchema = yupObject({
  channelId: yupString().uuid().defined(),
  isPrimary: yupBoolean().optional(),
  isVerified: yupBoolean().optional(),
  metadata: jsonSchema.optional(),
  extension: yupString().nullable().optional(),
}).defined();
const idSchema = yupObject({ id: yupString().uuid().defined() }).defined();
const conversationTitleSchema = yupObject({ title: yupString().nullable().optional() }).defined();
const messageIdsSchema = yupObject({
  messageIds: yupArray(yupString().uuid().defined()).min(1).defined(),
  idempotencyKey: yupString().min(1).defined(),
  title: yupString().nullable().optional(),
  reason: yupString().nullable().optional(),
  metadata: jsonSchema.optional(),
}).defined();

const emailPayloadSchema = yupObject({
  type: yupString().oneOf(["email"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  subject: yupString().nullable().defined(),
  textBody: yupString().nullable().defined(),
  htmlBody: yupString().nullable().defined(),
  ampHtmlBody: yupString().nullable().defined(),
  headers: yupArray(yupObject({ name: yupString().defined(), value: yupString().defined() }).defined()).defined(),
}).defined();
const slackPayloadSchema = yupObject({
  type: yupString().oneOf(["slack"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  text: yupString().defined(),
  blocks: jsonSchema.defined(),
  workspaceId: yupString().defined(),
  channelId: yupString().defined(),
  threadId: yupString().nullable().defined(),
}).defined();
const discordPayloadSchema = yupObject({
  type: yupString().oneOf(["discord"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  content: yupString().defined(),
  embeds: yupArray(jsonSchema.nonNullable().defined()).defined(),
  guildId: yupString().nullable().defined(),
  channelId: yupString().defined(),
  threadId: yupString().nullable().defined(),
}).defined();
const pushPayloadSchema = yupObject({
  type: yupString().oneOf(["push"]).defined(),
  version: yupNumber().oneOf([1]).defined(),
  title: yupString().nullable().defined(),
  body: yupString().defined(),
  data: jsonSchema.defined(),
}).defined();
const messageCreateSchema = yupObject({
  direction: yupString().oneOf(["inbound", "outbound"]).defined(),
  adapterKey: yupString().defined(),
  externalMessageId: yupString().nullable().optional(),
  externalThreadId: yupString().nullable().optional(),
  replyToMessageId: yupString().uuid().nullable().optional(),
  occurredAt: yupString().defined(),
  payload: yupUnion(emailPayloadSchema, slackPayloadSchema, discordPayloadSchema, pushPayloadSchema).defined(),
  participants: yupArray(yupObject({
    role: yupString().oneOf(["author", "from", "sender", "to", "cc", "bcc", "reply-to", "envelope-from", "envelope-to", "audience"]).defined(),
    position: yupNumber().integer().min(0).optional(),
    contactId: yupString().uuid().nullable().optional(),
    contactChannelId: yupString().uuid().nullable().optional(),
    contactChannel: channelCreateSchema.optional(),
    addressSnapshot: yupString().optional(),
    displayNameSnapshot: yupString().nullable().optional(),
  }).defined()).min(1).defined(),
  conversationId: yupString().uuid().nullable().optional(),
}).defined();

const deliveryCreateSchema = yupObject({
  addressSnapshot: yupString().defined(),
  participantId: yupString().uuid().nullable().optional(),
  status: yupString().oneOf(["pending", "queued", "sending", "sent", "delivered", "delayed", "bounced", "failed", "skipped"]).optional(),
}).defined();
const deliveryUpdateSchema = yupObject({
  deliveryId: yupString().uuid().defined(),
  status: yupString().oneOf(["pending", "queued", "sending", "sent", "delivered", "delayed", "bounced", "failed", "skipped"]).defined(),
  providerMessageId: yupString().nullable().optional(),
  skippedReason: yupString().nullable().optional(),
  lastErrorPublic: yupString().nullable().optional(),
  lastErrorInternal: yupString().nullable().optional(),
}).defined();
const attemptSchema = yupObject({
  deliveryId: yupString().uuid().defined(),
  outcome: yupString().oneOf(["success", "failure", "deferred"]).defined(),
  providerResponse: jsonSchema.optional(),
  errorPublic: yupString().nullable().optional(),
  errorInternal: yupString().nullable().optional(),
  finishedAt: yupString().nullable().optional(),
  status: yupString().oneOf(["pending", "queued", "sending", "sent", "delivered", "delayed", "bounced", "failed", "skipped"]).optional(),
  providerMessageId: yupString().nullable().optional(),
}).defined();

async function parseMessageCreateOptions(parsed: unknown): Promise<ServerCommsMessageCreateOptions> {
  const data = await messageCreateSchema.validate(parsed);
  const occurredAt = new Date(data.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error("occurredAt must be a valid ISO timestamp");
  const version: 1 = 1;

  const payload = data.payload.type === "email"
    ? { ...data.payload, version }
    : data.payload.type === "slack"
      ? { ...data.payload, version }
      : data.payload.type === "discord"
        ? { ...data.payload, version }
        : { ...data.payload, version };

  return { ...data, occurredAt, payload };
}

type Operation =
  | "create-contact" | "update-contact" | "merge-contact" | "delete-contact"
  | "create-channel" | "update-channel" | "delete-channel"
  | "create-conversation" | "update-conversation" | "merge-conversation" | "split-conversation" | "reassign-messages"
  | "create-message" | "create-delivery" | "update-delivery" | "record-attempt";

type OperationSpec = {
  operation: Operation,
  title: string,
  description: string,
  initialJson: string,
  confirmationText?: string,
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function operationSpec(operation: Operation, selected: ServerContact | ServerCommsConversation | ServerCommsMessage | null): OperationSpec {
  const randomKey = `dashboard-${crypto.randomUUID()}`;
  if (operation === "create-contact") return { operation, title: "Create contact", description: "Create a standalone contact and optional channels.", initialJson: prettyJson({ displayName: "Ada Lovelace", contactChannels: [{ type: "email", value: "ada@example.com", isPrimary: true }] }) };
  if (operation === "update-contact") return { operation, title: "Update contact", description: "Patch mutable profile fields on the selected contact.", initialJson: prettyJson({ displayName: selected instanceof Object && "displayName" in selected ? selected.displayName : null }) };
  if (operation === "merge-contact") return { operation, title: "Merge contact", description: "Merge the selected source into a canonical target.", initialJson: prettyJson({ targetId: "", idempotencyKey: randomKey, reason: "dashboard merge" }), confirmationText: selected?.id ?? throwErr("Merge contact requires a selected contact") };
  if (operation === "delete-contact") return { operation, title: "Delete contact", description: "Delete the selected non-user-backed contact.", initialJson: "{}", confirmationText: selected?.id ?? throwErr("Delete contact requires a selected contact") };
  if (operation === "create-channel") return { operation, title: "Create contact channel", description: "Attach a channel identity to the selected contact.", initialJson: prettyJson({ type: "email", value: "person@example.com", isPrimary: false }) };
  if (operation === "update-channel") return { operation, title: "Update contact channel", description: "Update channel verification, primary state, metadata, or phone extension.", initialJson: prettyJson({ channelId: "", isPrimary: true }) };
  if (operation === "delete-channel") return { operation, title: "Delete contact channel", description: "Delete a channel from the selected contact.", initialJson: prettyJson({ id: "" }), confirmationText: "DELETE" };
  if (operation === "create-conversation") return { operation, title: "Create conversation", description: "Create an empty conversation.", initialJson: prettyJson({ title: "New conversation" }) };
  if (operation === "update-conversation") return { operation, title: "Update conversation", description: "Update the selected conversation title.", initialJson: prettyJson({ title: selected instanceof Object && "title" in selected ? selected.title : null }) };
  if (operation === "merge-conversation") return { operation, title: "Merge conversation", description: "Merge the selected source into a canonical target.", initialJson: prettyJson({ targetId: "", idempotencyKey: randomKey, reason: "dashboard merge" }), confirmationText: selected?.id ?? throwErr("Merge conversation requires a selected conversation") };
  if (operation === "split-conversation") return { operation, title: "Split conversation", description: "Move selected messages into a newly created conversation.", initialJson: prettyJson({ messageIds: [], idempotencyKey: randomKey, title: "Split conversation", reason: "dashboard split" }), confirmationText: selected?.id ?? throwErr("Split conversation requires a selected conversation") };
  if (operation === "reassign-messages") return { operation, title: "Reassign messages", description: "Move messages from any source into the selected target conversation.", initialJson: prettyJson({ messageIds: [], idempotencyKey: randomKey, reason: "dashboard reassign" }), confirmationText: selected?.id ?? throwErr("Reassign messages requires a selected conversation") };
  if (operation === "create-message") return { operation, title: "Ingest message", description: "Create an immutable channel-agnostic message.", initialJson: prettyJson({ direction: "inbound", adapterKey: "dashboard:manual", externalMessageId: crypto.randomUUID(), occurredAt: new Date().toISOString(), payload: { type: "email", version: 1, subject: "Manual message", textBody: "Message body", htmlBody: null, ampHtmlBody: null, headers: [] }, participants: [{ role: "from", addressSnapshot: "person@example.com" }] }) };
  if (operation === "create-delivery") return { operation, title: "Create delivery", description: "Create a per-recipient delivery for the selected message.", initialJson: prettyJson({ addressSnapshot: "person@example.com", status: "pending" }) };
  if (operation === "update-delivery") return { operation, title: "Update delivery", description: "Advance delivery state and provider metadata.", initialJson: prettyJson({ deliveryId: "", status: "sent", providerMessageId: null }) };
  return { operation, title: "Record delivery attempt", description: "Append an immutable provider delivery attempt.", initialJson: prettyJson({ deliveryId: "", outcome: "success", finishedAt: new Date().toISOString(), status: "sent" }) };
}

function operationOptions(view: View, selected: ServerContact | ServerCommsConversation | ServerCommsMessage | null): Array<{ value: Operation, label: string }> {
  if (view === "contacts") {
    return [
      { value: "create-contact", label: "Create contact" },
      ...(selected == null ? [] : [
        { value: "update-contact" as const, label: "Update selected contact" },
        { value: "merge-contact" as const, label: "Merge selected contact" },
        { value: "delete-contact" as const, label: "Delete selected contact" },
        { value: "create-channel" as const, label: "Create channel on selected contact" },
        { value: "update-channel" as const, label: "Update channel on selected contact" },
        { value: "delete-channel" as const, label: "Delete channel on selected contact" },
      ]),
    ];
  }
  if (view === "conversations") {
    return [
      { value: "create-conversation", label: "Create conversation" },
      ...(selected == null ? [] : [
        { value: "update-conversation" as const, label: "Update selected conversation" },
        { value: "merge-conversation" as const, label: "Merge selected conversation" },
        { value: "split-conversation" as const, label: "Split selected conversation" },
        { value: "reassign-messages" as const, label: "Reassign messages into selected conversation" },
      ]),
    ];
  }
  return [
    { value: "create-message", label: "Ingest message" },
    ...(selected != null && "payload" in selected && selected.direction === "outbound"
      ? [{ value: "create-delivery" as const, label: "Create delivery for selected message" }]
      : []),
    { value: "update-delivery", label: "Update delivery by ID" },
    { value: "record-attempt", label: "Record attempt by delivery ID" },
  ];
}

function JsonOperationDialog(props: {
  spec: OperationSpec,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSubmit: (operation: Operation, json: string) => Promise<void>,
}) {
  const [json, setJson] = useState(props.spec.initialJson);
  const [confirmation, setConfirmation] = useState("");
  const confirmationMatches = props.spec.confirmationText == null
    || confirmation === props.spec.confirmationText;
  return (
    <DesignDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="3xl"
      icon={WrenchIcon}
      title={props.spec.title}
      description={props.spec.description}
      footer={(
        <DesignButton
          size="sm"
          disabled={!confirmationMatches}
          onClick={async () => {
            await props.onSubmit(props.spec.operation, json);
            props.onOpenChange(false);
          }}
        >
          Run operation
        </DesignButton>
      )}
    >
      <Textarea
        value={json}
        onChange={(event) => setJson(event.target.value)}
        className="min-h-[360px] font-mono text-xs"
        spellCheck={false}
      />
      {props.spec.confirmationText != null && (
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-sm font-medium">
            Type <code>{props.spec.confirmationText}</code> to confirm this irreversible operation.
          </label>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="h-9 rounded-md border bg-background px-3 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}
    </DesignDialog>
  );
}

async function loadDeliveries(message: ServerCommsMessage): Promise<
  { status: "ok", deliveries: ServerCommsDelivery[] } | { status: "error", error: string }
> {
  try {
    return { status: "ok", deliveries: await message.listDeliveries() };
  } catch (error) {
    captureError("comms-alpha-deliveries-load", error);
    return { status: "error", error: error instanceof Error ? error.message : "Unknown error" };
  }
}

const deliveryPromises = new WeakMap<ServerCommsMessage, ReturnType<typeof loadDeliveries>>();

function MessageEntityDetails(props: { message: ServerCommsMessage }) {
  let promise = deliveryPromises.get(props.message);
  if (promise == null) {
    promise = loadDeliveries(props.message);
    deliveryPromises.set(props.message, promise);
  }
  const deliveryState = use(promise);
  const { listDeliveries: _list, createDelivery: _create, ...message } = props.message;
  return (
    <DesignCard title="Selected object" subtitle="SDK-camelCase projection" icon={IdentificationCardIcon} contentClassName="!p-0">
      {deliveryState.status === "error" ? (
        <div className="p-4">
          <DesignAlert variant="error" title="Could not load deliveries" description={deliveryState.error} />
        </div>
      ) : (
        <pre className="max-h-[560px] overflow-auto p-4 font-mono text-[11px] leading-relaxed">
          {prettyJson({ ...message, deliveries: deliveryState.deliveries })}
        </pre>
      )}
    </DesignCard>
  );
}

function EntityDetails(props: {
  selected: ServerContact | ServerCommsConversation | ServerCommsMessage | null,
}) {
  if (props.selected == null) {
    return (
      <DesignCard title="Selected object" subtitle="SDK-camelCase projection" icon={IdentificationCardIcon}>
        <DesignAlert
          variant="info"
          title="Select a row"
          description="Object fields, nested resources, and contextual operations appear here."
        />
      </DesignCard>
    );
  }
  if ("payload" in props.selected) return <MessageEntityDetails message={props.selected} />;
  const detail = (() => {
    if ("contactChannels" in props.selected) {
      const { update: _update, delete: _delete, mergeInto: _merge, listContactChannels: _list, createContactChannel: _create, ...contact } = props.selected;
      return contact;
    }
    const { update: _update, mergeInto: _merge, split: _split, reassignMessages: _reassign, listMessages: _list, ...conversation } = props.selected;
    return conversation;
  })();
  return (
    <DesignCard title="Selected object" subtitle="SDK-camelCase projection" icon={IdentificationCardIcon} contentClassName="!p-0">
      <pre className="max-h-[560px] overflow-auto p-4 font-mono text-[11px] leading-relaxed">{prettyJson(detail)}</pre>
    </DesignCard>
  );
}

function PageClientContent(props: {
  view: View,
  serverApp: HexclaveServerApp<false>,
  pageRequest: PageRequest,
  setPageRequest: (request: PageRequest) => void,
}) {
  const view = props.view;
  const serverApp = props.serverApp;
  const pageRequest = props.pageRequest;
  const setPageRequest = props.setPageRequest;
  const state = use(pageRequest.promise);
  const [isPagePending, startPageTransition] = useTransition();
  const [selected, setSelected] = useState<ServerContact | ServerCommsConversation | ServerCommsMessage | null>(null);
  const [operation, setOperation] = useState<OperationSpec | null>(null);

  const rows = view === "contacts" ? state.contacts : view === "conversations" ? state.conversations : state.messages;
  const options = operationOptions(view, selected);

  const runOperation = async (kind: Operation, json: string) => {
    const parsed: unknown = JSON.parse(json);
    if (kind === "create-contact") await serverApp.createContact(await contactCreateSchema.validate(parsed));
    else if (kind === "update-contact") await requireContact(selected).update(await contactUpdateSchema.validate(parsed));
    else if (kind === "merge-contact") {
      const { targetId, ...options } = await mergeSchema.validate(parsed);
      await requireContact(selected).mergeInto({ ...options, targetContactId: targetId });
    }
    else if (kind === "delete-contact") await requireContact(selected).delete();
    else if (kind === "create-channel") await requireContact(selected).createContactChannel(await channelCreateSchema.validate(parsed));
    else if (kind === "update-channel") {
      const data = await channelMutationSchema.validate(parsed);
      const channel = requireContact(selected).contactChannels.find((candidate) => candidate.id === data.channelId)
        ?? throwErr(`Channel ${data.channelId} was not found on the selected contact`);
      await channel.update(data);
    } else if (kind === "delete-channel") {
      const data = await idSchema.validate(parsed);
      const channel = requireContact(selected).contactChannels.find((candidate) => candidate.id === data.id)
        ?? throwErr(`Channel ${data.id} was not found on the selected contact`);
      await channel.delete();
    } else if (kind === "create-conversation") await serverApp.createCommsConversation(await conversationTitleSchema.validate(parsed));
    else if (kind === "update-conversation") await requireConversation(selected).update(await conversationTitleSchema.validate(parsed));
    else if (kind === "merge-conversation") {
      const { targetId, ...options } = await mergeSchema.validate(parsed);
      await requireConversation(selected).mergeInto({ ...options, targetConversationId: targetId });
    }
    else if (kind === "split-conversation") await requireConversation(selected).split(await messageIdsSchema.validate(parsed));
    else if (kind === "reassign-messages") await requireConversation(selected).reassignMessages(await messageIdsSchema.omit(["title"]).validate(parsed));
    else if (kind === "create-message") {
      await serverApp.createCommsMessage(await parseMessageCreateOptions(parsed));
    } else if (kind === "create-delivery") await requireMessage(selected).createDelivery(await deliveryCreateSchema.validate(parsed));
    else if (kind === "update-delivery") {
      const { deliveryId, ...data } = await deliveryUpdateSchema.validate(parsed);
      const delivery = await serverApp.getCommsDelivery(deliveryId);
      await delivery.updateStatus(data);
    } else {
      const { deliveryId, finishedAt: finishedAtInput, ...data } = await attemptSchema.validate(parsed);
      const delivery = await serverApp.getCommsDelivery(deliveryId);
      const finishedAt = finishedAtInput == null ? finishedAtInput : new Date(finishedAtInput);
      if (finishedAt != null && Number.isNaN(finishedAt.getTime())) {
        throw new Error("finishedAt must be a valid ISO timestamp");
      }
      await delivery.recordAttempt({
        ...data,
        finishedAt,
      });
    }
    setSelected(null);
    startPageTransition(() => setPageRequest(createFirstPageRequest(serverApp, view)));
  };

  return (
    <PageLayout
      title={view === "contacts" ? "Comms contacts" : view === "conversations" ? "Comms conversations" : "Comms messages"}
      description="Internal alpha · dense access to communications primitives and audited operations"
      actions={(
        <div className="flex items-center gap-2">
          <DesignBadge label="Alpha · internal" color="purple" size="sm" />
          <DesignButton
            variant="secondary"
            size="sm"
            disabled={isPagePending}
            onClick={() => {
                setSelected(null);
                const nextPageRequest = {
                  ...pageRequest,
                  requestId: crypto.randomUUID(),
                  promise: loadCommsPage(serverApp, view, pageRequest.cursor),
                };
                startPageTransition(() => {
                  setPageRequest(nextPageRequest);
                });
            }}
          >
            <ArrowsClockwiseIcon className="mr-1.5 h-4 w-4" />
            Refresh
          </DesignButton>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <DesignAlert
          variant="info"
          title="Operator surface"
          description="Mutations call the project-scoped Server SDK directly. Operation dialogs use SDK-camelCase JSON and preserve idempotency and audit fields."
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DesignCard
            title={view === "contacts" ? "Contacts" : view === "conversations" ? "Conversations" : "Messages"}
            subtitle={`${rows.length} on this page · select a row for complete object data and contextual operations`}
            icon={view === "contacts" ? IdentificationCardIcon : view === "conversations" ? ChatCircleDotsIcon : PaperPlaneTiltIcon}
            contentClassName="!p-0"
            actions={(
              <div className="flex min-w-[360px] items-center justify-end gap-2">
                <DesignButton
                  variant="secondary"
                  size="sm"
                  disabled={isPagePending || pageRequest.previousCursors.length === 0}
                  onClick={() => {
                    const previousCursor = pageRequest.previousCursors.at(-1);
                    const nextPageRequest = {
                      requestId: crypto.randomUUID(),
                      cursor: previousCursor,
                      previousCursors: pageRequest.previousCursors.slice(0, -1),
                      promise: loadCommsPage(serverApp, view, previousCursor),
                    };
                      setSelected(null);
                      startPageTransition(() => {
                        setPageRequest(nextPageRequest);
                      });
                  }}
                >
                  Previous
                </DesignButton>
                <DesignButton
                  variant="secondary"
                  size="sm"
                  disabled={isPagePending || state.nextCursor == null}
                  onClick={() => {
                    const nextCursor = state.nextCursor ?? throwErr("Next page was requested without a cursor");
                    const nextPageRequest = {
                      requestId: crypto.randomUUID(),
                      cursor: nextCursor,
                      previousCursors: [...pageRequest.previousCursors, pageRequest.cursor],
                      promise: loadCommsPage(serverApp, view, nextCursor),
                    };
                      setSelected(null);
                      startPageTransition(() => {
                        setPageRequest(nextPageRequest);
                      });
                  }}
                >
                  Next
                </DesignButton>
                <DesignSelectorDropdown
                  value=""
                  placeholder="Run operation…"
                  options={options}
                  onValueChange={(value) => {
                    const option = options.find((candidate) => candidate.value === value)
                        ?? throwErr(`Unknown Comms operation ${value}`);
                      setOperation(operationSpec(option.value, selected));
                  }}
                  size="sm"
                />
                <DesignButton size="sm" onClick={() => setOperation(operationSpec(options[0]?.value ?? throwErr("No Comms operations available"), selected))}>
                  <PlusIcon className="h-4 w-4" />
                </DesignButton>
              </div>
            )}
          >
            <div className={isPagePending ? "pointer-events-none opacity-60" : undefined}>
              {state.status === "error" ? (
                <div className="flex flex-col items-start gap-3 p-4">
                  <DesignAlert variant="error" title="Could not load Comms data" description={state.error} />
                  <DesignButton
                    variant="secondary"
                    size="sm"
                    disabled={isPagePending}
                    onClick={() => {
                      const nextPageRequest = {
                        ...pageRequest,
                        requestId: crypto.randomUUID(),
                        promise: loadCommsPage(serverApp, view, pageRequest.cursor),
                      };
                      startPageTransition(() => {
                        setPageRequest(nextPageRequest);
                      });
                    }}
                  >
                    Retry
                  </DesignButton>
                </div>
              ) : view === "contacts" ? (
                <ContactGrid key={pageRequest.requestId} rows={state.contacts} onSelect={setSelected} />
              ) : view === "conversations" ? (
                <ConversationGrid key={pageRequest.requestId} rows={state.conversations} onSelect={setSelected} />
              ) : (
                <MessageGrid key={pageRequest.requestId} rows={state.messages} onSelect={setSelected} />
              )}
            </div>
          </DesignCard>

          <Suspense fallback={<div className="flex justify-center p-8"><Spinner className="h-5 w-5" /></div>}>
            <EntityDetails selected={selected} />
          </Suspense>
        </div>
      </div>

      {operation != null && (
        <JsonOperationDialog
          key={operation.operation}
          spec={operation}
          open
          onOpenChange={(open) => {
            if (!open) setOperation(null);
          }}
          onSubmit={runOperation}
        />
      )}
    </PageLayout>
  );
}

function PageClientLoader(props: { initialView?: View }) {
  const serverApp = useServerApp();
  const view = props.initialView ?? "messages";
  // This state must live above the boundary: state created by a component that
  // suspends before its first commit is discarded, which would recreate the
  // request promise and leave the page in an infinite Suspense retry loop.
  const [pageRequest, setPageRequest] = useState<PageRequest>(() => createFirstPageRequest(serverApp, view));
  return (
    <Suspense fallback={<div className="flex min-h-[480px] items-center justify-center"><Spinner className="h-5 w-5" /></div>}>
      <PageClientContent
        view={view}
        serverApp={serverApp}
        pageRequest={pageRequest}
        setPageRequest={setPageRequest}
      />
    </Suspense>
  );
}

export default function PageClient(props: { initialView?: View }) {
  return (
    <AppEnabledGuard appId="comms">
      <PageClientLoader initialView={props.initialView} />
    </AppEnabledGuard>
  );
}

function ContactGrid(props: { rows: ServerContact[], onSelect: (row: ServerContact) => void }) {
  const [state, setState] = useState(() => createDefaultDataGridState(contactColumns));
  return <DataGrid columns={contactColumns} rows={props.rows} getRowId={(row) => row.id} totalRowCount={props.rows.length} state={state} onChange={setState} paginationMode="infinite" selectionMode="single" toolbar={false} footer={false} maxHeight="calc(100dvh - 330px)" onRowClick={props.onSelect} exportFilename="comms-contacts" />;
}

function ConversationGrid(props: { rows: ServerCommsConversation[], onSelect: (row: ServerCommsConversation) => void }) {
  const [state, setState] = useState(() => createDefaultDataGridState(conversationColumns));
  return <DataGrid columns={conversationColumns} rows={props.rows} getRowId={(row) => row.id} totalRowCount={props.rows.length} state={state} onChange={setState} paginationMode="infinite" selectionMode="single" toolbar={false} footer={false} maxHeight="calc(100dvh - 330px)" onRowClick={props.onSelect} exportFilename="comms-conversations" />;
}

function MessageGrid(props: { rows: ServerCommsMessage[], onSelect: (row: ServerCommsMessage) => void }) {
  const [state, setState] = useState(() => createDefaultDataGridState(messageColumns));
  return <DataGrid columns={messageColumns} rows={props.rows} getRowId={(row) => row.id} totalRowCount={props.rows.length} state={state} onChange={setState} paginationMode="infinite" selectionMode="single" toolbar={false} footer={false} maxHeight="calc(100dvh - 330px)" onRowClick={props.onSelect} exportFilename="comms-messages" />;
}

function requireContact(value: ServerContact | ServerCommsConversation | ServerCommsMessage | null): ServerContact {
  if (value == null || !("contactChannels" in value)) throw new Error("Select a contact before running this operation");
  return value;
}

function requireConversation(value: ServerContact | ServerCommsConversation | ServerCommsMessage | null): ServerCommsConversation {
  if (value == null || !("listMessages" in value)) throw new Error("Select a conversation before running this operation");
  return value;
}

function requireMessage(value: ServerContact | ServerCommsConversation | ServerCommsMessage | null): ServerCommsMessage {
  if (value == null || !("payload" in value)) throw new Error("Select a message before running this operation");
  return value;
}
