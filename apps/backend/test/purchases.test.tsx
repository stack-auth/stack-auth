import { describe, test, expect } from 'vitest';
import { niceBackendFetch } from '../../e2e/tests/backend/backend-helpers';
import { Auth } from '../../e2e/tests/backend/backend-helpers';

describe('Purchases endpoint', () => {
  test('creates a purchase URL', async () => {
    // Sign in a user first
    await Auth.Otp.signIn();

    const response = await niceBackendFetch('/api/latest/users/me/purchases', {
      method: 'POST',
      accessType: 'client',
      body: { product_id: 'test-product' }
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('purchase_url');
    expect(typeof response.body.purchase_url).toBe('string');
  });

  test('requires authentication', async () => {
    // No authentication
    const response = await niceBackendFetch('/api/latest/users/me/purchases', {
      method: 'POST',
      accessType: 'client',
      body: { product_id: 'test-product' }
    });

    expect(response.status).toBe(401);
  });

  test('requires product_id', async () => {
    // Sign in a user first
    await Auth.Otp.signIn();

    const response = await niceBackendFetch('/api/latest/users/me/purchases', {
      method: 'POST',
      accessType: 'client',
      body: {}
    });

    expect(response.status).toBe(400);
  });
});