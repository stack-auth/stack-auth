import { stackServerApp } from "@/stack";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import * as jose from "jose";
import { Metadata } from "next";
import { redirect } from "next/navigation";

// We'll need to create a server-side version of the featurebase utils
// For now, let's inline the logic here
async function getOrCreateFeaturebaseUserForSSO(stackAuthUser: {
  id: string,
  primaryEmail: string | null,
  displayName?: string | null,
  profileImageUrl?: string | null,
}): Promise<{ userId: string, email: string }> {
  const STACK_FEATUREBASE_API_KEY = getEnvVariable("STACK_FEATUREBASE_API_KEY");
  const fallbackEmail = `${stackAuthUser.id}@featurebase-user.stack-auth-app.com`;

  // First, try to find existing user by Stack Auth user ID
  try {
    const response = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?id=${stackAuthUser.id}`, {
      method: 'GET',
      headers: {
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const user = data.user;

      if (user) {
        // Update profile information if needed (but not email)
        try {
          const updates: any = {};

          if (stackAuthUser.displayName && stackAuthUser.displayName !== user.name) {
            updates.name = stackAuthUser.displayName;
          }

          if (stackAuthUser.profileImageUrl && stackAuthUser.profileImageUrl !== user.profilePicture) {
            updates.profilePicture = stackAuthUser.profileImageUrl;
          }

          if (Object.keys(updates).length > 0) {
            await fetch('https://do.featurebase.app/v2/organization/identifyUser', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': STACK_FEATUREBASE_API_KEY,
              },
              body: JSON.stringify({
                userId: user.externalUserId || user.userId || stackAuthUser.id,
                email: user.email, // Keep existing email
                name: updates.name || user.name,
                profilePicture: updates.profilePicture || user.profilePicture,
              }),
            });
          }
        } catch (error) {
          console.error('Failed to update existing Featurebase user profile:', error);
        }

        return {
          userId: user.externalUserId || user.userId || stackAuthUser.id,
          email: user.email,
        };
      }
    }
  } catch (error) {
    console.error('Error finding Featurebase user by ID:', error);
  }

  // No existing user found by ID, need to create one
  const candidateEmail = stackAuthUser.primaryEmail ?? fallbackEmail;

  // Check if someone already has this email on Featurebase
  let safeEmail = candidateEmail;
  try {
    const emailCheckResponse = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?email=${encodeURIComponent(candidateEmail)}`, {
      method: 'GET',
      headers: {
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
    });

    if (emailCheckResponse.ok) {
      const emailData = await emailCheckResponse.json();
      if (emailData.user) {
        // Email already exists, use fallback
        safeEmail = fallbackEmail;
      }
    }
  } catch (error) {
    console.error('Error checking email availability:', error);
    // Use fallback email to be safe
    safeEmail = fallbackEmail;
  }

  // Create new user
  try {
    const createResponse = await fetch('https://do.featurebase.app/v2/organization/identifyUser', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
      body: JSON.stringify({
        userId: stackAuthUser.id,
        email: safeEmail,
        name: stackAuthUser.displayName || stackAuthUser.primaryEmail?.split('@')[0] || 'User',
        profilePicture: stackAuthUser.profileImageUrl || undefined,
      }),
    });

    if (createResponse.ok) {
      return {
        userId: stackAuthUser.id,
        email: safeEmail,
      };
    }
  } catch (error) {
    console.error('Error creating Featurebase user:', error);
  }

  // Fallback: return Stack Auth user data
  return {
    userId: stackAuthUser.id,
    email: safeEmail,
  };
}

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
  const featurebaseUser = await getOrCreateFeaturebaseUserForSSO({
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
    name: user.displayName || featurebaseUser.email.split('@')[0] || 'User',
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
