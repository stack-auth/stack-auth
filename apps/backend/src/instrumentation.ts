import { registerBackendInstrumentation } from "./instrument";

export async function register() {
  registerBackendInstrumentation();
}
