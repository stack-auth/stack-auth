import * as stripeLib from "@/lib/stripe";
import * as tenancies from "@/lib/tenancies";
import * as prismaMod from "@/prisma-client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processStripeWebhookEvent } from "./route";

vi.mock("@/lib/stripe");
vi.mock("@/lib/tenancies");
vi.mock("@/prisma-client");

describe("processStripeWebhookEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });


  it("syncs subscriptions for invoice.paid", async () => {
    const syncStripeSubscriptions = vi.fn();
    (stripeLib as any).syncStripeSubscriptions = syncStripeSubscriptions;
    const evt = { type: "invoice.paid", account: "acct_1", data: { object: { customer: "cus_1" } } } as any;
    await processStripeWebhookEvent(evt as Stripe.Event);
    expect(syncStripeSubscriptions).toHaveBeenCalledWith("acct_1", "cus_1");
  });

  it("grants items for ONE_TIME payment_intent.succeeded", async () => {
    (stripeLib as any).getStackStripe = vi.fn(() => ({ accounts: { retrieve: vi.fn(async () => ({ metadata: { tenancyId: "ten_1" } })) } }));
    (tenancies as any).getTenancy = vi.fn(async () => ({ id: "ten_1", project: { id: "proj_1" } }));
    const create = vi.fn(async () => ({}));
    (prismaMod as any).getPrismaClientForTenancy = vi.fn(async () => ({ itemQuantityChange: { create } }));

    const evt = {
      type: "payment_intent.succeeded",
      account: "acct_1",
      data: {
        object: {
          id: "pi_1",
          customer: "cus_1",
          metadata: {
            purchaseKind: "ONE_TIME",
            offer: JSON.stringify({ includedItems: { itemA: { quantity: 2 } } }),
            customerId: "custX",
            customerType: "user",
            purchaseQuantity: "3",
          },
        },
      },
    } as any;

    await processStripeWebhookEvent(evt);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ itemId: "itemA", quantity: 6 }) }));
  });
});


