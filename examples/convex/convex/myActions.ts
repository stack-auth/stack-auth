"use node"

import { v } from "convex/values";
import { stackServerApp } from "../hexclave/server";
import { action } from "./_generated/server";


export const myAction = action({
  args: {
    testMetadata: v.string(),
  },

  handler: async (ctx, args) => {
    const partialUser = await stackServerApp.getPartialUser({ from: "convex", ctx });
    if (!partialUser) {
      return null;
    }
    const user = await stackServerApp.getUser(partialUser?.id);
    if (!user) {
      return null;
    }
    await user.setClientReadOnlyMetadata({
      test: args.testMetadata,
    })
  },
});

