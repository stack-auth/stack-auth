import { stackServerApp } from '@/stack';
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

export async function GET() {
  const user = await stackServerApp.getUser({ or: 'throw' });

  if (!user.primaryEmail) {
    return NextResponse.json({ error: 'User must have a primary email for SSO' }, { status: 400 });
  }

  const payload = {
    name: user.displayName || user.primaryEmail.split('@')[0] || 'User',
    email: user.primaryEmail,
    userId: user.id,
    // Add optional fields as needed
  };

  const secret = process.env.FEATUREBASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'FEATUREBASE_JWT_SECRET not configured' }, { status: 500 });
  }

  const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

  return NextResponse.json({ token });
}
