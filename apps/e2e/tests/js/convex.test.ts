import { it } from "../helpers";
import { createApp } from "./js-helpers";
import { ConvexReactClient } from "convex/react";


it("should be able to set auth on convex client", async ({ expect }) => {
  const { clientApp } = await createApp({});
  const convex = new ConvexReactClient("http://localhost:1234");
  convex.setAuth(
    clientApp.getConvexClientAuth({ tokenStore: "nextjs-cookie" })
  );
});
