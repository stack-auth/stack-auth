import type * as yup from "yup";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

const invoiceStatusSchema = yupString().oneOf([
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
]).nullable().defined();

export const customerInvoiceReadSchema = yupObject({
  created_at_millis: yupNumber().defined(),
  status: invoiceStatusSchema,
  amount_total: yupNumber().integer().defined(),
  hosted_invoice_url: yupString().nullable().defined(),
}).defined();

export type CustomerInvoiceRead = yup.InferType<typeof customerInvoiceReadSchema>;

export const customerInvoicesListResponseSchema = yupObject({
  items: yupArray(customerInvoiceReadSchema).defined(),
  is_paginated: yupBoolean().oneOf([true]).defined(),
  pagination: yupObject({
    next_cursor: yupString().nullable().defined(),
  }).defined(),
}).defined();

export type CustomerInvoicesListResponse = yup.InferType<typeof customerInvoicesListResponseSchema>;

export type ListCustomerInvoicesOptions = {
  customer_type: "user" | "team",
  customer_id: string,
  cursor?: string,
  limit?: number,
};
