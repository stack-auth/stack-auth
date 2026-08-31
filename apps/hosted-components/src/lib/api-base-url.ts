export function getApiBaseUrlFromEnv(): string | undefined {
  const hexclaveValue = import.meta.env.VITE_HEXCLAVE_API_URL;
  const stackValue = import.meta.env.VITE_STACK_API_URL;
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error("Environment variables VITE_HEXCLAVE_API_URL and VITE_STACK_API_URL are both set to different values. Remove one of them or set them to the same value.");
  }
  return hexclaveValue || stackValue || undefined;
}
