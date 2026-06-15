import * as yup from "yup";
import { ITEM_IDS } from "../plans";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString } from "../schema-fields";

export const planUsageKindSchema = yupString().oneOf(["current", "metered", "capability"]).defined();

export const planUsageRowSchema = yupObject({
  item_id: yupString().oneOf(Object.values(ITEM_IDS)).defined(),
  display_name: yupString().defined(),
  kind: planUsageKindSchema,
  used: yupNumber().integer().nullable().defined(),
  limit: yupNumber().integer().nullable().defined(),
  remaining: yupNumber().integer().nullable().defined(),
  overage: yupNumber().integer().nullable().defined(),
  is_unlimited: yupBoolean().defined(),
}).defined();

export const planUsageResponseSchema = yupObject({
  owner_team_id: yupString().uuid().defined(),
  owner_team_display_name: yupString().defined(),
  plan_id: yupString().oneOf(["free", "team", "growth"]).defined(),
  plan_display_name: yupString().defined(),
  period_start_millis: yupNumber().integer().defined(),
  period_end_millis: yupNumber().integer().defined(),
  next_plan_id: yupString().oneOf(["team", "growth"]).nullable().defined(),
  rows: yupArray(planUsageRowSchema).defined(),
}).defined();

export type PlanUsageKind = yup.InferType<typeof planUsageKindSchema>;
export type PlanUsageRow = yup.InferType<typeof planUsageRowSchema>;
export type PlanUsageResponse = yup.InferType<typeof planUsageResponseSchema>;
