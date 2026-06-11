import { getConvexProvidersConfig } from "@hexclave/next/convex-auth.config";

export default {
  providers: getConvexProvidersConfig({
    projectId: (process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID || process.env.NEXT_PUBLIC_STACK_PROJECT_ID)!,
    baseUrl: (process.env.NEXT_PUBLIC_HEXCLAVE_API_URL || process.env.NEXT_PUBLIC_STACK_API_URL),
  }),
}
