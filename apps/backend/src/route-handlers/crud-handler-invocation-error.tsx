/**
 * Wrapper error thrown when a CRUD handler invoked programmatically throws an error that is
 * not in the caller's allowedErrorTypes. This prevents intermediate catch blocks from
 * accidentally swallowing StatusErrors; the final route-handler error boundary knows how
 * to unwrap it.
 */
export class CrudHandlerInvocationError extends Error {
  constructor(public readonly cause: unknown) {
    super("Error while invoking CRUD handler programmatically. This is a wrapper error to prevent caught errors (eg. StatusError) from being caught by outer catch blocks. Check the `cause` property.\n\nOriginal error: " + cause, { cause });
  }
}
