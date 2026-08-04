type SentryReleaseEnvironment = Readonly<Record<string, string | undefined>>;

export function getSentryRelease(input: {
  packageName: string,
  packageVersion: string,
  environment?: SentryReleaseEnvironment,
}): string {
  const environment = input.environment ?? process.env;
  // Only use identifiers available to both the bundler and the deployed
  // process. Cloud Run's K_REVISION is runtime-only, so using it here would
  // separate events from the source maps uploaded while building the image.
  return environment.SENTRY_RELEASE
    ?? environment.VERCEL_GIT_COMMIT_SHA
    ?? environment.GITHUB_SHA
    ?? `${input.packageName}@${input.packageVersion}`.replace(/[/\s]/g, "-");
}
