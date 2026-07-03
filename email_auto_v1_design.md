# Quota Email Automation V1 Design

## Goal

Hexclave clients should be able to automate upgrade-oriented emails to their own product end users when those users are near or over Hexclave Payments item balances.

V1 deliberately uses Hexclave-native Payments items, products, subscriptions, users, and the existing email outbox pipeline. It must not read arbitrary client product databases.

## Confirmed Architecture Decision

Persist automation configuration under a generic `automations.rules` namespace.

Surface the V1 UI under:

```txt
Emails -> Automations / Usage Emails
```

Do not build a full Automations product surface yet.

V1 supports only:

- `source.type = "payments-item-quota"`
- `action.type = "send-email"`
- `source.customerType = "user"`

This separates the feature's product location from its data source:

- Payments owns products, subscriptions, item definitions, and balances.
- Emails owns templates, themes, notification categories, outbox, unsubscribe, and delivery.
- Automations owns rules, thresholds, cooldowns, dry-runs, scheduling, and idempotency.

## Relevant Existing Systems

Payments customer-data readers already expose current customer state:

- `apps/backend/src/lib/payments/customer-data.ts`
  - `getOwnedProductsForCustomer`
  - `getItemQuantitiesForCustomer`
  - `getItemQuantityForCustomer`
  - `getSubscriptionMapForCustomer`

Payments item APIs already validate item/customer relationships:

- `apps/backend/src/app/api/latest/payments/items/[customer_type]/[customer_id]/[item_id]/route.ts`
- `apps/backend/src/app/api/latest/payments/items/[customer_type]/[customer_id]/[item_id]/update-quantity/route.ts`

Payments config already defines products, product lines, and items:

- `packages/shared/src/config/schema.ts`
- `packages/shared/src/schema-fields.ts`

Email infrastructure already supports durable async sending:

- `apps/backend/src/lib/emails.tsx`
- `apps/backend/src/lib/email-queue-step.tsx`
- `apps/backend/src/app/api/latest/emails/README.md`
- `apps/backend/prisma/schema.prisma` `EmailOutbox`

Background work patterns already exist:

- Simple cron route: `apps/backend/src/app/api/latest/internal/email-queue-step/route.tsx`
- Per-tenancy queued work: `apps/backend/src/lib/external-db-sync-queue.ts`
- Queue table: `apps/backend/prisma/schema.prisma` `OutgoingRequest`

## 1. Config Schema

Add a generic branch-level automation namespace:

```ts
automations: {
  rules: {
    [ruleId: string]: {
      displayName?: string,
      enabled: boolean,
      source: {
        type: "payments-item-quota",
        itemId: string,
        customerType: "user",
        thresholds: {
          nearRemainingRatio?: number,
          nearRemainingQuantity?: number,
          overLimitQuantity?: number,
        },
      },
      action: {
        type: "send-email",
        templateId: string,
        themeId?: string | null,
        subject?: string,
        notificationCategoryName?: "Marketing",
      },
      cooldown: {
        days: number,
      },
    }
  }
}
```

V1 constraints:

- Only `source.type: "payments-item-quota"`.
- Only `action.type: "send-email"`.
- Only `source.customerType: "user"`.
- `source.itemId` must use the same user-specified ID conventions as Payments item IDs.
- `nearRemainingRatio`, if present, should be greater than `0` and less than or equal to `1`.
- At least one of `nearRemainingRatio`, `nearRemainingQuantity`, or `overLimitQuantity` should be present.
- `overLimitQuantity` should default to `0` at evaluation time.
- `cooldown.days` should be a positive integer.
- V1 should default notification category to Marketing.

This should live beside other branch config schemas in `packages/shared/src/config/schema.ts`, with reusable source/action schema pieces placed in `packages/shared/src/schema-fields.ts` only if that keeps the config file readable.

Do not put canonical rule config under `payments.*` or `emails.*`.

## 2. Service And File Names

Use generic automation service names with a Payments quota source implementation.

Add:

```txt
apps/backend/src/lib/automations/rules.ts
apps/backend/src/lib/automations/rule-evaluator.ts
apps/backend/src/lib/automations/sources/payments-item-quota.ts
apps/backend/src/lib/automations/actions/send-email.ts
apps/backend/src/lib/automations/quota-email-automation.test.ts
```

Recommended responsibilities:

- `rules.ts`: config parsing, rule lookup, V1 rule type guards.
- `rule-evaluator.ts`: source/action dispatch, dry-run vs send orchestration.
- `sources/payments-item-quota.ts`: reads Payments data and emits quota trigger decisions.
- `actions/send-email.ts`: converts decisions into `sendEmailToMany` calls.
- Tests can start in one focused file, then split as the module grows.

