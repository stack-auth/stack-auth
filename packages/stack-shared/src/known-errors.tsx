import { StackAssertionError, StatusError, throwErr } from "./utils/errors";
import { identityArgs } from "./utils/functions";
import { Json } from "./utils/json";
import { deindent } from "./utils/strings";

export type KnownErrorJson = {
  code: string,
  message: string,
  details?: Json,
};

export type AbstractKnownErrorConstructor<Args extends any[]> =
  & (abstract new (...args: Args) => KnownError)
  & {
    constructorArgsFromJson: (json: KnownErrorJson) => Args,
  };

export type KnownErrorConstructor<SuperInstance extends KnownError, Args extends any[]> = {
  new (...args: Args): SuperInstance & { constructorArgs: Args },
  errorCode: string,
  constructorArgsFromJson: (json: KnownErrorJson) => Args,
};

export abstract class KnownError extends StatusError {
  public name = "KnownError";

  constructor(
    public readonly statusCode: number,
    public readonly humanReadableMessage: string,
    public readonly details?: Json,
  ) {
    super(
      statusCode,
      humanReadableMessage
    );
  }

  public override getBody(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(this.toDescriptiveJson(), undefined, 2));
  }

  public override getHeaders(): Record<string, string[]> {
    return {
      "Content-Type": ["application/json; charset=utf-8"],
      "X-Stack-Known-Error": [this.errorCode],
    };
  }

  public override toDescriptiveJson(): Json {
    return {
      code: this.errorCode,
      ...this.details ? { details: this.details } : {},
      error: this.humanReadableMessage,
    };
  }

  get errorCode(): string {
    return (this.constructor as any).errorCode ?? throwErr(`Can't find error code for this KnownError. Is its constructor a KnownErrorConstructor? ${this}`);
  }

  public static constructorArgsFromJson(json: KnownErrorJson): ConstructorParameters<typeof KnownError> {
    return [
      400,
      json.message,
      json,
    ];
  }

  public static fromJson(json: KnownErrorJson): KnownError {
    for (const [_, KnownErrorType] of Object.entries(KnownErrors)) {
      if (json.code === KnownErrorType.prototype.errorCode) {
        const constructorArgs = KnownErrorType.constructorArgsFromJson(json);
        return new KnownErrorType(
          // @ts-expect-error
          ...constructorArgs,
        );
      }
    }

    throw new Error(`Unknown KnownError code. You may need to update your version of Stack to see more detailed information. ${json.code}: ${json.message}`);
  }
}

const knownErrorConstructorErrorCodeSentinel = Symbol("knownErrorConstructorErrorCodeSentinel");
/**
 * Exists solely so that known errors are nominative types (ie. two KnownErrors with the same interface are not the same type)
 */
type KnownErrorBrand<ErrorCode extends string> = {
  /**
   * Does not exist at runtime
   *
   * Must be an object because it may be true for multiple error codes (it's true for all parents)
   */
  [knownErrorConstructorErrorCodeSentinel]: {
    [K in ErrorCode]: true
  },
};

function createKnownErrorConstructor<ErrorCode extends string, Super extends AbstractKnownErrorConstructor<any>, Args extends any[]>(
  SuperClass: Super,
  errorCode: ErrorCode,
  create: ((...args: Args) => Readonly<ConstructorParameters<Super>>),
  constructorArgsFromJson: ((jsonDetails: any) => Args),
): KnownErrorConstructor<InstanceType<Super> & KnownErrorBrand<ErrorCode>, Args> & { errorCode: ErrorCode };
function createKnownErrorConstructor<ErrorCode extends string, Super extends AbstractKnownErrorConstructor<any>>(
  SuperClass: Super,
  errorCode: ErrorCode,
  create: "inherit",
  constructorArgsFromJson: "inherit",
): KnownErrorConstructor<InstanceType<Super> & KnownErrorBrand<ErrorCode>, ConstructorParameters<Super>> & { errorCode: ErrorCode };
function createKnownErrorConstructor<ErrorCode extends string, Super extends AbstractKnownErrorConstructor<any>, Args extends any[]>(
  SuperClass: Super,
  errorCode: ErrorCode,
  create: "inherit" | ((...args: Args) => Readonly<ConstructorParameters<Super>>),
  constructorArgsFromJson: "inherit" | ((jsonDetails: any) => Args),
): KnownErrorConstructor<InstanceType<Super> & KnownErrorBrand<ErrorCode>, Args> & { errorCode: ErrorCode } {
  const createFn = create === "inherit" ? identityArgs<Args> as never : create;
  const constructorArgsFromJsonFn = constructorArgsFromJson === "inherit" ? SuperClass.constructorArgsFromJson as never : constructorArgsFromJson;

  // @ts-expect-error this is not a mixin, but TS detects it as one
  class KnownErrorImpl extends SuperClass {
    public static readonly errorCode = errorCode;
    public name = `KnownError<${errorCode}>`;
    public readonly constructorArgs: Args;

    constructor(...args: Args) {
      // @ts-expect-error DEVIN, STOP REMOVING THIS LINE YOU DUMBASS, YES TYPESCRIPT DOES THROW AN ERROR IF YOU DON'T HAVE IT, NO THIS IS NOT "UNUSED", AND YES YOU ARE BREAKING OUR CI PIPELINE EVERY TIME YOU DO IT
      super(...createFn(...args));
      this.constructorArgs = args;
    }

    static constructorArgsFromJson(json: KnownErrorJson): Args {
      return constructorArgsFromJsonFn(json.details);
    }
  };

  // @ts-expect-error
  return KnownErrorImpl;
}

