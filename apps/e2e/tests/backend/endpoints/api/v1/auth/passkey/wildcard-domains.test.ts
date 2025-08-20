import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, niceBackendFetch } from "../../../../../backend-helpers";

describe("Passkey with wildcard domains", () => {
  it("should store wildcard domains in config correctly", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });

    // Configure various wildcard domains
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.exact': {
            baseUrl: 'https://app.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.single-wildcard': {
            baseUrl: 'https://*.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.prefix-wildcard': {
            baseUrl: 'https://api-*.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.double-wildcard': {
            baseUrl: 'https://**.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.multi-level': {
            baseUrl: 'https://*.*.test.com',
            handlerPath: '/handler',
          },
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Get the config to verify wildcards are stored
    const getResponse = await niceBackendFetch("/api/v1/internal/config", {
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      method: "GET",
    });
    expect(getResponse.status).toBe(200);

    const config = JSON.parse(getResponse.body.config_string);
    expect(config.domains.trustedDomains).toMatchObject({
      'exact': {
        baseUrl: 'https://app.example.com',
        handlerPath: '/handler',
      },
      'single-wildcard': {
        baseUrl: 'https://*.example.com',
        handlerPath: '/handler',
      },
      'prefix-wildcard': {
        baseUrl: 'https://api-*.example.com',
        handlerPath: '/handler',
      },
      'double-wildcard': {
        baseUrl: 'https://**.example.com',
        handlerPath: '/handler',
      },
      'multi-level': {
        baseUrl: 'https://*.*.test.com',
        handlerPath: '/handler',
      },
    });
  });

  it("should successfully register passkey with matching wildcard domain", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
        magic_link_enabled: true
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Sign up a user first
    const res = await Auth.Password.signUpWithEmail();

    // Configure wildcard domain that matches our test origin
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.wildcard': {
            baseUrl: 'http://*:8103', // Will match http://localhost:8103 and any host on port 8103
            handlerPath: '/',
          },
          'domains.allowLocalhost': false, // Disable default localhost to test wildcard
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Initiate passkey registration
    const initiateResponse = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-registration", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(initiateResponse.status).toBe(200);
    const { code } = initiateResponse.body;

    // Register passkey with origin matching wildcard
    const registerResponse = await niceBackendFetch("/api/v1/auth/passkey/register", {
      method: "POST",
      accessType: "client",
      body: {
        "credential": {
          "id": "WILDCARD_TEST_ID",
          "rawId": "WILDCARD_TEST_ID",
          "response": {
            "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViYSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8",
            "clientDataJSON": btoa(JSON.stringify({
              type: "webauthn.create",
              challenge: "TU9DSw",
              origin: "http://localhost:8103", // Matches wildcard *:8103
              crossOrigin: false
            })),
            "transports": ["hybrid", "internal"],
            "publicKeyAlgorithm": -7,
            "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7skmKF73cIOFk48Wn2lV59nIG_LrYkyNKzjuJ3WrS-k0yMsBAbsRJipFmwFBtfTtZYgiYTNgUOwmAE5JiJBkvw",
            "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8"
          },
          "type": "public-key",
          "clientExtensionResults": {
            "credProps": {
              "rk": true
            }
          },
          "authenticatorAttachment": "platform"
        },
        "code": code,
      },
    });

    expect(registerResponse.status).toBe(200);
    expect(registerResponse.body).toHaveProperty("user_handle");
  });

  it("should successfully sign in with passkey using matching double wildcard domain", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Sign up and register passkey with default localhost allowed
    const res = await Auth.Password.signUpWithEmail();
    const expectedUserId = res.userId;
    await Auth.Passkey.register(); // This uses http://localhost:8103
    await Auth.signOut();

    // Configure double wildcard domain that matches localhost:8103
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.double': {
            baseUrl: 'http://**host:8103', // Will match localhost:8103
            handlerPath: '/',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Initiate authentication
    const initiateResponse = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(initiateResponse.status).toBe(200);
    const { code } = initiateResponse.body;

    // Sign in with passkey using deeply nested subdomain
    const signinResponse = await niceBackendFetch("/api/v1/auth/passkey/sign-in", {
      method: "POST",
      accessType: "client",
      body: {
        "authentication_response": {
          "id": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "rawId": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "response": {
            "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
            "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiVFU5RFN3Iiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdDo4MTAzIiwiY3Jvc3NPcmlnaW4iOmZhbHNlLCJvdGhlcl9rZXlzX2Nhbl9iZV9hZGRlZF9oZXJlIjoiZG8gbm90IGNvbXBhcmUgY2xpZW50RGF0YUpTT04gYWdhaW5zdCBhIHRlbXBsYXRlLiBTZWUgaHR0cHM6Ly9nb28uZ2wveWFiUGV4In0", // Matches **host:8103
            "signature": "MEUCIQDPFYXxm-ALPZVuP4YdXBr1INrfObXR6hukxTttYNnegAIgEfy5MlnIi10VwmilOmuT1TuuDBLw9GDSv9DQuIRZXRE",
            "userHandle": "YzE3YzJjNjMtMTkxZi00MWZmLTlkNjEtYzBjOGVlMmVlMGQ0"
          },
          "type": "public-key",
          "clientExtensionResults": {},
          "authenticatorAttachment": "platform"
        },
        "code": code,
      },
    });

    expect(signinResponse.status).toBe(200);
    expect(signinResponse.body.user_id).toBe(expectedUserId);
  });

  it("should FAIL passkey registration with non-matching exact domain", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Sign up a user first
    await Auth.Password.signUpWithEmail();

    // Configure exact domain that doesn't match
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.exact': {
            baseUrl: 'https://app.production.com',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Initiate passkey registration
    const initiateResponse = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-registration", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(initiateResponse.status).toBe(200);
    const { code } = initiateResponse.body;

    // Try to register passkey with non-matching origin
    const registerResponse = await niceBackendFetch("/api/v1/auth/passkey/register", {
      method: "POST",
      accessType: "client",
      body: {
        "credential": {
          "id": "FAIL_TEST_ID",
          "rawId": "FAIL_TEST_ID",
          "response": {
            "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViYSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8",
            "clientDataJSON": btoa(JSON.stringify({
              type: "webauthn.create",
              challenge: "TU9DSw",
              origin: "http://localhost:8103", // Doesn't match https://app.production.com
              crossOrigin: false
            })),
            "transports": ["hybrid", "internal"],
            "publicKeyAlgorithm": -7,
            "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7skmKF73cIOFk48Wn2lV59nIG_LrYkyNKzjuJ3WrS-k0yMsBAbsRJipFmwFBtfTtZYgiYTNgUOwmAE5JiJBkvw",
            "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAQWGAfwysz2R5taOiCxqOkpP3AXpQECAyYgASFYIO7JJihe93CDhZOPFp9pVefZyBvy62JMjSs47id1q0vpIlggNMjLAQG7ESYqRZsBQbX07WWIImEzYFDsJgBOSYiQZL8"
          },
          "type": "public-key",
          "clientExtensionResults": {
            "credProps": {
              "rk": true
            }
          },
          "authenticatorAttachment": "platform"
        },
        "code": code,
      },
    });

    expect(registerResponse.status).toBe(400);
    expect(registerResponse.body).toMatchObject({
      code: "PASSKEY_REGISTRATION_FAILED",
      error: expect.stringContaining("origin is not allowed")
    });
  });

  it("should FAIL passkey sign-in with non-matching wildcard domain", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Sign up and register passkey with default localhost allowed
    const res = await Auth.Password.signUpWithEmail();
    await Auth.Passkey.register();
    await Auth.signOut();

    // Configure wildcard that doesn't match localhost
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.wildcard': {
            baseUrl: 'https://*.example.com',
            handlerPath: '/handler',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Initiate authentication
    const initiateResponse = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(initiateResponse.status).toBe(200);
    const { code } = initiateResponse.body;

    // Try to sign in with non-matching origin
    const signinResponse = await niceBackendFetch("/api/v1/auth/passkey/sign-in", {
      method: "POST",
      accessType: "client",
      body: {
        "authentication_response": {
          "id": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "rawId": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "response": {
            "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
            "clientDataJSON": btoa(JSON.stringify({
              type: "webauthn.get",
              challenge: "TU9DSw",
              origin: "http://localhost:8103", // Doesn't match *.example.com
              crossOrigin: false
            })),
            "signature": "MEUCIQDPFYXxm-ALPZVuP4YdXBr1INrfObXR6hukxTttYNnegAIgEfy5MlnIi10VwmilOmuT1TuuDBLw9GDSv9DQuIRZXRE",
            "userHandle": "YzE3YzJjNjMtMTkxZi00MWZmLTlkNjEtYzBjOGVlMmVlMGQ0"
          },
          "type": "public-key",
          "clientExtensionResults": {},
          "authenticatorAttachment": "platform"
        },
        "code": code,
      },
    });

    expect(signinResponse.status).toBe(400);
    expect(signinResponse.body).toMatchObject({
      code: "PASSKEY_AUTHENTICATION_FAILED",
      error: expect.stringContaining("origin is not allowed")
    });
  });

  it("should work with prefix wildcard pattern for passkey", async ({ expect }) => {
    await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });
    await InternalApiKey.createAndSetProjectKeys();

    // Sign up and register passkey with default localhost allowed
    const res = await Auth.Password.signUpWithEmail();
    await Auth.Passkey.register(); // This uses http://localhost:8103
    await Auth.signOut();

    // Configure wildcard that matches localhost
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.wildcard': {
            baseUrl: 'http://*:8103', // Will match localhost:8103
            handlerPath: '/',
          },
          'domains.allowLocalhost': false,
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Initiate authentication
    const initiateResponse = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(initiateResponse.status).toBe(200);
    const { code } = initiateResponse.body;

    // Sign in with matching prefix pattern
    const signinResponse = await niceBackendFetch("/api/v1/auth/passkey/sign-in", {
      method: "POST",
      accessType: "client",
      body: {
        "authentication_response": {
          "id": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "rawId": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
          "response": {
            "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
            "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiVFU5RFN3Iiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdDo4MTAzIiwiY3Jvc3NPcmlnaW4iOmZhbHNlLCJvdGhlcl9rZXlzX2Nhbl9iZV9hZGRlZF9oZXJlIjoiZG8gbm90IGNvbXBhcmUgY2xpZW50RGF0YUpTT04gYWdhaW5zdCBhIHRlbXBsYXRlLiBTZWUgaHR0cHM6Ly9nb28uZ2wveWFiUGV4In0", // Matches *:8103
            "signature": "MEUCIQDPFYXxm-ALPZVuP4YdXBr1INrfObXR6hukxTttYNnegAIgEfy5MlnIi10VwmilOmuT1TuuDBLw9GDSv9DQuIRZXRE",
            "userHandle": "YzE3YzJjNjMtMTkxZi00MWZmLTlkNjEtYzBjOGVlMmVlMGQ0"
          },
          "type": "public-key",
          "clientExtensionResults": {},
          "authenticatorAttachment": "platform"
        },
        "code": code,
      },
    });

    expect(signinResponse.status).toBe(200);
    expect(signinResponse.body).toHaveProperty("user_id");
  });

  it("should handle complex wildcard patterns correctly", async ({ expect }) => {
    const { adminAccessToken } = await Project.createAndSwitch({
      config: {
        passkey_enabled: true,
      }
    });

    // Configure complex wildcard patterns
    const configResponse = await niceBackendFetch("/api/v1/internal/config/override", {
      method: "PATCH",
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      body: {
        config_override_string: JSON.stringify({
          'domains.trustedDomains.complex1': {
            baseUrl: 'https://api-*.*.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.complex2': {
            baseUrl: 'https://**.api.example.com',
            handlerPath: '/handler',
          },
          'domains.trustedDomains.complex3': {
            baseUrl: 'https://*-staging.example.com',
            handlerPath: '/handler',
          },
        }),
      },
    });
    expect(configResponse.status).toBe(200);

    // Verify the complex patterns are stored correctly
    const getResponse = await niceBackendFetch("/api/v1/internal/config", {
      accessType: "admin",
      headers: {
        'x-stack-admin-access-token': adminAccessToken,
      },
      method: "GET",
    });
    expect(getResponse.status).toBe(200);

    const config = JSON.parse(getResponse.body.config_string);
    expect(config.domains.trustedDomains.complex1.baseUrl).toBe('https://api-*.*.example.com');
    expect(config.domains.trustedDomains.complex2.baseUrl).toBe('https://**.api.example.com');
    expect(config.domains.trustedDomains.complex3.baseUrl).toBe('https://*-staging.example.com');
  });
});
