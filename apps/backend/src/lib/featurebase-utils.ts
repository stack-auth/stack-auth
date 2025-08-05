import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

const STACK_FEATUREBASE_API_KEY = getEnvVariable("STACK_FEATUREBASE_API_KEY");

export type FeaturebaseUser = {
  userId: string,
  email: string,
  name?: string,
  profilePicture?: string,
};

export type StackAuthUser = {
  id: string,
  primary_email: string | null,
  display_name?: string | null,
  profile_image_url?: string | null,
};

/**
 * Find a Featurebase user by their Stack Auth user ID
 */
async function findFeaturebaseUserById(stackAuthUserId: string): Promise<FeaturebaseUser | null> {
  try {
    const response = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?id=${stackAuthUserId}`, {
      method: 'GET',
      headers: {
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
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
      return null;
    }

    return {
      userId: user.externalUserId || user.userId || stackAuthUserId,
      email: user.email,
      name: user.name,
      profilePicture: user.profilePicture,
    };
  } catch (error) {
    console.error('Error finding Featurebase user by ID:', error);
    return null;
  }
}

/**
 * Find a Featurebase user by their email address
 */
async function findFeaturebaseUserByEmail(email: string): Promise<FeaturebaseUser | null> {
  try {
    const response = await fetch(`https://do.featurebase.app/v2/organization/identifyUser?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
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
      return null;
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
async function createFeaturebaseUser(user: FeaturebaseUser): Promise<FeaturebaseUser> {
  const response = await fetch('https://do.featurebase.app/v2/organization/identifyUser', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': STACK_FEATUREBASE_API_KEY,
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
}

/**
 * Update an existing Featurebase user (excluding email)
 */
async function updateFeaturebaseUser(userId: string, updates: Partial<Omit<FeaturebaseUser, 'userId' | 'email'>>): Promise<FeaturebaseUser> {
  const response = await fetch(`https://do.featurebase.app/v2/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': STACK_FEATUREBASE_API_KEY,
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
  stackAuthUser: StackAuthUser
): Promise<{ userId: string, email: string }> {
  const fallbackEmail = `${stackAuthUser.id}@featurebase-user.stack-auth-app.com`;

  // First, try to find existing user by Stack Auth user ID
  const existingById = await findFeaturebaseUserById(stackAuthUser.id);
  if (existingById) {
    // Update profile information if needed (but not email)
    try {
      const updates: Partial<Omit<FeaturebaseUser, 'userId' | 'email'>> = {};

      if (stackAuthUser.display_name && stackAuthUser.display_name !== existingById.name) {
        updates.name = stackAuthUser.display_name;
      }

      if (stackAuthUser.profile_image_url && stackAuthUser.profile_image_url !== existingById.profilePicture) {
        updates.profilePicture = stackAuthUser.profile_image_url;
      }

      if (Object.keys(updates).length > 0) {
        await updateFeaturebaseUser(existingById.userId, updates);
      }
    } catch (error) {
      console.error('Failed to update existing Featurebase user profile:', error);
      // Continue with existing user data even if update fails
    }

    return {
      userId: existingById.userId,
      email: existingById.email,
    };
  }

  // No existing user found by ID, need to create one
  const candidateEmail = stackAuthUser.primary_email ?? fallbackEmail;

  // Check if someone already has this email on Featurebase
  const existingByEmail = await findFeaturebaseUserByEmail(candidateEmail);
  const safeEmail = existingByEmail ? fallbackEmail : candidateEmail;

  // Create new user
  const created = await createFeaturebaseUser({
    userId: stackAuthUser.id,
    email: safeEmail,
    name: stackAuthUser.display_name || stackAuthUser.primary_email?.split('@')[0] || 'User',
    profilePicture: stackAuthUser.profile_image_url || undefined,
  });

  return {
    userId: created.userId,
    email: created.email,
  };
}