const UnsupportedError = createKnownErrorConstructor(
  KnownError,
  "UNSUPPORTED_ERROR",
  (originalErrorCode: string) => [
    500,
    `An error occurred that is not currently supported (possibly because it was added in a version of Stack that is newer than this client). The original unsupported error code was: ${originalErrorCode}`,
    {
      originalErrorCode,
    },
  ] as const,
  (json) => [
    (json as any)?.originalErrorCode ?? throwErr("originalErrorCode not found in UnsupportedError details"),
  ] as const,
);

const BodyParsingError = createKnownErrorConstructor(
  KnownError,
  "BODY_PARSING_ERROR",
  (message: string) => [
    400,
    message,
  ] as const,
  (json) => [json.message] as const,
);

const SchemaError = createKnownErrorConstructor(
  KnownError,
  "SCHEMA_ERROR",
  (message: string) => [
    400,
    message || throwErr("SchemaError requires a message"),
    {
      message,
    },
  ] as const,
  (json: any) => [json.message] as const,
);

const AllOverloadsFailed = createKnownErrorConstructor(
  KnownError,
  "ALL_OVERLOADS_FAILED",
  (overloadErrors: Json[]) => [
    400,
    deindent`
      This endpoint has multiple overloads, but they all failed to process the request.

        ${overloadErrors.map((e, i) => deindent`
          Overload ${i + 1}: ${JSON.stringify(e, undefined, 2)}
        `).join("\n\n")}
    `,
    {
      overload_errors: overloadErrors,
    },
  ] as const,
  (json) => [
    (json as any)?.overload_errors ?? throwErr("overload_errors not found in AllOverloadsFailed details"),
  ] as const,
);

const ProjectAuthenticationError = createKnownErrorConstructor(
  KnownError,
  "PROJECT_AUTHENTICATION_ERROR",
  "inherit",
  "inherit",
);

const InvalidProjectAuthentication = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "INVALID_PROJECT_AUTHENTICATION",
  "inherit",
  "inherit",
);

const ProjectKeyWithoutAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "PROJECT_KEY_WITHOUT_ACCESS_TYPE",
  () => [
    400,
    "Either an API key or an admin access token was provided, but the x-stack-access-type header is missing. Set it to 'client', 'server', or 'admin' as appropriate.",
  ] as const,
  () => [] as const,
);

const InvalidAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_ACCESS_TYPE",
  (accessType: string) => [
    400,
    `The x-stack-access-type header must be 'client', 'server', or 'admin', but was '${accessType}'.`,
  ] as const,
  (json) => [
    (json as any)?.accessType ?? throwErr("accessType not found in InvalidAccessType details"),
  ] as const,
);

const AccessTypeWithoutProjectId = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "ACCESS_TYPE_WITHOUT_PROJECT_ID",
  (accessType: "client" | "server" | "admin") => [
    400,
    deindent`
      The x-stack-access-type header was '${accessType}', but the x-stack-project-id header was not provided.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `,
    {
      request_type: accessType,
    },
  ] as const,
  (json: any) => [json.request_type] as const,
);

const AccessTypeRequired = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "ACCESS_TYPE_REQUIRED",
  () => [
    400,
    deindent`
      You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `,
  ] as const,
  () => [] as const,
);

const InsufficientAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INSUFFICIENT_ACCESS_TYPE",
  (actualAccessType: "client" | "server" | "admin", allowedAccessTypes: ("client" | "server" | "admin")[]) => [
    401,
    `The x-stack-access-type header must be ${allowedAccessTypes.map(s => `'${s}'`).join(" or ")}, but was '${actualAccessType}'.`,
    {
      actual_access_type: actualAccessType,
      allowed_access_types: allowedAccessTypes,
    },
  ] as const,
  (json: any) => [
    json.actual_access_type,
    json.allowed_access_types,
  ] as const,
);

const InvalidPublishableClientKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_PUBLISHABLE_CLIENT_KEY",
  (projectId: string) => [
    401,
    `The publishable key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId,
    },
  ] as const,
  (json: any) => [json.project_id] as const,
);

const InvalidSecretServerKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_SECRET_SERVER_KEY",
  (projectId: string) => [
    401,
    `The secret server key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId,
    },
  ] as const,
  (json: any) => [json.project_id] as const,
);

const InvalidSuperSecretAdminKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_SUPER_SECRET_ADMIN_KEY",
  (projectId: string) => [
    401,
    `The super secret admin key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId,
    },
  ] as const,
  (json: any) => [json.project_id] as const,
);

const InvalidAdminAccessToken = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_ADMIN_ACCESS_TOKEN",
  "inherit",
  "inherit",
);

const UnparsableAdminAccessToken = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "UNPARSABLE_ADMIN_ACCESS_TOKEN",
  () => [
    401,
    "Admin access token is not parsable.",
  ] as const,
  () => [] as const,
);

const AdminAccessTokenExpired = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "ADMIN_ACCESS_TOKEN_EXPIRED",
  (expiredAt: Date | undefined) => [
    401,
    `Admin access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)`: ""}`,
    { expired_at_millis: expiredAt?.getTime() ?? null },
  ] as const,
  (json: any) => [json.expired_at_millis ?? undefined] as const,
);

const InvalidProjectForAdminAccessToken = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "INVALID_PROJECT_FOR_ADMIN_ACCESS_TOKEN",
  () => [
    401,
    "Admin access tokens must be created on the internal project.",
  ] as const,
  () => [] as const,
);

const AdminAccessTokenIsNotAdmin = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "ADMIN_ACCESS_TOKEN_IS_NOT_ADMIN",
  () => [
    401,
    "Admin access token does not have the required permissions to access this project.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const ProjectAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "PROJECT_AUTHENTICATION_REQUIRED",
  "inherit",
  "inherit",
);


/**
 * @deprecated Use InsufficientAccessType instead
 */
const ClientAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The publishable client key must be provided.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const ServerAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "SERVER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The secret server key must be provided.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const ClientOrServerAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_SERVER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key or the secret server key must be provided.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const ClientOrAdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key or the super secret admin key must be provided.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const ClientOrServerOrAdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_SERVER_OR_ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key, the secret server key, or the super secret admin key must be provided.",
  ] as const,
  () => [] as const,
);

/**
 * @deprecated Use InsufficientAccessType instead
 */
const AdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The super secret admin key must be provided.",
  ] as const,
  () => [] as const,
);

const ExpectedInternalProject = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "EXPECTED_INTERNAL_PROJECT",
  () => [
    401,
    "The project ID is expected to be internal.",
  ] as const,
  () => [] as const,
);

const SessionAuthenticationError = createKnownErrorConstructor(
  KnownError,
  "SESSION_AUTHENTICATION_ERROR",
  "inherit",
  "inherit",
);

const InvalidSessionAuthentication = createKnownErrorConstructor(
  SessionAuthenticationError,
  "INVALID_SESSION_AUTHENTICATION",
  "inherit",
  "inherit",
);

const InvalidAccessToken = createKnownErrorConstructor(
  InvalidSessionAuthentication,
  "INVALID_ACCESS_TOKEN",
  "inherit",
  "inherit",
);

const UnparsableAccessToken = createKnownErrorConstructor(
  InvalidAccessToken,
  "UNPARSABLE_ACCESS_TOKEN",
  () => [
    401,
    "Access token is not parsable.",
  ] as const,
  () => [] as const,
);

