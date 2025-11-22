# Email Infrastructure Overview

This folder contains the HTTP endpoints that sit on top of the new email outbox
pipeline. The pipeline is intentionally asynchronous: instead of sending mail
inside request handlers we persist work items to the `EmailOutbox` table and let
background workers render, queue, and deliver them.

## Execution Flow

1. **Enqueue** – API endpoints (and server-side helpers) call
   `sendEmailToAll` to persist one row per recipient. Each entry
   captures the template source, render variables, target recipient, priority,
   and scheduling metadata. We enqueue the QStash worker so the
   pipeline continues in the background without blocking the caller.
2. **Render** – `runEmailQueueStep` acquires an advisory lock and atomically
   claims rows that have not been rendered. Emails are rendered in tenancy
   batches via Freestyle, producing HTML/Text/Subject snapshots while capturing
   render errors in structured fields.
3. **Queue** – Rendered rows whose `scheduled_at` is in the past are marked as
   ready (`isQueued = true`). Capacity is calculated per tenancy based on recent
   delivery performance to decide how many emails can be handed off to the
   sender during this iteration.
4. **Send** – Claimed rows are processed in parallel. Before delivery we fetch
   the latest user data, honour notification preferences and skip users who have
   unsubscribed or deleted their account. Provider responses are captured in the
   `sendServerError*` fields so the dashboard can surface actionable feedback.
5. **Delivery Stats** – The worker updates `EmailOutboxProcessingMetadata` so we
   can derive execution deltas and expose aggregated metrics via the
   `/emails/delivery-info` endpoint.

## Key Tables

- `EmailOutbox` – Durable queue of emails with full status history and audit
  data. Constraints ensure mutually exclusive sets of render/send error fields
  and guard against race conditions.
- `EmailOutboxProcessingMetadata` – Stores the last worker execution timestamp
  so we can compute accurate capacity budgets each run.

## Mutable vs. Immutable States

Emails can only be edited, paused, retried, or deleted **before** `startedSendingAt` is set.
Once sending begins, the entry becomes read-only. Retrying an email effectively resets its
place in the pipeline & queue, see the Prisma schema for more details.
