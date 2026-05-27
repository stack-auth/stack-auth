import { createLlmsTextResponse, llmsTxt } from "@stackframe/stack-shared/dist/ai/llms/llms";

export function GET() {
  return createLlmsTextResponse(llmsTxt);
}

export function HEAD() {
  return GET();
}
