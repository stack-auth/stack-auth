import { createLlmsTextResponse, llmsFullTxt } from "@stackframe/stack-shared/dist/ai/llms/llms";
import { assertMethod } from "h3";

export default {
  fetch(event) {
    assertMethod(event, "GET", true);
    return createLlmsTextResponse(llmsFullTxt);
  },
};
