import { globalVar } from "./globals";
import { Json } from "./json";
import { pick } from "./objects";
import { nicify } from "./strings";


export function throwErr(errorMessage: string, extraData?: any): never;
export function throwErr(error: Error): never;
export function throwErr(...args: StatusErrorConstructorParameters): never;
export function throwErr(...args: any[]): never {
  if (typeof args[0] === "string") {
    throw new StackAssertionError(args[0], args[1]);
  } else if (args[0] instanceof Error) {
    throw args[0];
  } else {
    // @ts-expect-error
    throw new StatusError(...args);
  }
}

function removeStacktraceNameLine(stack: string): string {
  // some browsers (eg. Chrome) prepend the stack with an extra line with the error name
  const addsNameLine = new Error().stack?.startsWith("Error\n");
  return stack.split("\n").slice(addsNameLine ? 1 : 0).join("\n");
}


/**
 * Concatenates the (original) stacktraces of the given errors onto the first.
 *
 * Note: Very often, the concatStacktracesIfRejected function in promises.tsx is an easier way to use this function.
 *
 * Useful when you invoke an async function to receive a promise without awaiting it immediately. Browsers are smart
 * enough to keep track of the call stack in async function calls when you invoke `.then` within the same async tick,
 * but if you don't, the stacktrace will be lost.
 *
 * Here's an example of the unwanted behavior:
 *
 * ```tsx
 * async function log() {
 *   await wait(0);  // put the task on the event loop
 *   console.log(new Error().stack);
 * }
 *
 * async function main() {
 *   await log();  // good; prints both "log" and "main" on the stacktrace
 *   log();  // bad; prints only "log" on the stacktrace
 * }
 * ```
 */
export function concatStacktraces(first: Error, ...errors: Error[]): void {
  // some browsers (eg. Firefox) add an extra empty line at the end
  const addsEmptyLineAtEnd = first.stack?.endsWith("\n");


  // Add a reference to this function itself so that we know that stacktraces were concatenated
  // If you are coming here from a stacktrace, please know that the two parts before and after this line are different
  // stacktraces that were concatenated with concatStacktraces
  const separator = removeStacktraceNameLine(new Error().stack ?? "").split("\n")[0];


  for (const error of errors) {
    const toAppend = removeStacktraceNameLine(error.stack ?? "");
    first.stack += (addsEmptyLineAtEnd ? "" : "\n") + separator + "\n" + toAppend;
  }
}


export class StackAssertionError extends Error {
  constructor(message: string, public readonly extraData?: Record<string, any> & ErrorOptions) {
    const disclaimer = `\n\nThis is likely an error in Stack. Please make sure you are running the newest version and report it.`;
    super(`${message}${message.endsWith(disclaimer) ? "" : disclaimer}`, pick(extraData ?? {}, ["cause"]));

    Object.defineProperty(this, "customCaptureExtraArgs", {
      get() {
        return [this.extraData];
      },
      enumerable: false,
    });

    if (process.env.NEXT_PUBLIC_STACK_DEBUGGER_ON_ASSERTION_ERROR === "true") {
      debugger;
    }
  }
}
StackAssertionError.prototype.name = "StackAssertionError";


export function errorToNiceString(error: unknown): string {
  if (!(error instanceof Error)) return `${typeof error}<${nicify(error)}>`;
  return nicify(error, { maxDepth: 8 });
}


const errorSinks = new Set<(location: string, error: unknown, ...extraArgs: unknown[]) => void>();
export function registerErrorSink(sink: (location: string, error: unknown) => void): void {
  if (errorSinks.has(sink)) {
    return;
  }
  errorSinks.add(sink);
}
registerErrorSink((location, error, ...extraArgs) => {
  console.error(
    `\x1b[41mCaptured error in ${location}:`,
    // HACK: Log a nicified version of the error to get around buggy Next.js pretty-printing
    // https://www.reddit.com/r/nextjs/comments/1gkxdqe/comment/m19kxgn/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button
    errorToNiceString(error),
    ...extraArgs,
    "\x1b[0m",
  );
});
registerErrorSink((location, error, ...extraArgs) => {
  globalVar.stackCapturedErrors = globalVar.stackCapturedErrors ?? [];
  globalVar.stackCapturedErrors.push({ location, error, extraArgs });
});

/**
 * Captures an error and sends it to the error sinks (most notably, Sentry). Errors caught with captureError are
 * supposed to be seen by an engineer, so they should be actionable and important.
 *
 * The location string is a machine-readable ID, and should hence not contain spaces or anything like that. Good
 * examples are: "api-route-handler", "renderPart()", etc.
 *
 * Errors that bubble up to the top of runAsynchronously or a route handler are already captured with captureError.
 */
export function captureError(location: string, error: unknown): void {
  for (const sink of errorSinks) {
    sink(
      location,
      error,
      ...error && (typeof error === 'object' || typeof error === 'function') && "customCaptureExtraArgs" in error && Array.isArray(error.customCaptureExtraArgs) ? (error.customCaptureExtraArgs as any[]) : [],
    );
  }
}


type Status = {
  statusCode: number,
  message: string,
};