const AccessTokenExpired = createKnownErrorConstructor(
  InvalidAccessToken,
  "ACCESS_TOKEN_EXPIRED",
  (expiredAt: Date | undefined) => [
    401,
    `Access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)`: ""}`,
    { expired_at_millis: expiredAt?.getTime() ?? null },
  ] as const,
  (json: any) => [json.expired_at_millis ? new Date(json.expired_at_millis) : undefined] as const,
);

const InvalidProjectForAccessToken = createKnownErrorConstructor(
  InvalidAccessToken,
  "INVALID_PROJECT_FOR_ACCESS_TOKEN",
  (expectedProjectId: string, actualProjectId: string) => [
    401,
    `Access token not valid for this project. Expected project ID ${JSON.stringify(expectedProjectId)}, but the token is for project ID ${JSON.stringify(actualProjectId)}.`,
    {
      expected_project_id: expectedProjectId,
      actual_project_id: actualProjectId,
    },
  ] as const,
  (json: any) => [json.expected_project_id, json.actual_project_id] as const,
);


const RefreshTokenError = createKnownErrorConstructor(
  KnownError,
  "REFRESH_TOKEN_ERROR",
  "inherit",
  "inherit",
);

const RefreshTokenNotFoundOrExpired = createKnownErrorConstructor(
  RefreshTokenError,
  "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
  () => [
    401,
    "Refresh token not found for this project, or the session has expired/been revoked.",
  ] as const,
  () => [] as const,
);

const CannotDeleteCurrentSession = createKnownErrorConstructor(
  RefreshTokenError,
  "CANNOT_DELETE_CURRENT_SESSION",
  () => [
    400,
    "Cannot delete the current session.",
  ] as const,
  () => [] as const,
);


const ProviderRejected = createKnownErrorConstructor(
  RefreshTokenError,
  "PROVIDER_REJECTED",
  () => [
    401,
    "The provider refused to refresh their token. This usually means that the provider used to authenticate the user no longer regards this session as valid, and the user must re-authenticate.",
  ] as const,
  () => [] as const,
);

const UserWithEmailAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "USER_EMAIL_ALREADY_EXISTS",
  (email: string) => [
    409,
    `A user with email ${JSON.stringify(email)} already exists.`,
    {
      email,
    },
  ] as const,
  (json: any) => [json.email] as const,
);

const EmailNotVerified = createKnownErrorConstructor(
  KnownError,
  "EMAIL_NOT_VERIFIED",
  () => [
    400,
    "The email is not verified.",
  ] as const,
  () => [] as const,
);

const CannotGetOwnUserWithoutUser = createKnownErrorConstructor(
  KnownError,
  "CANNOT_GET_OWN_USER_WITHOUT_USER",
  () => [
    400,
    "You have specified 'me' as a userId, but did not provide authentication for a user.",
  ] as const,
  () => [] as const,
);

const UserIdDoesNotExist = createKnownErrorConstructor(
  KnownError,
  "USER_ID_DOES_NOT_EXIST",
  (userId: string) => [
    400,
    `The given user with the ID ${userId} does not exist.`,
    {
      user_id: userId,
    },
  ] as const,
  (json: any) => [json.user_id] as const,
);

const UserNotFound = createKnownErrorConstructor(
  KnownError,
  "USER_NOT_FOUND",
  () => [
    404,
    "User not found.",
  ] as const,
  () => [] as const,
);


const ProjectNotFound = createKnownErrorConstructor(
  KnownError,
  "PROJECT_NOT_FOUND",
  (projectId: string) => {
    if (typeof projectId !== "string") throw new StackAssertionError("projectId of KnownErrors.ProjectNotFound must be a string");
    return [
      404,
      `Project ${projectId} not found or is not accessible with the current user.`,
      {
        project_id: projectId,
      },
    ] as const;
  },
  (json: any) => [json.project_id] as const,
);

const SignUpNotEnabled = createKnownErrorConstructor(
  KnownError,
  "SIGN_UP_NOT_ENABLED",
  () => [
    400,
    "Creation of new accounts is not enabled for this project. Please ask the project owner to enable it.",
  ] as const,
  () => [] as const,
);

const PasswordAuthenticationNotEnabled = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_AUTHENTICATION_NOT_ENABLED",
  () => [
    400,
    "Password authentication is not enabled for this project.",
  ] as const,
  () => [] as const,
);


const PasskeyAuthenticationNotEnabled = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_AUTHENTICATION_NOT_ENABLED",
  () => [
    400,
    "Passkey authentication is not enabled for this project.",
  ] as const,
  () => [] as const,
);

const AnonymousAccountsNotEnabled = createKnownErrorConstructor(
  KnownError,
  "ANONYMOUS_ACCOUNTS_NOT_ENABLED",
  () => [
    400,
    "Anonymous accounts are not enabled for this project.",
  ] as const,
  () => [] as const,
);


const EmailPasswordMismatch = createKnownErrorConstructor(
  KnownError,
  "EMAIL_PASSWORD_MISMATCH",
  () => [
    400,
    "Wrong e-mail or password.",
  ] as const,
  () => [] as const,
);

const RedirectUrlNotWhitelisted = createKnownErrorConstructor(
  KnownError,
  "REDIRECT_URL_NOT_WHITELISTED",
  () => [
    400,
    "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
  ] as const,
  () => [] as const,
);

const PasswordRequirementsNotMet = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_REQUIREMENTS_NOT_MET",
  "inherit",
  "inherit",
);

const PasswordTooShort = createKnownErrorConstructor(
  PasswordRequirementsNotMet,
  "PASSWORD_TOO_SHORT",
  (minLength: number) => [
    400,
    `Password too short. Minimum length is ${minLength}.`,
    {
      min_length: minLength,
    },
  ] as const,
  (json) => [
    (json as any)?.min_length ?? throwErr("min_length not found in PasswordTooShort details"),
  ] as const,
);

const PasswordTooLong = createKnownErrorConstructor(
  PasswordRequirementsNotMet,
  "PASSWORD_TOO_LONG",
  (maxLength: number) => [
    400,
    `Password too long. Maximum length is ${maxLength}.`,
    {
      maxLength,
    },
  ] as const,
  (json) => [
    (json as any)?.maxLength ?? throwErr("maxLength not found in PasswordTooLong details"),
  ] as const,
);

const UserDoesNotHavePassword = createKnownErrorConstructor(
  KnownError,
  "USER_DOES_NOT_HAVE_PASSWORD",
  () => [
    400,
    "This user does not have password authentication enabled.",
  ] as const,
  () => [] as const,
);

const VerificationCodeError = createKnownErrorConstructor(
  KnownError,
  "VERIFICATION_ERROR",
  "inherit",
  "inherit",
);

const VerificationCodeNotFound = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_NOT_FOUND",
  () => [
    404,
    "The verification code does not exist for this project.",
  ] as const,
  () => [] as const,
);

const VerificationCodeExpired = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_EXPIRED",
  () => [
    400,
    "The verification code has expired.",
  ] as const,
  () => [] as const,
);

const VerificationCodeAlreadyUsed = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_ALREADY_USED",
  () => [
    409,
    "The verification link has already been used.",
  ] as const,
  () => [] as const,
);

const VerificationCodeMaxAttemptsReached = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED",
  () => [
    400,
    "The verification code nonce has reached the maximum number of attempts. This code is not valid anymore.",
  ] as const,
  () => [] as const,
);

const PasswordConfirmationMismatch = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_CONFIRMATION_MISMATCH",
  () => [
    400,
    "Passwords do not match.",
  ] as const,
  () => [] as const,
);

const EmailAlreadyVerified = createKnownErrorConstructor(
  KnownError,
  "EMAIL_ALREADY_VERIFIED",
  () => [
    409,
    "The e-mail is already verified.",
  ] as const,
  () => [] as const,
);

const EmailNotAssociatedWithUser = createKnownErrorConstructor(
  KnownError,
  "EMAIL_NOT_ASSOCIATED_WITH_USER",
  () => [
    400,
    "The e-mail is not associated with a user that could log in with that e-mail.",
  ] as const,
  () => [] as const,
);

const EmailIsNotPrimaryEmail = createKnownErrorConstructor(
  KnownError,
  "EMAIL_IS_NOT_PRIMARY_EMAIL",
  (email: string, primaryEmail: string | null) => [
    400,
    `The given e-mail (${email}) must equal the user's primary e-mail (${primaryEmail}).`,
    {
      email,
      primary_email: primaryEmail,
    },
  ] as const,
  (json: any) => [json.email, json.primary_email] as const,
);