Avoid naming the central service `payments/quota-email-automation.ts`; the Payments dependency should be isolated to the source adapter.

## 3. State Table / Model Name

Use a generic automation state model, not a Payments-specific state model.

Recommended Prisma model name:

```prisma
model AutomationRuleExecutionState {
  tenancyId String @db.Uuid

  ruleId String
  sourceType String
  actionType String

  subjectType String
  subjectId   String

  signalKey String
  lastTriggeredAt DateTime
  lastActionAt DateTime?
  lastEmailOutboxId String? @db.Uuid

  lastSourceSnapshot Json

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  tenancy Tenancy @relation(fields: [tenancyId], references: [id], onDelete: Cascade)

  @@id([tenancyId, ruleId, subjectType, subjectId, signalKey])
  @@index([tenancyId, ruleId, lastTriggeredAt])
}
```

For V1:

- `subjectType = "user"`
- `subjectId = projectUserId`
- `sourceType = "payments-item-quota"`
- `actionType = "send-email"`
- `signalKey = itemId + ":" + thresholdKind`
- `lastSourceSnapshot` contains current quantity, entitlement quantity, threshold kind, item ID, product IDs, and subscription IDs.

Dry-runs must not write this table.

## 4. Internal Dry-Run Route

Add:

```txt
apps/backend/src/app/api/latest/internal/automations/rules/[rule_id]/dry-run/route.ts
```

Request:

- admin/server internal auth initially
- `limit`
- `cursor`
- optional source debug filters, such as `customer_id`, only if useful for manual testing

Response:

```ts
{
  rule_id: string,
  mode: "dry-run",
  evaluated_count: number,
  eligible_count: number,
  suppressed_count: number,
  next_cursor: string | null,
  decisions: Array<{
    subject_type: "user",
    subject_id: string,
    source: {
      type: "payments-item-quota",
      item_id: string,
      current_quantity: number,
      entitlement_quantity: number | null,
      threshold_kind: "near" | "over",
      owned_product_ids: string[],
      active_subscription_ids: string[],
    },
    action: {
      type: "send-email",
      template_id: string,
      notification_category_name: "Marketing",
    },
    cooldown: {
      blocked: boolean,
      last_action_at_millis?: number,
      next_eligible_at_millis?: number,
    },
    recipient: {
      user_exists: boolean,
      has_primary_email: boolean,
    },
    skip_reason?: string,
  }>
}
```

The dry-run route must use the same evaluator path as real send mode, but must not enqueue outbox rows or write execution state.

## 5. Real-Send Route

Add:

```txt
apps/backend/src/app/api/latest/internal/automations/rules/[rule_id]/run/route.ts
```

Request:

- admin/server internal auth initially
- `limit`
- `cursor`
- optional `scheduled_at_millis`

Behavior:

1. Load tenancy and rule config.
2. Validate rule is a V1-supported source/action pair.
3. Evaluate candidates using the generic evaluator.
4. Claim/update `AutomationRuleExecutionState` for eligible decisions.
5. Enqueue emails with `sendEmailToMany`.
6. Store `lastEmailOutboxId` when possible, or store enough state to audit the action if batch create does not return IDs.

If exact outbox IDs are needed for audit, use individual creates or a raw insert with `RETURNING`. If V1 can tolerate not linking exact IDs, keep `lastEmailOutboxId` nullable and rely on `EmailOutbox.extraRenderVariables` carrying `automationRuleId`.

## 6. Evaluator Source / Action Separation

The evaluator should explicitly separate source adapters from action adapters.

Suggested shape:

```ts
type AutomationSourceDecision = {
  subject: {
    type: "user",
    id: string,
  },
  signal: {
    key: string,
    kind: "near" | "over",
  },
  sourceSnapshot: Record<string, Json>,
};

type AutomationActionPlan = {
  type: "send-email",
  recipient: { type: "user-primary-email", userId: string },
  templateId: string,
  variables: Record<string, Json>,
};
```

Flow:

```txt
rule config
  -> source adapter evaluates source-specific data
  -> generic evaluator applies cooldown/idempotency
  -> action adapter builds side-effect plan
  -> dry-run returns plan
  -> real run executes plan and writes state
```

For V1, there is one source adapter and one action adapter:

```txt
payments-item-quota -> send-email
```

This keeps V1 small without baking Payments into the automation framework.

## 7. Payments Item Quota Source

Source adapter:

```txt
apps/backend/src/lib/automations/sources/payments-item-quota.ts
```

For each candidate user:

1. Validate `tenancy.config.payments.items[itemId]` exists.
2. Validate item customer type is `"user"`.
3. Read current item balance with `getItemQuantityForCustomer`.
4. Read owned products with `getOwnedProductsForCustomer`.
5. Read subscriptions with `getSubscriptionMapForCustomer`.
6. Compute entitlement context from owned product snapshots:

