import { stackServerApp } from '@/stack';
import jwt from 'jsonwebtoken';
import { redirect } from 'next/navigation';

import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Featurebase SSO',
};

export default async function FeaturebaseSSO({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const user = await stackServerApp.getUser({ or: 'redirect' });

  if (!user.primaryEmail) {
    throw new Error('User must have a primary email for SSO');
  }

  const payload = {
    name: user.displayName || user.primaryEmail.split('@')[0] || 'User',
    email: user.primaryEmail,
    userId: user.id,
    // Add optional fields as needed, e.g.
    // profilePicture: user.profileImageUrl,
    // companies: [...]
  };

  const secret = process.env.FEATUREBASE_JWT_SECRET;
  if (!secret) {
    throw new Error('FEATUREBASE_JWT_SECRET environment variable is not set');
  }

  const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

  const slug = process.env.FEATUREBASE_SLUG;
  if (!slug) {
    throw new Error('FEATUREBASE_SLUG environment variable is not set');
  }

  const defaultRedirect = process.env.FEATUREBASE_DEFAULT_REDIRECT || `https://${slug}.featurebase.app/`;
  const redirectTo = typeof searchParams.redirect_to === 'string' ? searchParams.redirect_to : defaultRedirect;

  const ssoUrl = `https://${slug}.featurebase.app/api/v1/${slug}/sso?jwt=${token}&redirect_to=${encodeURIComponent(redirectTo)}`;

  return redirect(ssoUrl);
}