const PasskeyRegistrationFailed = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_REGISTRATION_FAILED",
  (message: string) => [
    400,
    message,
  ] as const,
  (json: any) => [json.message] as const,
);


const PasskeyWebAuthnError = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_WEBAUTHN_ERROR",
  (message: string, code: string) => [
    400,
    message,
    {
      message,
      code,
    },
  ] as const,
  (json: any) => [json.message, json.code] as const,
);

const PasskeyAuthenticationFailed = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_AUTHENTICATION_FAILED",
  (message: string) => [
    400,
    message,
  ] as const,
  (json: any) => [json.message] as const,
);


const PermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "PERMISSION_NOT_FOUND",
  (permissionId: string) => [
    404,
    `Permission "${permissionId}" not found. Make sure you created it on the dashboard.`,
    {
      permission_id: permissionId,
    },
  ] as const,
  (json: any) => [json.permission_id] as const,
);

const ContainedPermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "CONTAINED_PERMISSION_NOT_FOUND",
  (permissionId: string) => [
    400,
    `Contained permission with ID "${permissionId}" not found. Make sure you created it on the dashboard.`,
    {
      permission_id: permissionId,
    },
  ] as const,
  (json: any) => [json.permission_id] as const,
);

const TeamNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_NOT_FOUND",
  (teamId: string) => [
    404,
    `Team ${teamId} not found.`,
    {
      team_id: teamId,
    },
  ] as const,
  (json: any) => [json.team_id] as const,
);

const TeamAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "TEAM_ALREADY_EXISTS",
  (teamId: string) => [
    409,
    `Team ${teamId} already exists.`,
    {
      team_id: teamId,
    },
  ] as const,
  (json: any) => [json.team_id] as const,
);

const TeamMembershipNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_MEMBERSHIP_NOT_FOUND",
  (teamId: string, userId: string) => [
    404,
    `User ${userId} is not found in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
    },
  ] as const,
  (json: any) => [json.team_id, json.user_id] as const,
);


const EmailTemplateAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "EMAIL_TEMPLATE_ALREADY_EXISTS",
  () => [
    409,
    "Email template already exists.",
  ] as const,
  () => [] as const,
);

const OAuthConnectionNotConnectedToUser = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER",
  () => [
    400,
    "The OAuth connection is not connected to any user.",
  ] as const,
  () => [] as const,
);

const OAuthConnectionAlreadyConnectedToAnotherUser = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER",
  () => [
    409,
    "The OAuth connection is already connected to another user.",
  ] as const,
  () => [] as const,
);

const OAuthConnectionDoesNotHaveRequiredScope = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
  () => [
    400,
    "The OAuth connection does not have the required scope.",
  ] as const,
  () => [] as const,
);

const OAuthExtraScopeNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(
  KnownError,
  "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
  () => [
    400,
    "Extra scopes are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use extra scopes.",
  ] as const,
  () => [] as const,
);

const OAuthAccessTokenNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(
  KnownError,
  "OAUTH_ACCESS_TOKEN_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
  () => [
    400,
    "Access tokens are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use access tokens.",
  ] as const,
  () => [] as const,
);

const InvalidOAuthClientIdOrSecret = createKnownErrorConstructor(
  KnownError,
  "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
  (clientId?: string) => [
    400,
    "The OAuth client ID or secret is invalid. The client ID must be equal to the project ID, and the client secret must be a publishable client key.",
    {
      client_id: clientId ?? null,
    },
  ] as const,
  (json: any) => [json.client_id ?? undefined] as const,
);

const InvalidScope = createKnownErrorConstructor(
  KnownError,
  "INVALID_SCOPE",
  (scope: string) => [
    400,
    `The scope "${scope}" is not a valid OAuth scope for Stack.`,
  ] as const,
  (json: any) => [json.scope] as const,
);

const UserAlreadyConnectedToAnotherOAuthConnection = createKnownErrorConstructor(
  KnownError,
  "USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION",
  () => [
    409,
    "The user is already connected to another OAuth account. Did you maybe selected the wrong account?",
  ] as const,
  () => [] as const,
);

const OuterOAuthTimeout = createKnownErrorConstructor(
  KnownError,
  "OUTER_OAUTH_TIMEOUT",
  () => [
    408,
    "The OAuth flow has timed out. Please sign in again.",
  ] as const,
  () => [] as const,
);

const OAuthProviderNotFoundOrNotEnabled = createKnownErrorConstructor(
  KnownError,
  "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
  () => [
    400,
    "The OAuth provider is not found or not enabled.",
  ] as const,
  () => [] as const,
);

const MultiFactorAuthenticationRequired = createKnownErrorConstructor(
  KnownError,
  "MULTI_FACTOR_AUTHENTICATION_REQUIRED",
  (attemptCode: string) => [
    400,
    `Multi-factor authentication is required for this user.`,
    {
      attempt_code: attemptCode,
    },
  ] as const,
  (json) => [json.attempt_code] as const,
);

const InvalidTotpCode = createKnownErrorConstructor(
  KnownError,
  "INVALID_TOTP_CODE",
  () => [
    400,
    "The TOTP code is invalid. Please try again.",
  ] as const,
  () => [] as const,
);

const UserAuthenticationRequired = createKnownErrorConstructor(
  KnownError,
  "USER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "User authentication required for this endpoint.",
  ] as const,
  () => [] as const,
);

const TeamMembershipAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "TEAM_MEMBERSHIP_ALREADY_EXISTS",
  () => [
    409,
    "Team membership already exists.",
  ] as const,
  () => [] as const,
);

const ProjectPermissionRequired = createKnownErrorConstructor(
  KnownError,
  "PROJECT_PERMISSION_REQUIRED",
  (userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId}.`,
    {
      user_id: userId,
      permission_id: permissionId,
    },
  ] as const,
  (json) => [json.user_id, json.permission_id] as const,
);

