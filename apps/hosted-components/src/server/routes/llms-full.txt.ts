import { createLlmsTextResponse, llmsFullTxt } from "@stackframe/stack-shared/dist/ai/llms/llms";

export default {
  fetch() {
    return createLlmsTextResponse(llmsFullTxt);
  },
};
