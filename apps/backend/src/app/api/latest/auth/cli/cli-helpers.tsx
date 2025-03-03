import { prismaClient } from '@/prisma-client';
import { generateSecureRandomString } from '@stackframe/stack-shared/dist/utils/crypto';
import { createAuthTokens } from '@/lib/tokens';
import { Tenancy } from '@/lib/tenancies';
import { traceSpan } from '@/utils/telemetry';
import { PrismaClient } from '@prisma/client';

const CLI_TOKEN_EXPIRATION_MINUTES = 10;

/**
 * Creates a new CLI authentication token with a polling token and expiry time.
 * This is used to initiate the CLI login flow.
 *
 * @returns The created CLI authentication token
 */
export async function createCliAuthToken() {
  return await traceSpan("creating CLI auth token", async () => {
    const pollingToken = generateSecureRandomString();

    const cliAuthToken = await (prismaClient as any).cliAuthToken.create({
      data: {
        pollingToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * CLI_TOKEN_EXPIRATION_MINUTES),
      },
    });

    return cliAuthToken;
  });
}

/**
 * Authorizes a CLI token by setting the internal token, refresh token, tenancy, and project user.
 * This is called when the user authorizes the CLI from a browser.
 *
 * @param pollingToken - The polling token to authorize
 * @param tenancy - The tenancy to associate with the CLI token
 * @param projectUserId - The project user ID to associate with the CLI token
 * @returns The refresh token and access token if successful, null otherwise
 */
export async function authorizeCliToken({
  pollingToken,
  tenancy,
  projectUserId,
}: {
  pollingToken: string,
  tenancy: Tenancy,
  projectUserId: string,
}) {
  return await traceSpan("authorizing CLI token", async () => {
    const cliAuthToken = await (prismaClient as any).cliAuthToken.findUnique({
      where: {
        pollingToken,
      },
    });

    if (!cliAuthToken) {
      return null;
    }

    if (cliAuthToken.expiresAt < new Date()) {
      return null;
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365), // 1 year
    });

    await (prismaClient as any).cliAuthToken.update({
      where: {
        pollingToken,
      },
      data: {
        internalToken: accessToken,
        refreshToken,
        tenancyId: tenancy.id,
        projectUserId,
      },
    });

    return { refreshToken, accessToken };
  });
}