type StatusErrorConstructorParameters =
| [
  status: Status,
  message?: string
]
| [
  statusCode: number | Status,
  message: string,
];

export class StatusError extends Error {
  private readonly __stackStatusErrorBrand = "stack-status-error-brand-sentinel" as const;
  public name = "StatusError";
  public readonly statusCode: number;

  public static BadRequest = { statusCode: 400, message: "Bad Request" };
  public static Unauthorized = { statusCode: 401, message: "Unauthorized" };
  public static PaymentRequired = { statusCode: 402, message: "Payment Required" };
  public static Forbidden = { statusCode: 403, message: "Forbidden" };
  public static NotFound = { statusCode: 404, message: "Not Found" };
  public static MethodNotAllowed = { statusCode: 405, message: "Method Not Allowed" };
  public static NotAcceptable = { statusCode: 406, message: "Not Acceptable" };
  public static ProxyAuthenticationRequired = { statusCode: 407, message: "Proxy Authentication Required" };
  public static RequestTimeout = { statusCode: 408, message: "Request Timeout" };
  public static Conflict = { statusCode: 409, message: "Conflict" };
  public static Gone = { statusCode: 410, message: "Gone" };
  public static LengthRequired = { statusCode: 411, message: "Length Required" };
  public static PreconditionFailed = { statusCode: 412, message: "Precondition Failed" };
  public static PayloadTooLarge = { statusCode: 413, message: "Payload Too Large" };
  public static URITooLong = { statusCode: 414, message: "URI Too Long" };
  public static UnsupportedMediaType = { statusCode: 415, message: "Unsupported Media Type" };
  public static RangeNotSatisfiable = { statusCode: 416, message: "Range Not Satisfiable" };
  public static ExpectationFailed = { statusCode: 417, message: "Expectation Failed" };
  public static ImATeapot = { statusCode: 418, message: "I'm a teapot" };
  public static MisdirectedRequest = { statusCode: 421, message: "Misdirected Request" };
  public static UnprocessableEntity = { statusCode: 422, message: "Unprocessable Entity" };
  public static Locked = { statusCode: 423, message: "Locked" };
  public static FailedDependency = { statusCode: 424, message: "Failed Dependency" };
  public static TooEarly = { statusCode: 425, message: "Too Early" };
  public static UpgradeRequired = { statusCode: 426, message: "Upgrade Required" };
  public static PreconditionRequired = { statusCode: 428, message: "Precondition Required" };
  public static TooManyRequests = { statusCode: 429, message: "Too Many Requests" };
  public static RequestHeaderFieldsTooLarge = { statusCode: 431, message: "Request Header Fields Too Large" };
  public static UnavailableForLegalReasons = { statusCode: 451, message: "Unavailable For Legal Reasons" };

  public static InternalServerError = { statusCode: 500, message: "Internal Server Error" };
  public static NotImplemented = { statusCode: 501, message: "Not Implemented" };
  public static BadGateway = { statusCode: 502, message: "Bad Gateway" };
  public static ServiceUnavailable = { statusCode: 503, message: "Service Unavailable" };
  public static GatewayTimeout = { statusCode: 504, message: "Gateway Timeout" };
  public static HTTPVersionNotSupported = { statusCode: 505, message: "HTTP Version Not Supported" };
  public static VariantAlsoNegotiates = { statusCode: 506, message: "Variant Also Negotiates" };
  public static InsufficientStorage = { statusCode: 507, message: "Insufficient Storage" };
  public static LoopDetected = { statusCode: 508, message: "Loop Detected" };
  public static NotExtended = { statusCode: 510, message: "Not Extended" };
  public static NetworkAuthenticationRequired = { statusCode: 511, message: "Network Authentication Required" };


  constructor(...args: StatusErrorConstructorParameters);
  constructor(
    status: number | Status,
    message?: string,
  ) {
    if (typeof status === "object") {
      message ??= status.message;
      status = status.statusCode;
    }
    super(message);
    this.statusCode = status;
    if (!message) {
      throw new StackAssertionError("StatusError always requires a message unless a Status object is passed", { cause: this });
    }
  }

  public static isStatusError(error: unknown): error is StatusError {
    // like instanceof, but also works for errors thrown in other realms or by different versions of the same package
    return typeof error === "object" && error !== null && "__stackStatusErrorBrand" in error && error.__stackStatusErrorBrand === "stack-status-error-brand-sentinel";
  }

  public isClientError() {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  public isServerError() {
    return !this.isClientError();
  }

  public getStatusCode(): number {
    return this.statusCode;
  }

  public getBody(): Uint8Array {
    return new TextEncoder().encode(this.message);
  }

  public getHeaders(): Record<string, string[]> {
    return {
      "Content-Type": ["text/plain; charset=utf-8"],
    };
  }

  public toDescriptiveJson(): Json {
    return {
      status_code: this.getStatusCode(),
      message: this.message,
      headers: this.getHeaders(),
    };
  }

  /**
   * @deprecated this is not a good way to make status errors human-readable, use toDescriptiveJson instead
   */
  public toHttpJson(): Json {
    return {
      status_code: this.statusCode,
      body: this.message,
      headers: this.getHeaders(),
    };
  }
}
StatusError.prototype.name = "StatusError";
