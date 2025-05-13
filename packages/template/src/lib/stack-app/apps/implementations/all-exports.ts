
import { scrambleDuringCompileTime } from "@stackframe/stack-shared/dist/utils/compile-time";
import { _StackAdminAppImplIncomplete } from "./admin-app-impl";
import { _StackClientAppImplIncomplete } from "./client-app-impl";
import { _StackServerAppImplIncomplete } from "./server-app-impl";


/**
 * Prevents a circular dependency between the client and admin apps. For more information, see the documentation comment
 * of `_StackClientAppImplIncomplete.LazyStackAdminAppImpl`.
 *
 * Note: This is an explicitly defined function that returns the new values (and not a barrel file with top-level side
 * effects) because we have `sideEffects: false` in the package.json, and so it would be tree-shaken away if we just
 * exported the values directly.
 */
function complete() {
  _StackClientAppImplIncomplete.LazyStackAdminAppImpl.value = _StackAdminAppImplIncomplete;

  return {
    _StackAdminAppImpl: scrambleDuringCompileTime(_StackAdminAppImplIncomplete),
    _StackClientAppImpl: scrambleDuringCompileTime(_StackClientAppImplIncomplete),
    _StackServerAppImpl: scrambleDuringCompileTime(_StackServerAppImplIncomplete),
  };
}

export const {
  _StackAdminAppImpl,
  _StackClientAppImpl,
  _StackServerAppImpl
} = complete();

