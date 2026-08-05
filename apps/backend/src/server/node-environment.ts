export function initializeNodeEnvironment(environment: object) {
  const configuredEnvironment = Reflect.get(environment, "NODE_ENV");
  if (configuredEnvironment == null) {
    if (!Reflect.set(environment, "NODE_ENV", "production")) {
      throw new Error("Could not set the default backend NODE_ENV");
    }
    return "production";
  }
  if (typeof configuredEnvironment !== "string") {
    throw new Error(`Backend NODE_ENV must be a string, got ${typeof configuredEnvironment}`);
  }
  const normalizedEnvironment = configuredEnvironment.trim() || "production";
  if (!Reflect.set(environment, "NODE_ENV", normalizedEnvironment)) {
    throw new Error("Could not normalize the backend NODE_ENV");
  }
  return normalizedEnvironment;
}
