import type * as yup from "yup";
import { inlineProductSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

const customerProductSwitchOptionSchema = yupObject({
  product_id: yupString().defined(),
  product: inlineProductSchema.defined(),
}).defined();

export const customerProductReadSchema = yupObject({
  id: yupString().nullable().defined(),
  quantity: yupNumber().defined(),
  product: inlineProductSchema.defined(),
  type: yupString().oneOf(["one_time", "subscription"]).defined(),
  subscription: yupObject({
    subscription_id: yupString().nullable().defined(),
    current_period_end: yupString().nullable().defined(),
    cancel_at_period_end: yupBoolean().defined(),
    is_cancelable: yupBoolean().defined(),
  }).nullable().defined(),
  switch_options: yupArray(customerProductSwitchOptionSchema).optional(),
}).defined();

export type CustomerProductRead = yup.InferType<typeof customerProductReadSchema>;

export const customerProductsListResponseSchema = yupObject({
  items: yupArray(customerProductReadSchema).defined(),
  is_paginated: yupBoolean().oneOf([true]).defined(),
  pagination: yupObject({
    next_cursor: yupString().nullable().defined(),
  }).defined(),
}).defined();

export type CustomerProductsListResponse = yup.InferType<typeof customerProductsListResponseSchema>;

export type ListCustomerProductsOptions = {
  customer_type: "user" | "team" | "custom",
  customer_id: string,
  cursor?: string,
  limit?: number,
};
