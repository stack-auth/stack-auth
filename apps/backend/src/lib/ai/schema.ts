import { yupArray, yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { ModelMessage } from "ai";
import { InferType } from "yup";
import { MODEL_QUALITIES, MODEL_SPEEDS } from "./models";
import { SYSTEM_PROMPT_IDS } from "./prompts";
import { TOOL_NAMES } from "./tools";

export const requestBodySchema = yupObject({
  quality: yupString().oneOf(MODEL_QUALITIES).defined(),
  speed: yupString().oneOf(MODEL_SPEEDS).defined(),
  tools: yupArray(yupString().oneOf(TOOL_NAMES).defined()).defined(),
  systemPrompt: yupString().oneOf(SYSTEM_PROMPT_IDS).defined(),
  messages: yupArray(yupMixed<ModelMessage>().defined()).defined().min(1),
  projectId: yupString().optional().nullable(),
});

export type RequestBody = InferType<typeof requestBodySchema>;
