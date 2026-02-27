import metadata from "../generated/exec-api-metadata.json";

type MethodEntry = {
  name: string,
  signatures: string[],
};

export type ExecApiMetadata = {
  schemaVersion: 1,
  stackClientApp: MethodEntry[],
  stackServerApp: MethodEntry[],
};

function section(title: string, methods: MethodEntry[]): string[] {
  const lines = [title];
  if (methods.length === 0) {
    lines.push("  (none)");
    return lines;
  }
  for (const method of methods) {
    for (const signature of method.signatures) {
      lines.push(`  - ${signature}`);
    }
  }
  return lines;
}

export function formatExecApiHelp(): string {
  if (metadata.schemaVersion !== 1) {
    throw new Error("Unsupported exec API metadata schema version");
  }
  const lines: string[] = [];
  lines.push("Available methods on `app`:");
  lines.push("");
  lines.push(...section("StackServerApp methods", metadata.stackServerApp));
  return lines.join("\n");
}
