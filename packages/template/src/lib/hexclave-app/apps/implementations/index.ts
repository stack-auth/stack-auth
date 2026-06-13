
import { scrambleDuringCompileTime } from "@hexclave/shared/dist/utils/compile-time";
import { _HexclaveAdminAppImplIncomplete } from "./admin-app-impl";
import { _HexclaveClientAppImplIncomplete } from "./client-app-impl";
import { _HexclaveServerAppImplIncomplete } from "./server-app-impl";


/**
 * Prevents a circular dependency between the client and admin apps. For more information, see the documentation comment
 * of `_HexclaveClientAppImplIncomplete.LazyStackAdminAppImpl`.
 *
 * Note: This is an explicitly defined function that returns the new values (and not a barrel file with top-level side
 * effects) because we have `sideEffects: false` in the package.json, and so it would be tree-shaken away if we just
 * exported the values directly.
 */
function complete() {
  _HexclaveClientAppImplIncomplete.LazyStackAdminAppImpl.value = _HexclaveAdminAppImplIncomplete;

  return {
    _HexclaveAdminAppImpl: scrambleDuringCompileTime(_HexclaveAdminAppImplIncomplete),
    _HexclaveClientAppImpl: scrambleDuringCompileTime(_HexclaveClientAppImplIncomplete),
    _HexclaveServerAppImpl: scrambleDuringCompileTime(_HexclaveServerAppImplIncomplete),
  };
}

export const {
  _HexclaveAdminAppImpl,
  _HexclaveClientAppImpl,
  _HexclaveServerAppImpl
} = complete();

