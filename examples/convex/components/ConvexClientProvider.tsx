"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { stackClientApp } from "@/stack/client";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
convex.setAuth(
  stackClientApp.getConvexClientAuth({ tokenStore: "nextjs-cookie" })
);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