```ts
ownedProduct.product.includedItems[itemId]?.quantity
```

Threshold evaluation:

1. `over`: `currentQuantity <= overLimitQuantity`, default `0`
2. `near`: not over, and either:
   - `currentQuantity <= nearRemainingQuantity`
   - `currentQuantity / entitlementQuantity <= nearRemainingRatio`

If `entitlementQuantity` is missing or `0`, only absolute quantity thresholds apply.

Candidate selection:

- V1 dry-run may page through `ProjectUser`.
- Scheduled/real sends should prefer bounded candidates from recent `ItemQuantityChange` rows for configured item IDs, with later catch-up scanning if needed.

## 8. Email Outbox Integration

Action adapter:

```txt
apps/backend/src/lib/automations/actions/send-email.ts
```

Use `sendEmailToMany` from `apps/backend/src/lib/emails.tsx`.

Recipient:

```ts
{ type: "user-primary-email", userId: subject.id }
```

Do not store or snapshot email addresses in automation state.

Set:

- `createdWith: { type: "programmatic-call", templateId }`
- `overrideNotificationCategoryId` for Marketing
- `shouldSkipDeliverabilityCheck: false`
- `isHighPriority: false`
- `scheduledAt` from route input or `now`

Extra render variables should include:

```ts
{
  automationRuleId,
  sourceType: "payments-item-quota",
  itemId,
  itemDisplayName,
  currentQuantity,
  entitlementQuantity,
  thresholdKind,
  ownedProductIds,
  activeSubscriptionIds,
  projectDisplayName,
}
```

The email worker should remain responsible for:

- resolving the latest primary email,
- skipping deleted users,
- skipping users without primary email,
- honoring unsubscribe preferences,
- delivery retries and failures.

## 9. UI Placement

V1 UI should live under the Emails app navigation:

```txt
Emails -> Automations
```

or:

```txt
Emails -> Usage Emails
```

The UI edits `automations.rules`, not `emails.*`.

Do not add a full Automations app to the app store or sidebar in V1. A future Automations app can reuse the same config namespace and backend services.

The Emails UI should make the Payments source visible in the rule editor:

```txt
Trigger: Payments item quota
Item: API credits
When: remaining balance <= 10 or <= 20%
Send: Upgrade email template
```

## 10. Tests

Config/schema tests:

- accepts a valid `automations.rules.*` V1 rule.
- rejects unsupported `source.type`.
- rejects unsupported `action.type`.
- rejects unsupported `source.customerType`.
- rejects invalid thresholds.
- rejects invalid cooldown.
- confirms rule config does not live under `payments.*` or `emails.*`.

Source adapter tests:

- item not found produces a skip/error decision.
- item customer type mismatch is rejected.
- detects near threshold by absolute remaining quantity.
- detects near threshold by ratio.
- detects over threshold.
- over wins over near.
- ratio threshold is ignored when entitlement quantity is missing or zero.
- source snapshot includes item, quantity, products, and subscriptions.

Generic evaluator tests:

- dry-run writes no `AutomationRuleExecutionState`.
- real run writes state.
- cooldown suppresses repeated same signal.
- over signal can send after near signal.
- cooldown expires after configured days.
- unsupported source/action pairs fail loud.

Email action tests:

- builds `user-primary-email` recipient.
- uses configured template ID and optional theme/subject.
- applies Marketing notification category.
- includes source snapshot variables.
- does not snapshot recipient email address.

Route tests:

- dry-run route returns decisions and writes nothing.
- run route requires privileged auth.
- run route enqueues EmailOutbox rows.
- pagination does not duplicate sends.

Safety tests:

- deleted users are skipped or safely handled.
- users without primary email are reported in dry-run and safely skipped by the email worker.
- no arbitrary database connection/config is read.

## 11. Commit Plan

Keep V1 small and reviewable:

1. Add `automations.rules` config schema and schema tests.
2. Add `AutomationRuleExecutionState` Prisma model and migration tests.
3. Add generic evaluator skeleton with V1-only source/action dispatch.
4. Add `payments-item-quota` source adapter and tests.
5. Add `send-email` action adapter and tests.
6. Add internal dry-run route and route tests.
7. Add real-send route, state writes, EmailOutbox enqueue integration, and tests.
8. Add Emails -> Automations / Usage Emails dashboard page that edits `automations.rules`.
9. Add scheduled/queued worker only after manual dry-run and manual send paths are stable.

## 12. Non-Goals For V1

- No arbitrary client DB reads.
- No generic SQL/query builder.
- No non-Payments sources.
- No non-email actions.
- No team/custom customer recipients.
- No full Automations product surface.
- No public SDK API until internal behavior is proven.

