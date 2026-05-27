import { createLlmsTextResponse, llmsTxt } from "@stackframe/stack-shared/dist/ai/llms/llms";

export default {
  fetch() {
    return createLlmsTextResponse(llmsTxt);
  },
};
