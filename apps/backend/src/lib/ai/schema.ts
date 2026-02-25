import { yupArray, yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { InferType } from "yup";

export const requestBodySchema = yupObject({
  quality: yupString().oneOf(["dumb", "smart", "smartest"]).defined(),
  speed: yupString().oneOf(["slow", "fast"]).defined(),
  tools: yupArray(yupString().defined()).defined(),
  systemPrompt: yupString().oneOf([
    "command-center-ask-ai",
    "docs-ask-ai",
    "wysiwyg-edit",
    "email-wysiwyg-editor",
    "email-assistant-template",
    "email-assistant-theme",
    "email-assistant-draft",
    "create-dashboard",
    "run-query",
  ]).defined(),
  messages: yupArray(
    yupObject({
      role: yupString().oneOf(["user", "assistant", "tool"]).defined(),
      content: yupMixed().defined(),
    }).defined()
  ).defined().min(1),
});

export type RequestBody = InferType<typeof requestBodySchema>;
