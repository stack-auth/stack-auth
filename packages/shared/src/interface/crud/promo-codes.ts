import type * as yup from "yup";
import { customerTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";

export const promoCodeDiscountTypeSchema = yupString().oneOf(["percent", "amount_off_usd"]).defined();
export const promoCodeSubscriptionDurationSchema = yupString().oneOf(["first_invoice", "forever"]).defined();
export const promoCodeRedemptionStatusSchema = yupString().oneOf(["reserved", "applied", "voided"]).defined();

export const promoCodeReadSchema = yupObject({
  id: yupString().defined(),
  display_name: yupString().nullable().defined(),
  code_prefix: yupString().nullable().defined(),
  code_last4: yupString().nullable().defined(),
  discount_type: promoCodeDiscountTypeSchema,
  percent_off_bps: yupNumber().integer().nullable().defined(),
  amount_off_usd_cents: yupNumber().integer().nullable().defined(),
  subscription_duration: promoCodeSubscriptionDurationSchema,
  customer_type: customerTypeSchema.nullable().defined(),
  customer_id: yupString().nullable().defined(),
  product_line_id: yupString().nullable().defined(),
  product_id: yupString().nullable().defined(),
  price_id: yupString().nullable().defined(),
  max_redemptions: yupNumber().integer().nullable().defined(),
  max_redemptions_per_customer: yupNumber().integer().nullable().defined(),
  starts_at_millis: yupNumber().integer().nullable().defined(),
  expires_at_millis: yupNumber().integer().nullable().defined(),
  disabled_at_millis: yupNumber().integer().nullable().defined(),
  deleted_at_millis: yupNumber().integer().nullable().defined(),
  created_at_millis: yupNumber().integer().defined(),
  updated_at_millis: yupNumber().integer().defined(),
}).defined();

export const promoCodeCreateSchema = yupObject({
  code: yupString().optional(),
  display_name: yupString().optional(),
  discount_type: promoCodeDiscountTypeSchema,
  percent_off_bps: yupNumber().integer().min(1).max(10000).optional(),
  amount_off_usd_cents: yupNumber().integer().min(1).optional(),
  subscription_duration: promoCodeSubscriptionDurationSchema,
  customer_type: customerTypeSchema.optional(),
  customer_id: yupString().optional(),
  product_line_id: yupString().optional(),
  product_id: yupString().optional(),
  price_id: yupString().optional(),
  max_redemptions: yupNumber().integer().min(1).optional(),
  max_redemptions_per_customer: yupNumber().integer().min(1).optional(),
  starts_at_millis: yupNumber().integer().optional(),
  expires_at_millis: yupNumber().integer().optional(),
}).defined();

export const promoCodeUpdateSchema = yupObject({
  display_name: yupString().nullable().optional(),
  subscription_duration: promoCodeSubscriptionDurationSchema.optional(),
  customer_type: customerTypeSchema.nullable().optional(),
  customer_id: yupString().nullable().optional(),
  product_line_id: yupString().nullable().optional(),
  product_id: yupString().nullable().optional(),
  price_id: yupString().nullable().optional(),
  max_redemptions: yupNumber().integer().min(1).nullable().optional(),
  max_redemptions_per_customer: yupNumber().integer().min(1).nullable().optional(),
  starts_at_millis: yupNumber().integer().nullable().optional(),
  expires_at_millis: yupNumber().integer().nullable().optional(),
  disabled: yupBoolean().optional(),
}).defined();

export const promoCodeCreateResponseSchema = promoCodeReadSchema.concat(yupObject({
  code: yupString().defined(),
}));

export const promoCodeListResponseSchema = yupObject({
  items: yupArray(promoCodeReadSchema).defined(),
  next_cursor: yupString().nullable().defined(),
}).defined();

export const promoCodeRedemptionReadSchema = yupObject({
  id: yupString().defined(),
  promo_code_id: yupString().defined(),
  customer_type: customerTypeSchema.defined(),
  customer_id: yupString().defined(),
  product_id: yupString().nullable().defined(),
  price_id: yupString().nullable().defined(),
  quantity: yupNumber().integer().defined(),
  original_amount_usd_cents: yupNumber().integer().defined(),
  discount_amount_usd_cents: yupNumber().integer().defined(),
  final_amount_usd_cents: yupNumber().integer().defined(),
  subscription_duration: promoCodeSubscriptionDurationSchema.nullable().defined(),
  status: promoCodeRedemptionStatusSchema,
  applied_at_millis: yupNumber().integer().nullable().defined(),
  voided_at_millis: yupNumber().integer().nullable().defined(),
  created_at_millis: yupNumber().integer().defined(),
}).defined();

export const promoCodeRedemptionListResponseSchema = yupObject({
  items: yupArray(promoCodeRedemptionReadSchema).defined(),
  next_cursor: yupString().nullable().defined(),
}).defined();

export type PromoCodeRead = yup.InferType<typeof promoCodeReadSchema>;
export type PromoCodeCreate = yup.InferType<typeof promoCodeCreateSchema>;
export type PromoCodeUpdate = yup.InferType<typeof promoCodeUpdateSchema>;
export type PromoCodeCreateResponse = yup.InferType<typeof promoCodeCreateResponseSchema>;
export type PromoCodeListResponse = yup.InferType<typeof promoCodeListResponseSchema>;
export type PromoCodeRedemptionRead = yup.InferType<typeof promoCodeRedemptionReadSchema>;
export type PromoCodeRedemptionListResponse = yup.InferType<typeof promoCodeRedemptionListResponseSchema>;
