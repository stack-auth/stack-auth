import * as jose from "jose";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  AGENT_AUTH_AGENT_JWT_TYP,
  AGENT_AUTH_HOST_JWT_TYP,
  AGENT_AUTH_JWS_ALG,
  AGENT_AUTH_JWK_CRV,
  AGENT_AUTH_MAX_AGENT_JWT_SECONDS,
} from "./constants";

export type AgentAuthPublicJwk = jose.JWK & {
  alg: typeof AGENT_AUTH_JWS_ALG,
  crv: typeof AGENT_AUTH_JWK_CRV,
  kid: string,
  use?: "sig",
};

export type AgentAuthPrivateJwk = jose.JWK & {
  alg: typeof AGENT_AUTH_JWS_ALG,
  crv: typeof AGENT_AUTH_JWK_CRV,
  kid: string,
  use?: "sig",
  d: string,
};

export type AgentAuthKeyPair = {
  publicJwk: AgentAuthPublicJwk,
  privateJwk: AgentAuthPrivateJwk,
  thumbprint: string,
  publicKey: CryptoKey,
  privateKey: CryptoKey,
};

export type VerifiedAgentAuthJwt = {
  thumbprint: string,
  payload: jose.JWTPayload,
};

function getJwtError(message: string): StatusError {
  return new StatusError(StatusError.Unauthorized, message);
}

function ensureEd25519PublicJwk(publicJwk: jose.JWK): AgentAuthPublicJwk {
  if (publicJwk.kty !== "OKP" || publicJwk.crv !== AGENT_AUTH_JWK_CRV || typeof publicJwk.x !== "string") {
    throw new HexclaveAssertionError("Expected an Ed25519 OKP public JWK");
  }
  return {
    ...publicJwk,
    alg: AGENT_AUTH_JWS_ALG,
    crv: AGENT_AUTH_JWK_CRV,
    kid: typeof publicJwk.kid === "string" && publicJwk.kid.length > 0 ? publicJwk.kid : "",
    use: "sig",
  };
}

export function normalizeAgentAuthPublicJwk(value: unknown): AgentAuthPublicJwk {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new HexclaveAssertionError("Expected an Ed25519 OKP public JWK");
  }
  return ensureEd25519PublicJwk(value as jose.JWK);
}

export async function getAgentAuthJwkThumbprint(publicJwk: AgentAuthPublicJwk): Promise<string> {
  return await jose.calculateJwkThumbprint(publicJwk);
}

export async function generateAgentAuthKeyPair(): Promise<AgentAuthKeyPair> {
  const { publicKey, privateKey } = await jose.generateKeyPair(AGENT_AUTH_JWS_ALG, { crv: AGENT_AUTH_JWK_CRV });
  const publicJwk = ensureEd25519PublicJwk(await jose.exportJWK(publicKey));
  const thumbprint = await jose.calculateJwkThumbprint(publicJwk);
  const publicJwkWithKid = { ...publicJwk, kid: thumbprint };
  const privateJwk = {
    ...await jose.exportJWK(privateKey),
    alg: AGENT_AUTH_JWS_ALG,
    crv: AGENT_AUTH_JWK_CRV,
    kid: thumbprint,
    use: "sig" as const,
  } as AgentAuthPrivateJwk;

  return {
    publicJwk: publicJwkWithKid,
    privateJwk,
    thumbprint,
    publicKey,
    privateKey,
  };
}

export async function signHostJwt(options: {
  privateKey: CryptoKey,
  publicJwk: AgentAuthPublicJwk,
  audience: string,
  expiresInSeconds?: number,
  additionalClaims?: Record<string, unknown>,
}): Promise<string> {
  const thumbprint = await jose.calculateJwkThumbprint(options.publicJwk);
  const kid = options.publicJwk.kid || thumbprint;
  return await new jose.SignJWT(options.additionalClaims ?? {})
    .setProtectedHeader({ alg: AGENT_AUTH_JWS_ALG, typ: AGENT_AUTH_HOST_JWT_TYP, kid })
    .setIssuer(thumbprint)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds ?? 5 * 60}s`)
    .sign(options.privateKey);
}

export async function signAgentJwt(options: {
  privateKey: CryptoKey,
  publicJwk: AgentAuthPublicJwk,
  audience: string,
  expiresInSeconds?: number,
  additionalClaims?: Record<string, unknown>,
}): Promise<string> {
  const thumbprint = await jose.calculateJwkThumbprint(options.publicJwk);
  const kid = options.publicJwk.kid || thumbprint;
  return await new jose.SignJWT(options.additionalClaims ?? {})
    .setProtectedHeader({ alg: AGENT_AUTH_JWS_ALG, typ: AGENT_AUTH_AGENT_JWT_TYP, kid })
    .setIssuer(thumbprint)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds ?? AGENT_AUTH_MAX_AGENT_JWT_SECONDS}s`)
    .sign(options.privateKey);
}

async function verifyJwtAgainstPublicJwk(options: {
  jwt: string,
  publicJwk: AgentAuthPublicJwk,
  expectedTyp: typeof AGENT_AUTH_HOST_JWT_TYP | typeof AGENT_AUTH_AGENT_JWT_TYP,
  audience: string,
  maxLifetimeSeconds?: number,
}): Promise<VerifiedAgentAuthJwt> {
  const header = jose.decodeProtectedHeader(options.jwt);
  if (header.alg !== AGENT_AUTH_JWS_ALG) {
    throw getJwtError("invalid_agent_token");
  }
  if (header.typ !== options.expectedTyp) {
    throw getJwtError("invalid_agent_token");
  }

  const thumbprint = await jose.calculateJwkThumbprint(options.publicJwk);
  const importedKey = await jose.importJWK(options.publicJwk, AGENT_AUTH_JWS_ALG);
  const { payload } = await jose.jwtVerify(options.jwt, importedKey, {
    audience: options.audience,
    issuer: thumbprint,
    algorithms: [AGENT_AUTH_JWS_ALG],
  });

  if (payload.aud !== options.audience) {
    throw getJwtError("invalid_agent_token");
  }
  if (payload.iss !== thumbprint) {
    throw getJwtError("invalid_agent_token");
  }

  if (options.maxLifetimeSeconds != null) {
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp - payload.iat > options.maxLifetimeSeconds) {
      throw getJwtError("invalid_agent_token");
    }
  }

  return {
    thumbprint,
    payload,
  };
}

export async function verifyHostJwt(options: {
  jwt: string,
  publicJwk: AgentAuthPublicJwk,
  audience: string,
}): Promise<VerifiedAgentAuthJwt> {
  return await verifyJwtAgainstPublicJwk({
    jwt: options.jwt,
    publicJwk: options.publicJwk,
    expectedTyp: AGENT_AUTH_HOST_JWT_TYP,
    audience: options.audience,
  });
}

export async function verifyAgentJwt(options: {
  jwt: string,
  publicJwk: AgentAuthPublicJwk,
  audience: string,
}): Promise<VerifiedAgentAuthJwt> {
  return await verifyJwtAgainstPublicJwk({
    jwt: options.jwt,
    publicJwk: options.publicJwk,
    expectedTyp: AGENT_AUTH_AGENT_JWT_TYP,
    audience: options.audience,
    maxLifetimeSeconds: AGENT_AUTH_MAX_AGENT_JWT_SECONDS,
  });
}
