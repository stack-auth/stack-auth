import { StackServerApp } from '@stackframe/js';
import { beforeAll, describe, expect } from 'vitest';
import { it } from '../helpers';
import { createApp } from './js-helpers';

describe('Data Vault Server Functions', () => {
  let serverApp: StackServerApp;
  let projectId: string;
  const testSecret = "test-secret";

  beforeAll(async () => {
    const { serverApp: app, adminApp } = await createApp();
    const project = await adminApp.getProject();
    await project.updateConfig({
      [`dataVault.stores.test-store`]: {
        displayName: 'Test Store',
      },
      [`dataVault.stores.api-keys`]: {
        displayName: 'API Keys',
      },
    });

    projectId = project.id;
    serverApp = app;
  }, 30_000);

  describe('getDataVaultStore', () => {
    it('should get a data vault store instance', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      expect(vault).toBeDefined();
      expect(vault).toHaveProperty('getValue');
      expect(vault).toHaveProperty('setValue');
    });

    it.todo('should throw error for non-existent store', async () => {
      // TODO: implement this
      await expect(
        serverApp.getDataVaultStore('non-existent-store')
      ).rejects.toThrow();
    });
  });

  describe('setValue and getValue', () => {
    it('should store and retrieve a simple string value', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `test-key-${Date.now()}`;
      const value = 'test-value-123';

      // Store the value
      await vault.setValue(key, value, { secret: testSecret });

      // Retrieve the value
      const retrievedValue = await vault.getValue(key, { secret: testSecret });
      expect(retrievedValue).toBe(value);
    });

    it('should store and retrieve JSON data', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `json-key-${Date.now()}`;
      const data = {
        apiKey: 'sk_test_123456',
        apiSecret: 'secret_789',
        metadata: {
          createdAt: new Date().toISOString(),
          environment: 'test',
        },
      };
      const value = JSON.stringify(data);

      // Store the JSON
      await vault.setValue(key, value, { secret: testSecret });

      // Retrieve and parse the JSON
      const retrievedValue = await vault.getValue(key, { secret: testSecret });
      expect(retrievedValue).toBe(value);
      expect(JSON.parse(retrievedValue!)).toEqual(data);
    });

    it('should return null for non-existent key', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `non-existent-key-${Date.now()}`;

      const value = await vault.getValue(key, { secret: testSecret });
      expect(value).toBeNull();
    });

    it('should handle large values', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `large-value-key-${Date.now()}`;
      // Create a large string (1MB)
      const largeValue = 'x'.repeat(1024 * 1024);

      await vault.setValue(key, largeValue, { secret: testSecret });
      const retrievedValue = await vault.getValue(key, { secret: testSecret });

      expect(retrievedValue).toBe(largeValue);
    });

    it('should return null when using wrong secret', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `wrong-secret-key-${Date.now()}`;
      const value = 'sensitive-data';
      const wrongSecret = 'wrong-secret';

      // Store with correct secret
      await vault.setValue(key, value, { secret: testSecret });

      // Try to retrieve with wrong secret
      const retrievedValue = await vault.getValue(key, { secret: wrongSecret });
      expect(retrievedValue).toBeNull();
    });

    it('should isolate data between stores', async () => {
      const vault1 = await serverApp.getDataVaultStore('test-store');
      const vault2 = await serverApp.getDataVaultStore('api-keys');
      const key = `shared-key-${Date.now()}`;
      const value1 = 'value-in-store-1';
      const value2 = 'value-in-store-2';

      // Store different values with same key in different stores
      await vault1.setValue(key, value1, { secret: testSecret });
      await vault2.setValue(key, value2, { secret: testSecret });

      // Retrieve from each store
      const retrieved1 = await vault1.getValue(key, { secret: testSecret });
      const retrieved2 = await vault2.getValue(key, { secret: testSecret });

      expect(retrieved1).toBe(value1);
      expect(retrieved2).toBe(value2);
      expect(retrieved1).not.toBe(retrieved2);
    });

    it('should overwrite existing value', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `overwrite-key-${Date.now()}`;
      const originalValue = 'original-value';
      const newValue = 'new-value';

      // Store original value
      await vault.setValue(key, originalValue, { secret: testSecret });
      let retrieved = await vault.getValue(key, { secret: testSecret });
      expect(retrieved).toBe(originalValue);

      // Overwrite with new value
      await vault.setValue(key, newValue, { secret: testSecret });
      retrieved = await vault.getValue(key, { secret: testSecret });
      expect(retrieved).toBe(newValue);
    });
  });

  describe('Special characters and edge cases', () => {
    it('should handle special characters in keys', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const specialKeys = [
        `key-with-spaces ${Date.now()}`,
        `key:with:colons:${Date.now()}`,
        `key/with/slashes/${Date.now()}`,
        `key.with.dots.${Date.now()}`,
        `key_with_underscores_${Date.now()}`,
        `key-with-unicode-😀-${Date.now()}`,
      ];

      for (const key of specialKeys) {
        const value = `value-for-${key}`;
        await vault.setValue(key, value, { secret: testSecret });
        const retrieved = await vault.getValue(key, { secret: testSecret });
        expect(retrieved).toBe(value);
      }
    });

    it('should handle special characters in values', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `special-value-key-${Date.now()}`;
      const specialValues = [
        'value with spaces',
        'value\nwith\nnewlines',
        'value\twith\ttabs',
        'value with "quotes"',
        "value with 'single quotes'",
        'value with unicode: 🔐 🗝️ 🔒',
        '{"json": "with special chars: \n\t\r"}',
        '<html><body>HTML content</body></html>',
      ];

      for (const value of specialValues) {
        const uniqueKey = `${key}-${specialValues.indexOf(value)}`;
        await vault.setValue(uniqueKey, value, { secret: testSecret });
        const retrieved = await vault.getValue(uniqueKey, { secret: testSecret });
        expect(retrieved).toBe(value);
      }
    });

    it('should handle empty string values', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `empty-value-key-${Date.now()}`;

      await vault.setValue(key, '', { secret: testSecret });
      const retrieved = await vault.getValue(key, { secret: testSecret });
      expect(retrieved).toBe('');
    });

    it('should handle very long keys', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      // Create a 1000 character key
      const longKey = 'k'.repeat(1000) + Date.now();
      const value = 'value-for-long-key';

      await vault.setValue(longKey, value, { secret: testSecret });
      const retrieved = await vault.getValue(longKey, { secret: testSecret });
      expect(retrieved).toBe(value);
    });
  });

  describe('Secret validation', () => {
    it('should require a secret', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `no-secret-key-${Date.now()}`;

      // @ts-expect-error - Testing missing secret
      await expect(vault.setValue(key, 'value', {})).rejects.toThrow();

      // @ts-expect-error - Testing missing secret
      await expect(vault.getValue(key, {})).rejects.toThrow();
    });

    it('should work with different secret formats', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const secrets = [
        'simple-string-secret',
        '',
        ' ∫√',
        'a'.repeat(256), // Very long secret
      ];

      for (const secret of secrets) {
        const key = `secret-format-key-${Date.now()}-${secrets.indexOf(secret)}`;
        const value = `value-for-secret-${secrets.indexOf(secret)}`;

        await vault.setValue(key, value, { secret });
        const retrieved = await vault.getValue(key, { secret });
        expect(retrieved).toBe(value);
      }
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent writes to different keys', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const operations = [];

      for (let i = 0; i < 10; i++) {
        const key = `concurrent-key-${i}`;
        const value = `concurrent-value-${i}`;
        operations.push(vault.setValue(key, value, { secret: testSecret }));
      }

      await Promise.all(operations);

      // Verify all values were stored correctly
      for (let i = 0; i < 10; i++) {
        const key = `concurrent-key-${i}`;
        const expectedValue = `concurrent-value-${i}`;
        const retrieved = await vault.getValue(key, { secret: testSecret });
        expect(retrieved).toBe(expectedValue);
      }
    });

    it('should handle concurrent reads', async () => {
      const vault = await serverApp.getDataVaultStore('test-store');
      const key = `concurrent-read-key`;
      const value = 'concurrent-read-value';

      // Store a value
      await vault.setValue(key, value, { secret: testSecret });

      // Perform concurrent reads
      const readOperations = [];
      for (let i = 0; i < 10; i++) {
        readOperations.push(vault.getValue(key, { secret: testSecret }));
      }

      const results = await Promise.all(readOperations);

      // All reads should return the same value
      results.forEach(result => {
        expect(result).toBe(value);
      });
    });
  });
});
