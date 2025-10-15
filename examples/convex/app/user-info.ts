import { api } from "@/convex/_generated/api";
import { stackClientApp } from "@/stack/client";
import { ConvexHttpClient, ConvexClient } from "convex/browser";

const convexHttpClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function getUserInfoConvexHttpClient() {
  const token = await stackClientApp.getConvexHttpClientAuth({ tokenStore: "nextjs-cookie" });
  convexHttpClient.setAuth(token);
  const userInfo = await convexHttpClient.query(api.myFunctions.getUserInfo, {});
  return userInfo;
}


const convexClient = new ConvexClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
convexClient.setAuth(stackClientApp.getConvexClientAuth({ tokenStore: "nextjs-cookie" }))

export async function getUserInfoConvexClient() {
  const userInfo = await convexClient.query(api.myFunctions.getUserInfo, {});
  return userInfo;
}
