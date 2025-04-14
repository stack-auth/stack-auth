import { createCrud, CrudTypeOf } from "../../crud";
import { yupArray, yupEnum, yupNumber, yupObject, yupString } from "../../schema-fields";

export const subscriptionStatusSchema = yupEnum(['INACTIVE', 'ACTIVE', 'CANCELLED', 'TRIAL', 'PAUSED']);

export const subscriptionSchema = yupObject({
  id: yupString().uuid().defined(),
  status: subscriptionStatusSchema.defined(),
  customer_id: yupString().uuid().defined(),
  stripe_subscription_id: yupString().nullable(),
  stripe_subscription_item_id: yupString().nullable(),
  price_id: yupString().uuid().nullable(),
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
  cancelled_at_millis: yupNumber().nullable(),
}).defined();

export const subscriptionUpdateSchema = yupObject({
  status: subscriptionStatusSchema,
}).defined();

export const subscriptionsCrud = createCrud({
  adminReadSchema: subscriptionSchema,
  serverReadSchema: subscriptionSchema,
  clientReadSchema: subscriptionSchema,

  adminListSchema: yupArray(subscriptionSchema).defined(),
  serverListSchema: yupArray(subscriptionSchema).defined(),
  clientListSchema: yupArray(subscriptionSchema).defined(),

  adminUpdateSchema: subscriptionUpdateSchema,
  serverUpdateSchema: subscriptionUpdateSchema,

  adminDeleteSchema: yupObject({}).defined(),
  serverDeleteSchema: yupObject({}).defined(),

  docs: {
    clientRead: {
      summary: 'Get subscription',
      description: 'Get a subscription by ID.',
      tags: ['Subscriptions'],
    },
    clientList: {
      summary: 'List subscriptions',
      description: 'List all subscriptions for the current customer.',
      tags: ['Subscriptions'],
    },
    serverRead: {
      summary: 'Get subscription',
      description: 'Get a subscription by ID.',
      tags: ['Subscriptions'],
    },
    serverList: {
      summary: 'List subscriptions',
      description: 'List all subscriptions for a customer.',
      tags: ['Subscriptions'],
    },
    serverUpdate: {
      summary: 'Update subscription',
      description: 'Update a subscription, e.g., to cancel it.',
      tags: ['Subscriptions'],
    },
    serverDelete: {
      summary: 'Delete subscription',
      description: 'Delete a subscription (admin only).',
      tags: ['Subscriptions'],
    },
    adminRead: {
      summary: 'Get subscription (admin)',
      description: 'Get a subscription by ID (admin only).',
      tags: ['Subscriptions'],
    },
    adminList: {
      summary: 'List subscriptions (admin)',
      description: 'List all subscriptions (admin only).',
      tags: ['Subscriptions'],
    },
    adminUpdate: {
      summary: 'Update subscription (admin)',
      description: 'Update a subscription, e.g., to change its status (admin only).',
      tags: ['Subscriptions'],
    },
    adminDelete: {
      summary: 'Delete subscription (admin)',
      description: 'Delete a subscription (admin only).',
      tags: ['Subscriptions'],
    },
  },
});

export type SubscriptionsCrud = CrudTypeOf<typeof subscriptionsCrud>;
