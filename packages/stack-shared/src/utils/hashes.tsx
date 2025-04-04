import bcrypt from 'bcrypt';
import { StackAssertionError } from './errors';

export async function sha512(input: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
}

export async function hashPassword(password: string) {
  const passwordBytes = new TextEncoder().encode(password);
  if (passwordBytes.length >= 72) {
    throw new StackAssertionError(`Password is too long for bcrypt`, { len: passwordBytes.length });
  }
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  switch (await getPasswordHashAlgorithm(hash)) {
    case "bcrypt": {
      return await bcrypt.compare(password, hash);
    }
    default: {
      return false;
    }
  }
}

export async function isPasswordHashValid(hash: string) {
  return !!(await getPasswordHashAlgorithm(hash));
}

export async function getPasswordHashAlgorithm(hash: string): Promise<"bcrypt" | undefined> {
  if (typeof hash !== "string") {
    throw new StackAssertionError(`Passed non-string value to getPasswordHashAlgorithm`, { hash });
  }
  if (hash.match(/^\$2[ayb]\$.{56}$/)) {
    try {
      if (bcrypt.getRounds(hash) > 16) {
        return undefined;
      }
      await bcrypt.compare("any string", hash);
      return "bcrypt";
    } catch (e) {
      console.warn(`Error while checking bcrypt password hash. Assuming the hash is invalid`, e);
      return undefined;
    }
  } else {
    return undefined;
  }
}
