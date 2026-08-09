export function getWorkOSRedirectUri(): string {
  const redirectUri = process.env.WORKOS_REDIRECT_URI;
  if (redirectUri == null || redirectUri.length === 0) {
    throw new Error("Missing required environment variable: WORKOS_REDIRECT_URI");
  }
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("WORKOS_REDIRECT_URI must be a valid URL");
  }
  return redirectUri;
}

export function getWorkOSBaseUrl(): string {
  return new URL(getWorkOSRedirectUri()).origin;
}
