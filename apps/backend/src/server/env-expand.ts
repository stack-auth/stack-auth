/* eslint-disable no-restricted-syntax -- This bootstrap normalizes process.env before getEnvVariable reads it. */

const envReferencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function expandEnvValue(value: string): string {
  return value.replace(envReferencePattern, (_match, bracedName: string | undefined, defaultValue: string | undefined, bareName: string | undefined) => {
    const name = bracedName ?? bareName;
    if (name == null) {
      return "";
    }
    const referencedValue = process.env[name];
    if (bracedName != null && defaultValue != null && (referencedValue == null || referencedValue === "")) {
      return defaultValue;
    }
    return referencedValue ?? "";
  });
}

for (let iteration = 0; iteration < 10; iteration++) {
  let changed = false;
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null || !envReferencePattern.test(value)) {
      envReferencePattern.lastIndex = 0;
      continue;
    }
    envReferencePattern.lastIndex = 0;
    const expandedValue = expandEnvValue(value);
    if (expandedValue !== value) {
      process.env[key] = expandedValue;
      changed = true;
    }
  }
  if (!changed) {
    break;
  }
}
