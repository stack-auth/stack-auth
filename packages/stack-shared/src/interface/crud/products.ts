import type * as yup from "yup";
import { inlineProductSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

export const customerProductReadSchema = yupObject({
  id: yupString().nullable().defined(),
  quantity: yupNumber().defined(),
  product: inlineProductSchema.defined(),
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
