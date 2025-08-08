import { stackServerApp } from "@/stack";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { getOrCreateFeaturebaseUser } from "@stackframe/stack-shared/dist/utils/featurebase";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import * as jose from "jose";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Signing you in...",
};

export default async function FeaturebaseSSO({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>,
}) {
  const { return_to: returnTo } = await searchParams;

  if (!returnTo) {
    return <div>Missing return_to parameter. Please go back and try again.</div>;
  }

  const user = await stackServerApp.getUser();
  if (!user) {
    redirect(urlString`/handler/sign-in?after_auth_return_to=${urlString`/integrations/featurebase/sso?return_to=${returnTo}`}`);
  }

  // Get or create Featurebase user with consistent email
  const featurebaseUser = await getOrCreateFeaturebaseUser({
    id: user.id,
    primaryEmail: user.primaryEmail,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl,
  });

  const featurebaseSecret = getEnvVariable("STACK_FEATUREBASE_JWT_SECRET");

  // Create JWT token using the Featurebase user data
  const secret = new TextEncoder().encode(featurebaseSecret);
  const jwt = await new jose.SignJWT({
    userId: featurebaseUser.userId,
    email: featurebaseUser.email,
    name: user.displayName || 'Stack Auth User',
    profilePicture: user.profileImageUrl || undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("stack-auth")
    .setExpirationTime("10min")
    .sign(secret);

  // Redirect to Featurebase with JWT and return_to
  const featurebaseUrl = new URL("https://feedback.stack-auth.com/api/v1/auth/access/jwt");
  featurebaseUrl.searchParams.set("jwt", jwt);
  featurebaseUrl.searchParams.set("return_to", returnTo);

  redirect(featurebaseUrl.toString());
}
