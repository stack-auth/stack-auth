import { createLlmsTextResponse, llmsFullTxt } from "@hexclave/shared/dist/ai/llms/llms";

export function GET() {
  return createLlmsTextResponse(llmsFullTxt);
}

export function HEAD() {
  return GET();
}
