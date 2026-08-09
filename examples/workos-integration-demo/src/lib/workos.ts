export function getWorkOSRedirectUri(): string {
  const redirectUri = process.env.WORKOS_REDIRECT_URI;
  if (redirectUri == null || redirectUri.length === 0) {
    throw new Error("Missing required environment variable: WORKOS_REDIRECT_URI");
  }
  try {
    new URL(redirectUri);
  } catch {
    throw new Error("WORKOS_REDIRECT_URI must be a valid URL");
  }
  return redirectUri;
}

export function getWorkOSBaseUrl(): string {
  return new URL(getWorkOSRedirectUri()).origin;
}
