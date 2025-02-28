// Define the types locally to avoid circular dependencies
interface TeamCreateOptions {
  displayName: string;
  clientMetadata?: Record<string, any> | null;
  serverMetadata?: Record<string, any> | null;
  clientReadOnlyMetadata?: Record<string, any> | null;
}

interface TeamUpdateOptions {
  displayName?: string;
  clientMetadata?: Record<string, any> | null;
  serverMetadata?: Record<string, any> | null;
  clientReadOnlyMetadata?: Record<string, any> | null;
}

export function teamCreateOptionsToCrud(options: TeamCreateOptions, userId?: string) {
  return {
    display_name: options.displayName,
    client_metadata: options.clientMetadata,
    server_metadata: options.serverMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    user_id: userId,
  };
}

export function teamUpdateOptionsToCrud(options: TeamUpdateOptions) {
  return {
    display_name: options.displayName,
    client_metadata: options.clientMetadata,
    server_metadata: options.serverMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
  };
}

export function serverUserCreateOptionsToCrud(options: any) {
  return {
    primary_email: options.email,
    display_name: options.displayName,
    password: options.password,
    client_metadata: options.clientMetadata,
    server_metadata: options.serverMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    requires_totp_mfa: options.requiresMultiFactor,
  };
}
