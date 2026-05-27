import { createLlmsTextResponse, llmsFullTxt } from "@stackframe/stack-shared/dist/ai/llms/llms";

export function GET() {
  return createLlmsTextResponse(llmsFullTxt);
}

export function HEAD() {
  return GET();
}