const TeamPermissionRequired = createKnownErrorConstructor(
  KnownError,
  "TEAM_PERMISSION_REQUIRED",
  (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId,
    },
  ] as const,
  (json) => [json.team_id, json.user_id, json.permission_id] as const,
);

const TeamPermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_PERMISSION_NOT_FOUND",
  (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId,
    },
  ] as const,
  (json) => [json.team_id, json.user_id, json.permission_id] as const,
);

const InvalidSharedOAuthProviderId = createKnownErrorConstructor(
  KnownError,
  "INVALID_SHARED_OAUTH_PROVIDER_ID",
  (providerId) => [
    400,
    `The shared OAuth provider with ID ${providerId} is not valid.`,
    {
      provider_id: providerId,
    },
  ] as const,
  (json) => [json.provider_id] as const,
);

const InvalidStandardOAuthProviderId = createKnownErrorConstructor(
  KnownError,
  "INVALID_STANDARD_OAUTH_PROVIDER_ID",
  (providerId) => [
    400,
    `The standard OAuth provider with ID ${providerId} is not valid.`,
    {
      provider_id: providerId,
    },
  ] as const,
  (json) => [json.provider_id] as const,
);

const InvalidAuthorizationCode = createKnownErrorConstructor(
  KnownError,
  "INVALID_AUTHORIZATION_CODE",
  () => [
    400,
    "The given authorization code is invalid.",
  ] as const,
  () => [] as const,
);

const OAuthProviderAccessDenied = createKnownErrorConstructor(
  KnownError,
  "OAUTH_PROVIDER_ACCESS_DENIED",
  () => [
    400,
    "The OAuth provider denied access to the user.",
  ] as const,
  () => [] as const,
);

const ContactChannelAlreadyUsedForAuthBySomeoneElse = createKnownErrorConstructor(
  KnownError,
  "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
  (type: "email", contactChannelValue?: string) => [
    409,
    contactChannelValue ?
    `The ${type} (${contactChannelValue}) is already used for authentication by another account.` :
    `This ${type} is already used for authentication by another account.`,
    { type, contact_channel_value: contactChannelValue ?? null },
  ] as const,
  (json) => [json.type, json.contact_channel_value] as const,
);

const InvalidPollingCodeError = createKnownErrorConstructor(
  KnownError,
  "INVALID_POLLING_CODE",
  (details?: Json) => [
    400,
    "The polling code is invalid or does not exist.",
    details,
  ] as const,
  (json: any) => [json] as const,
);


const ApiKeyNotValid = createKnownErrorConstructor(
  KnownError,
  "API_KEY_NOT_VALID",
  "inherit",
  "inherit",
);

const ApiKeyExpired = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_EXPIRED",
  () => [
    401,
    "API key has expired.",
  ] as const,
  () => [] as const,
);

const ApiKeyRevoked = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_REVOKED",
  () => [
    401,
    "API key has been revoked.",
  ] as const,
  () => [] as const,
);

const WrongApiKeyType = createKnownErrorConstructor(
  ApiKeyNotValid,
  "WRONG_API_KEY_TYPE",
  (expectedType: string, actualType: string) => [
    400,
    `This endpoint is for ${expectedType} API keys, but a ${actualType} API key was provided.`,
    { expected_type: expectedType, actual_type: actualType },
  ] as const,
  (json) => [json.expected_type, json.actual_type] as const,
);

const ApiKeyNotFound = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_NOT_FOUND",
  () => [
    404,
    "API key not found.",
  ] as const,
  () => [] as const,
);

const PublicApiKeyCannotBeRevoked = createKnownErrorConstructor(
  ApiKeyNotValid,
  "PUBLIC_API_KEY_CANNOT_BE_REVOKED",
  () => [
    400,
    "Public API keys cannot be revoked by the secretscanner endpoint.",
  ] as const,
  () => [] as const,
);

const PermissionIdAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "PERMISSION_ID_ALREADY_EXISTS",
  (permissionId: string) => [
    400,
    `Permission with ID "${permissionId}" already exists. Choose a different ID.`,
    {
      permission_id: permissionId,
    },
  ] as const,
  (json: any) => [json.permission_id] as const,
);

