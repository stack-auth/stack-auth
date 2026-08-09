import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import Database from "better-sqlite3";

const database = new Database("./better-auth.db");
database.exec(`
  create table if not exists "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
  create table if not exists "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
  create table if not exists "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
  create table if not exists "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
  create table if not exists "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" date not null, "expiresAt" date);
  create index if not exists "session_userId_idx" on "session" ("userId");
  create index if not exists "account_userId_idx" on "account" ("userId");
  create index if not exists "verification_identifier_idx" on "verification" ("identifier");
`);

export const auth = betterAuth({
  database,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:8111",
  secret: process.env.BETTER_AUTH_SECRET ?? "local-only-better-auth-secret",
  emailAndPassword: { enabled: true },
  plugins: [
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL ?? "http://localhost:8111",
        audience: "better-auth-integration-demo",
        definePayload: ({ user, session }) => ({
          sub: user.id,
          email: user.email,
          name: user.name,
          sid: session.id,
        }),
      },
    }),
  ],
});
