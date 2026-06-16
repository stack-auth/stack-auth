export function resolveInlineRenamedEnvVar(hexclaveName: string, stackName: string, hexclaveValue: string | undefined, stackValue: string | undefined): string | undefined {
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}