export type KnownErrors = {
  [K in keyof typeof KnownErrors]: InstanceType<typeof KnownErrors[K]>;
};

export const KnownErrors = {
  CannotDeleteCurrentSession,
  UnsupportedError,
  BodyParsingError,
  SchemaError,
  AllOverloadsFailed,
  ProjectAuthenticationError,
  PermissionIdAlreadyExists,
  InvalidProjectAuthentication,
  ProjectKeyWithoutAccessType,
  InvalidAccessType,
  AccessTypeWithoutProjectId,
  AccessTypeRequired,
  CannotGetOwnUserWithoutUser,
  InsufficientAccessType,
  InvalidPublishableClientKey,
  InvalidSecretServerKey,
  InvalidSuperSecretAdminKey,
  InvalidAdminAccessToken,
  UnparsableAdminAccessToken,
  AdminAccessTokenExpired,
  InvalidProjectForAdminAccessToken,
  AdminAccessTokenIsNotAdmin,
  ProjectAuthenticationRequired,
  ClientAuthenticationRequired,
  ServerAuthenticationRequired,
  ClientOrServerAuthenticationRequired,
  ClientOrAdminAuthenticationRequired,
  ClientOrServerOrAdminAuthenticationRequired,
  AdminAuthenticationRequired,
  ExpectedInternalProject,
  SessionAuthenticationError,
  InvalidSessionAuthentication,
  InvalidAccessToken,
  UnparsableAccessToken,
  AccessTokenExpired,
  InvalidProjectForAccessToken,
  RefreshTokenError,
  ProviderRejected,
  RefreshTokenNotFoundOrExpired,
  UserWithEmailAlreadyExists,
  EmailNotVerified,
  UserIdDoesNotExist,
  UserNotFound,
  ApiKeyNotFound,
  PublicApiKeyCannotBeRevoked,
  ProjectNotFound,
  SignUpNotEnabled,
  PasswordAuthenticationNotEnabled,
  PasskeyAuthenticationNotEnabled,
  AnonymousAccountsNotEnabled,
  EmailPasswordMismatch,
  RedirectUrlNotWhitelisted,
  PasswordRequirementsNotMet,
  PasswordTooShort,
  PasswordTooLong,
  UserDoesNotHavePassword,
  VerificationCodeError,
  VerificationCodeNotFound,
  VerificationCodeExpired,
  VerificationCodeAlreadyUsed,
  VerificationCodeMaxAttemptsReached,
  PasswordConfirmationMismatch,
  EmailAlreadyVerified,
  EmailNotAssociatedWithUser,
  EmailIsNotPrimaryEmail,
  PasskeyRegistrationFailed,
  PasskeyWebAuthnError,
  PasskeyAuthenticationFailed,
  PermissionNotFound,
  ContainedPermissionNotFound,
  TeamNotFound,
  TeamMembershipNotFound,
  EmailTemplateAlreadyExists,
  OAuthConnectionNotConnectedToUser,
  OAuthConnectionAlreadyConnectedToAnotherUser,
  OAuthConnectionDoesNotHaveRequiredScope,
  OAuthExtraScopeNotAvailableWithSharedOAuthKeys,
  OAuthAccessTokenNotAvailableWithSharedOAuthKeys,
  InvalidOAuthClientIdOrSecret,
  InvalidScope,
  UserAlreadyConnectedToAnotherOAuthConnection,
  OuterOAuthTimeout,
  OAuthProviderNotFoundOrNotEnabled,
  MultiFactorAuthenticationRequired,
  InvalidTotpCode,
  UserAuthenticationRequired,
  TeamMembershipAlreadyExists,
  ProjectPermissionRequired,
  TeamPermissionRequired,
  InvalidSharedOAuthProviderId,
  InvalidStandardOAuthProviderId,
  InvalidAuthorizationCode,
  TeamPermissionNotFound,
  OAuthProviderAccessDenied,
  ContactChannelAlreadyUsedForAuthBySomeoneElse,
  InvalidPollingCodeError,
  ApiKeyNotValid,
  ApiKeyExpired,
  ApiKeyRevoked,
  WrongApiKeyType,
} satisfies Record<string, KnownErrorConstructor<any, any>>;


// ensure that all known error codes are unique
const knownErrorCodes = new Set<string>();
for (const [_, KnownError] of Object.entries(KnownErrors)) {
  if (knownErrorCodes.has(KnownError.errorCode)) {
    throw new Error(`Duplicate known error code: ${KnownError.errorCode}`);
  }
  knownErrorCodes.add(KnownError.errorCode);
}
