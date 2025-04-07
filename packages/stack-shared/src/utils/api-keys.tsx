import { getBase32CharacterFromIndex } from "@stackframe/stack-shared/dist/utils/bytes";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import crc32 from 'crc/crc32';


const STACK_AUTH_MARKER = "574ck4u7h";

// API key part lengths
const API_KEY_LENGTHS = {
  SECRET_PART: 45,
  ID_PART: 32,
  TYPE_PART: 4,
  SCANNER_AND_MARKER: 10,
  CHECKSUM: 8,
} as const;

/**
 * An api key has the following format:
 * <prefix_without_underscores>_<secret_part_45_chars><id_part_32_chars><type_user_or_team_4_chars><scanner_and_marker_10_chars><checksum_8_chars>
 *
 * The scanner and marker is a base32 character that is used to determine if the api key is a public or private key
 * and if it is a cloud or self-hosted key.
 *
 * The checksum is a crc32 checksum of the api key encoded in hex.
 *
 */

type ProjectApiKey = {
  id: string,
  prefix: string,
  isPublic: boolean,
  isCloudVersion: boolean,
  secret: string,
  checksum: string,
  type: "user" | "team",
}


function createChecksumSync(checksummablePart: string): string {
  const data = new TextEncoder().encode(checksummablePart);
  const calculated_checksum = crc32(data);
  return calculated_checksum.toString(16).padStart(8, "0");
}

function createApiKeyParts(options: Pick<ProjectApiKey, "id" | "isPublic" | "isCloudVersion" | "type">) {
  const { id, isPublic, isCloudVersion, type } = options;
  const prefix = isPublic ? "pk" : "sk";
  const scannerFlag = (isCloudVersion ? 0 : 1) + (isPublic ? 2 : 0) + (/* version */ 0);

  const secretPart = generateSecureRandomString();
  const idPart = id.replace(/-/g, "");
  const scannerAndMarker = getBase32CharacterFromIndex(scannerFlag).toLowerCase() + STACK_AUTH_MARKER;
  const checksummablePart = `${prefix}_${secretPart}${idPart}${type}${scannerAndMarker}`;

  return { checksummablePart, idPart, prefix, scannerAndMarker, type };
}


function parseApiKeyParts(secret: string) {
  const regex = new RegExp(
    `^([^_]+)_` + // prefix
    `(.{${API_KEY_LENGTHS.SECRET_PART}})` + // secretPart
    `(.{${API_KEY_LENGTHS.ID_PART}})` + // idPart
    `(.{${API_KEY_LENGTHS.TYPE_PART}})` + // type
    `(.{${API_KEY_LENGTHS.SCANNER_AND_MARKER}})` + // scannerAndMarker
    `(.{${API_KEY_LENGTHS.CHECKSUM}})$` // checksum
  );

  const match = secret.match(regex);
  if (!match) {
    throw new StackAssertionError("Invalid API key format");
  }

  const [, prefix, secretPart, idPart, type, scannerAndMarker, checksum] = match;

  const scannerFlag = scannerAndMarker.replace(STACK_AUTH_MARKER, "");
  const isCloudVersion = parseInt(scannerFlag, 32) % 2 === 0;
  const isPublic = (parseInt(scannerFlag, 32) & 2) !== 0;

  const checksummablePart = `${prefix}_${secretPart}${idPart}${type}${scannerAndMarker}`;
  const restored_id = idPart.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

  if (!["user", "team"].includes(type)) {
    throw new StackAssertionError("Invalid type");
  }

  return { checksummablePart, checksum, id: restored_id, isCloudVersion, isPublic, prefix, type: type as "user" | "team" };
}


export function isApiKey(secret: string): boolean {
  return secret.includes("_") && secret.includes(STACK_AUTH_MARKER);
}

export function createProjectApiKey(options: Pick<ProjectApiKey, "id" | "isPublic" | "isCloudVersion" | "type">): string {
  const { checksummablePart } = createApiKeyParts(options);
  const checksum = createChecksumSync(checksummablePart);
  return `${checksummablePart}${checksum}`;
}


export function parseProjectApiKey(secret: string): ProjectApiKey {
  const { checksummablePart, checksum, id, isCloudVersion, isPublic, prefix, type } = parseApiKeyParts(secret);
  const calculated_checksum = createChecksumSync(checksummablePart);

  if (calculated_checksum !== checksum) {
    throw new StackAssertionError("Checksum mismatch");
  }

  return {
    id,
    prefix,
    isPublic,
    isCloudVersion,
    secret,
    checksum,
    type,
  };
}

