import { getEnvVariable } from "./env";
import { StackAssertionError } from "./errors";

export type FeaturebaseUser = {
  userId: string,
  email: string,
  name?: string,
  profilePicture?: string,
};

export type StackAuthUser = {
  id: string,
  primaryEmail: string | null,
  displayName?: string | null,
  profileImageUrl?: string | null,
};

/**
 * Find a Featurebase user by their Stack Auth user ID
 */
async function findFeaturebaseUserById(stackAuthUserId: string, apiKey: string): Promise<FeaturebaseUser | null> {
  try {
    const response = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?id=${stackAuthUserId}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new StackAssertionError(`Failed to find Featurebase user by ID: ${response.statusText}`);
    }

    const data = await response.json();
    const user = data.user;

    if (!user) {
      throw new StackAssertionError(`Featurebase API returned success but no user data for ID: ${stackAuthUserId}`, { data });
    }

    return {
      userId: user.externalUserId || user.userId || stackAuthUserId,
      email: user.email,
      name: user.name,
      profilePicture: user.profilePicture,
    };
  } catch (error) {
    if (error instanceof StackAssertionError) {
      throw error;
    }
    throw new StackAssertionError("Failed to find Featurebase user by ID", { cause: error });
  }
}

/**
 * Find a Featurebase user by their email address
 */
async function findFeaturebaseUserByEmail(email: string, apiKey: string): Promise<FeaturebaseUser | null> {
  try {
    const response = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new StackAssertionError(`Failed to find Featurebase user by email: ${response.statusText}`);
    }

    const data = await response.json();
    const user = data.user;

    if (!user) {
      throw new StackAssertionError(`Featurebase API returned success but no user data for email: ${email}`, { data });
    }

    return {
      userId: user.externalUserId || user.userId,
      email: user.email,
      name: user.name,
      profilePicture: user.profilePicture,
    };
  } catch (error) {
    console.error('Error finding Featurebase user by email:', error);
    return null;
  }
}

/**
 * Create a new Featurebase user using the identifyUser endpoint
 */
async function createFeaturebaseUser(user: FeaturebaseUser, apiKey: string): Promise<FeaturebaseUser> {
  try {
    const response = await fetch('https://do.featurebase.app/v2/organization/identifyUser', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        userId: user.userId,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new StackAssertionError(`Failed to create Featurebase user: ${errorData.error || response.statusText}`, { errorData });
    }

    // The identifyUser endpoint just returns { "success": true }, so we return the input data
    return user;
  } catch (error) {
    if (error instanceof StackAssertionError) {
      throw error;
    }
    throw new StackAssertionError("Failed to create Featurebase user", { cause: error });

  }
}

/**
 * Update an existing Featurebase user (excluding email)
 */
async function updateFeaturebaseUser(userId: string, updates: Partial<Omit<FeaturebaseUser, 'userId' | 'email'>>, apiKey: string): Promise<FeaturebaseUser> {
  try {
    const response = await fetch(`https://do.featurebase.app/v2/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new StackAssertionError(`Failed to update Featurebase user: ${errorData.error || response.statusText}`, { errorData });
    }

    const data = await response.json();
    return {
      userId: data.userId || userId,
      email: data.email,
      name: data.name,
      profilePicture: data.profilePicture,
    };
  } catch (error) {
    if (error instanceof StackAssertionError) {
      throw error;
    }
    throw new StackAssertionError("Failed to update Featurebase user", { cause: error });
  }
}

/**
 * Get or create a Featurebase user based on Stack Auth user data.
 * This function ensures that:
 * 1. We never change a user's email address on Featurebase
 * 2. We use Stack Auth user ID as the primary identifier
 * 3. We handle email conflicts by using fallback emails
 * 4. We update profile information when needed
 */
export async function getOrCreateFeaturebaseUser(
  stackAuthUser: StackAuthUser,
  options?: { apiKey?: string }
): Promise<{ userId: string, email: string }> {
  const apiKey = options?.apiKey || getEnvVariable("STACK_FEATUREBASE_API_KEY");
  const fallbackEmail = `${stackAuthUser.id}@featurebase-user.stack-auth-app.com`;

  // First, try to find existing user by Stack Auth user ID
  const existingById = await findFeaturebaseUserById(stackAuthUser.id, apiKey);
  if (existingById) {
    // Ensure the user has an email on Featurebase.
    let ensuredEmail = existingById.email;
    if (!ensuredEmail) {
      try {
        await createFeaturebaseUser({
          userId: existingById.userId,
          email: fallbackEmail,
          name: stackAuthUser.displayName || undefined,
          profilePicture: stackAuthUser.profileImageUrl || undefined,
        }, apiKey);
        ensuredEmail = fallbackEmail;
      } catch (e) {
        // If setting fallback email failed, keep ensuredEmail as-is (undefined) and let callers handle
        throw new StackAssertionError(`Failed to set fallback email for existing Featurebase user ${existingById.userId}`, { cause: e });
      }
    }

    // Update profile information if needed (but not email)
    try {
      const updates: Partial<Omit<FeaturebaseUser, 'userId' | 'email'>> = {};

      if (stackAuthUser.displayName && stackAuthUser.displayName !== existingById.name) {
        updates.name = stackAuthUser.displayName;
      }

      if (stackAuthUser.profileImageUrl && stackAuthUser.profileImageUrl !== existingById.profilePicture) {
        updates.profilePicture = stackAuthUser.profileImageUrl;
      }

      if (Object.keys(updates).length > 0) {
        await updateFeaturebaseUser(existingById.userId, updates, apiKey);
      }
    } catch (error) {
      console.error('Failed to update existing Featurebase user profile:', error);
      // Continue with existing user data even if update fails
    }

    return {
      userId: existingById.userId,
      email: ensuredEmail,
    };
  }

  // No existing user found by ID, need to create one
  const candidateEmail = stackAuthUser.primaryEmail ?? fallbackEmail;

  // Check if someone already has this email on Featurebase
  const existingByEmail = await findFeaturebaseUserByEmail(candidateEmail, apiKey);
  const safeEmail = existingByEmail ? fallbackEmail : candidateEmail;

  // Create new user
  const created = await createFeaturebaseUser({
    userId: stackAuthUser.id,
    email: safeEmail,
    name: stackAuthUser.displayName || stackAuthUser.primaryEmail?.split('@')[0] || 'User',
    profilePicture: stackAuthUser.profileImageUrl || undefined,
  }, apiKey);

  return {
    userId: created.userId,
    email: created.email,
  };
}
