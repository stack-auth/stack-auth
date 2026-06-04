"use node"

import { v } from "convex/values";
import { hexclaveServerApp } from "../hexclave/server";
import { action } from "./_generated/server";


export const myAction = action({
  args: {
    testMetadata: v.string(),
  },

  handler: async (ctx, args) => {
    const partialUser = await hexclaveServerApp.getPartialUser({ from: "convex", ctx });
    if (!partialUser) {
      return null;
    }
    const user = await hexclaveServerApp.getUser(partialUser?.id);
    if (!user) {
      return null;
    }
    await user.setClientReadOnlyMetadata({
      test: args.testMetadata,
    })
  },
});

