import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

async function createDataVaultEnabledProject() {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });
  // Configure data vault stores after project creation
  await Project.updateConfig({
    dataVault: {
      stores: {
        "test-store-1": { displayName: "Test Store 1" },
        "test-store-update": { displayName: "Test Store Update" },
        "test-store-404": { displayName: "Test Store 404" },
        "store-1": { displayName: "Store 1" },
        "store-2": { displayName: "Store 2" },
        "multi-key-store": { displayName: "Multi Key Store" },
        "auth-test-store": { displayName: "Auth Test Store" },
      }
    }
  });
}

async function createDataVaultDisabledProject() {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });
  // Don't configure any data vault stores
}

function hashKey(key: string): string {
  // we don't actually need to hash the key here, so let's keep it simple
  return `hashed(${key})`;
}

it("can store and retrieve values from data vault", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  const storeId = "test-store-1";
  const key = "my-secret-key";
  const hashedKey = hashKey(key);
  const encryptedValue = "encrypted-secret-value-123";

  // Store a value
  const setResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: encryptedValue,
    },
  });

  expect(setResponse.status).toBe(200);
  expect(setResponse.body).toMatchObject({
    success: true,
  });

  // Retrieve the value
  const getResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getResponse.status).toBe(200);
  expect(getResponse.body).toMatchObject({
    encrypted_value: encryptedValue,
  });
});

it("can update existing values in data vault", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  const storeId = "test-store-update";
  const key = "update-key";
  const hashedKey = hashKey(key);
  const firstValue = "first-value";
  const updatedValue = "updated-value";

  // Store initial value
  const firstSetResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: firstValue,
    },
  });

  expect(firstSetResponse.status).toBe(200);
  const firstId = firstSetResponse.body.id;

  // Update the value
  const updateResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: updatedValue,
    },
  });

  expect(updateResponse.status).toBe(200);
  // ID should remain the same when updating
  expect(updateResponse.body.id).toBe(firstId);

  // Verify the updated value
  const getResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "encrypted_value": "updated-value" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("returns 400 when trying to get non-existent value", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  const storeId = "test-store-404";
  const hashedKey = hashKey("non-existent-key");

  const getResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "DATA_VAULT_STORE_HASHED_KEY_DOES_NOT_EXIST",
        "details": {
          "hashed_key": "hashed(non-existent-key)",
          "store_id": "test-store-404",
        },
        "error": "Data vault store with ID test-store-404 does not contain a key with hash hashed(non-existent-key).",
      },
      "headers": Headers {
        "x-stack-known-error": "DATA_VAULT_STORE_HASHED_KEY_DOES_NOT_EXIST",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("validates required fields", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  // Test empty store ID (by using spaces which get trimmed)
  const emptyStoreResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${encodeURIComponent("  ")}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: "valid-hash",
      encrypted_value: "valid-value",
    },
  });

  expect(emptyStoreResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "DATA_VAULT_STORE_DOES_NOT_EXIST",
        "details": { "store_id": "  " },
        "error": "Data vault store with ID    does not exist.",
      },
      "headers": Headers {
        "x-stack-known-error": "DATA_VAULT_STORE_DOES_NOT_EXIST",
        <some fields may have been hidden>,
      },
    }
  `);

  // Test empty hashed key
  const emptyHashResponse = await niceBackendFetch(`/api/latest/data-vault/stores/valid-store/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: "",
      encrypted_value: "valid-value",
    },
  });

  expect(emptyHashResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/latest/data-vault/stores/valid-store/set:
              - body.hashed_key must not be empty
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/latest/data-vault/stores/valid-store/set:
            - body.hashed_key must not be empty
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);

  // Test empty encrypted value
  const emptyValueResponse = await niceBackendFetch(`/api/latest/data-vault/stores/test-store-1/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: "valid-hash",
      encrypted_value: "",
    },
  });

  expect(emptyValueResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Test empty hashed key for get
  const getEmptyHashResponse = await niceBackendFetch(`/api/latest/data-vault/stores/valid-store/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: "",
    },
  });

  expect(getEmptyHashResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/latest/data-vault/stores/valid-store/get:
              - body.hashed_key must not be empty
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/latest/data-vault/stores/valid-store/get:
            - body.hashed_key must not be empty
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("isolates data between different stores", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  const key = "shared-key";
  const hashedKey = hashKey(key);
  const store1Id = "store-1";
  const store2Id = "store-2";
  const value1 = "value-for-store-1";
  const value2 = "value-for-store-2";

  // Set value in store 1
  await niceBackendFetch(`/api/latest/data-vault/stores/${store1Id}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: value1,
    },
  });

  // Set value in store 2 with same key
  await niceBackendFetch(`/api/latest/data-vault/stores/${store2Id}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: value2,
    },
  });

  // Get from store 1
  const getStore1Response = await niceBackendFetch(`/api/latest/data-vault/stores/${store1Id}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getStore1Response.status).toBe(200);
  expect(getStore1Response.body.encrypted_value).toBe(value1);

  // Get from store 2
  const getStore2Response = await niceBackendFetch(`/api/latest/data-vault/stores/${store2Id}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getStore2Response.status).toBe(200);
  expect(getStore2Response.body.encrypted_value).toBe(value2);
});

it("handles multiple keys in the same store", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  await Auth.Otp.signIn();

  const storeId = "multi-key-store";
  const key1 = "key-1";
  const key2 = "key-2";
  const hashedKey1 = hashKey(key1);
  const hashedKey2 = hashKey(key2);
  const value1 = "value-1";
  const value2 = "value-2";

  // Set first key-value pair
  await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey1,
      encrypted_value: value1,
    },
  });

  // Set second key-value pair
  await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey2,
      encrypted_value: value2,
    },
  });

  // Get first value
  const getResponse1 = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey1,
    },
  });

  expect(getResponse1.status).toBe(200);
  expect(getResponse1.body.encrypted_value).toBe(value1);

  // Get second value
  const getResponse2 = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey2,
    },
  });

  expect(getResponse2.status).toBe(200);
  expect(getResponse2.body.encrypted_value).toBe(value2);
});

it("requires authentication", async ({ expect }: { expect: any }) => {
  await createDataVaultEnabledProject();
  // Don't sign in

  const storeId = "auth-test-store";
  const hashedKey = hashKey("test-key");

  // Try to set without auth
  const setResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/set`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
      encrypted_value: "test-value",
    },
  });

  expect(setResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to get without auth
  const getResponse = await niceBackendFetch(`/api/latest/data-vault/stores/${storeId}/get`, {
    method: "POST",
    accessType: "server",
    body: {
      hashed_key: hashedKey,
    },
  });

  expect(getResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "encrypted_value": "test-value" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