// Unit tests
if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

  describe('CLI auth helpers', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    describe('createCliAuthToken', () => {
      it('should create a CLI auth token with a polling token and expiry time', async () => {
        // Mock dependencies
        const mockPollingToken = 'mock-polling-token';
        const mockCliAuthToken = {
          id: 'mock-id',
          pollingToken: mockPollingToken,
          expiresAt: new Date(),
        };

        vi.mock('@stackframe/stack-shared/dist/utils/crypto', () => ({
          generateSecureRandomString: vi.fn().mockReturnValue(mockPollingToken),
        }));

        vi.mock('@/prisma-client', () => ({
          prismaClient: {
            cliAuthToken: {
              create: vi.fn().mockResolvedValue(mockCliAuthToken),
            },
          },
        }));

        vi.mock('@/utils/telemetry', () => ({
          traceSpan: vi.fn().mockImplementation((_, fn) => fn()),
        }));

        // Call the function
        const result = await createCliAuthToken();

        // Verify the result
        expect(result).toEqual(mockCliAuthToken);

        // Verify the dependencies were called correctly
        expect(generateSecureRandomString).toHaveBeenCalled();
        expect((prismaClient as any).cliAuthToken.create).toHaveBeenCalledWith({
          data: {
            pollingToken: mockPollingToken,
            expiresAt: expect.any(Date),
          },
        });
      });
    });

    describe('authorizeCliToken', () => {
      it('should authorize a CLI token with refresh and access tokens', async () => {
        // Mock dependencies
        const mockPollingToken = 'mock-polling-token';
        const mockTenancy = { id: 'mock-tenancy-id' } as Tenancy;
        const mockProjectUserId = 'mock-project-user-id';
        const mockCliAuthToken = {
          id: 'mock-id',
          pollingToken: mockPollingToken,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour in the future
        };
        const mockRefreshToken = 'mock-refresh-token';
        const mockAccessToken = 'mock-access-token';

        vi.mock('@/prisma-client', () => ({
          prismaClient: {
            cliAuthToken: {
              findUnique: vi.fn().mockResolvedValue(mockCliAuthToken),
              update: vi.fn().mockResolvedValue({}),
            },
          },
        }));

        vi.mock('@/lib/tokens', () => ({
          createAuthTokens: vi.fn().mockResolvedValue({
            refreshToken: mockRefreshToken,
            accessToken: mockAccessToken,
          }),
        }));

        vi.mock('@/utils/telemetry', () => ({
          traceSpan: vi.fn().mockImplementation((_, fn) => fn()),
        }));

        // Call the function
        const result = await authorizeCliToken({
          pollingToken: mockPollingToken,
          tenancy: mockTenancy,
          projectUserId: mockProjectUserId,
        });

        // Verify the result
        expect(result).toEqual({
          refreshToken: mockRefreshToken,
          accessToken: mockAccessToken,
        });

        // Verify the dependencies were called correctly
        expect((prismaClient as any).cliAuthToken.findUnique).toHaveBeenCalledWith({
          where: {
            pollingToken: mockPollingToken,
          },
        });

        expect(createAuthTokens).toHaveBeenCalledWith({
          tenancy: mockTenancy,
          projectUserId: mockProjectUserId,
          expiresAt: expect.any(Date),
        });

        expect((prismaClient as any).cliAuthToken.update).toHaveBeenCalledWith({
          where: {
            pollingToken: mockPollingToken,
          },
          data: {
            internalToken: mockAccessToken,
            refreshToken: mockRefreshToken,
            tenancyId: mockTenancy.id,
            projectUserId: mockProjectUserId,
          },
        });
      });

      it('should return null if the CLI token is not found', async () => {
        // Mock dependencies
        const mockPollingToken = 'mock-polling-token';
        const mockTenancy = { id: 'mock-tenancy-id' } as Tenancy;
        const mockProjectUserId = 'mock-project-user-id';

        vi.mock('@/prisma-client', () => ({
          prismaClient: {
            cliAuthToken: {
              findUnique: vi.fn().mockResolvedValue(null),
            },
          },
        }));

        vi.mock('@/utils/telemetry', () => ({
          traceSpan: vi.fn().mockImplementation((_, fn) => fn()),
        }));

        // Call the function
        const result = await authorizeCliToken({
          pollingToken: mockPollingToken,
          tenancy: mockTenancy,
          projectUserId: mockProjectUserId,
        });

        // Verify the result
        expect(result).toBeNull();

        // Verify the dependencies were called correctly
        expect((prismaClient as any).cliAuthToken.findUnique).toHaveBeenCalledWith({
          where: {
            pollingToken: mockPollingToken,
          },
        });
      });

      it('should return null if the CLI token has expired', async () => {
        // Mock dependencies
        const mockPollingToken = 'mock-polling-token';
        const mockTenancy = { id: 'mock-tenancy-id' } as Tenancy;
        const mockProjectUserId = 'mock-project-user-id';
        const mockCliAuthToken = {
          id: 'mock-id',
          pollingToken: mockPollingToken,
          expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour in the past
        };

        vi.mock('@/prisma-client', () => ({
          prismaClient: {
            cliAuthToken: {
              findUnique: vi.fn().mockResolvedValue(mockCliAuthToken),
            },
          },
        }));

        vi.mock('@/utils/telemetry', () => ({
          traceSpan: vi.fn().mockImplementation((_, fn) => fn()),
        }));

        // Call the function
        const result = await authorizeCliToken({
          pollingToken: mockPollingToken,
          tenancy: mockTenancy,
          projectUserId: mockProjectUserId,
        });

        // Verify the result
        expect(result).toBeNull();

        // Verify the dependencies were called correctly
        expect((prismaClient as any).cliAuthToken.findUnique).toHaveBeenCalledWith({
          where: {
            pollingToken: mockPollingToken,
          },
        });
      });
    });
  });
}
