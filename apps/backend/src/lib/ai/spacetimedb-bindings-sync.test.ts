/**
 * Repro for the SpacetimeDB binding drift hazard.
 *
 * The internal-tool's SpacetimeDB schema (`apps/internal-tool/spacetimedb/src/index.ts`)
 * is the single source of truth for table column order and reducer arg order.
 * Auto-generated client bindings under `apps/internal-tool/src/module_bindings/`
 * MUST match it positionally — SpacetimeDB encodes table rows and reducer
 * arguments as positional BSATN (https://spacetimedb.com/docs/bsatn). Field
 * names are not transmitted on the wire, so a missing or misordered field in
 * a binding silently shifts every subsequent field in deserialization.
 *
 * These tests parse both the server schema source and the generated
 * bindings as text, extract the field/arg order, and assert they match.
 * They fail if a schema change is made without regenerating or otherwise
 * keeping the checked-in bindings in sync.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../../../..");

function read(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

/**
 * Extracts ordered field names from a `t.someThing(...)` block in the server
 * schema source. Given `tableName: 'qa_entries'` (or a reducer call like
 * `add_manual_qa = spacetimedb.reducer({...}, ...)`), we slice from the
 * matching anchor through the next matching `}` and collect every line of
 * shape `<indent>fieldName: ...,?`.
 */
function extractServerFields(source: string, anchor: RegExp): string[] {
  const match = anchor.exec(source);
  if (match == null) throw new Error(`anchor ${anchor} not found in server schema`);
  const startIdx = match.index + match[0].length;
  // Find the matching closing brace by tracking depth from the opening `{`
  // that immediately follows the anchor.
  const openIdx = source.indexOf("{", startIdx);
  if (openIdx === -1) throw new Error(`opening brace not found after anchor ${anchor}`);
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) throw new Error(`closing brace not found for anchor ${anchor}`);
  const block = source.slice(openIdx + 1, endIdx);
  const fieldRe = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(block)) != null) out.push(m[1]);
  return out;
}

/**
 * The generated row binding format is `__t.row({ field: __t.something() })`.
 * The reducer binding format is `export default { field: __t.something() }`.
 * Both share the field-name extraction pattern.
 */
function extractClientFields(source: string, blockStartRe: RegExp): string[] {
  const match = blockStartRe.exec(source);
  if (match == null) throw new Error(`anchor ${blockStartRe} not found in binding`);
  const openIdx = source.indexOf("{", match.index);
  if (openIdx === -1) throw new Error(`opening brace not found after anchor ${blockStartRe}`);
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) throw new Error(`closing brace not found for anchor ${blockStartRe}`);
  const block = source.slice(openIdx + 1, endIdx);
  const fieldRe = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(block)) != null) out.push(m[1]);
  return out;
}

describe("SpacetimeDB bindings stay in sync with server schema", () => {
  const serverSchema = read("apps/internal-tool/spacetimedb/src/index.ts");

  it("server reducers match generated client reducer list", () => {
    const serverReducerNames = Array.from(
      serverSchema.matchAll(/export const ([a-z_]+) = spacetimedb\.reducer/g),
      m => m[1],
    ).sort();
    const clientSource = read("apps/internal-tool/src/module_bindings/index.ts");
    const clientReducerNames = Array.from(
      clientSource.matchAll(/__reducerSchema\("([a-z_]+)"/g),
      m => m[1],
    ).sort();
    expect(clientReducerNames).toEqual(serverReducerNames);
  });

  it("operators server columns match operators client row binding", () => {
    const serverFields = extractServerFields(serverSchema, /name:\s*'operators',\s*public:\s*true\s*\},\s*/);
    const clientSource = read("apps/internal-tool/src/module_bindings/operators_table.ts");
    const clientFields = extractClientFields(clientSource, /__t\.row\(/);
    expect(clientFields).toEqual(serverFields);
  });

  it("operators server columns match Operators algebraic type in types.ts", () => {
    const serverFields = extractServerFields(serverSchema, /name:\s*'operators',\s*public:\s*true\s*\},\s*/);
    const typesSource = read("apps/internal-tool/src/module_bindings/types.ts");
    const clientFields = extractClientFields(typesSource, /export const Operators = __t\.object\("Operators",\s*/);
    expect(clientFields).toEqual(serverFields);
  });

  it("qa_entries server columns match my_visible_qa_entries client row binding", () => {
    const serverFields = extractServerFields(serverSchema, /name:\s*'qa_entries',\s*public:\s*false\s*\},\s*/);
    const clientSource = read("apps/internal-tool/src/module_bindings/my_visible_qa_entries_table.ts");
    const clientFields = extractClientFields(clientSource, /__t\.row\(/);
    expect(clientFields).toEqual(serverFields);
  });

  it("qa_entries server columns match QaEntries algebraic type in types.ts", () => {
    const serverFields = extractServerFields(serverSchema, /name:\s*'qa_entries',\s*public:\s*false\s*\},\s*/);
    const typesSource = read("apps/internal-tool/src/module_bindings/types.ts");
    const clientFields = extractClientFields(typesSource, /export const QaEntries = __t\.object\("QaEntries",\s*/);
    expect(clientFields).toEqual(serverFields);
  });

  it("add_manual_qa server reducer args match client reducer binding", () => {
    const serverFields = extractServerFields(serverSchema, /export const add_manual_qa = spacetimedb\.reducer\(\s*/);
    const clientSource = read("apps/internal-tool/src/module_bindings/add_manual_qa_reducer.ts");
    const clientFields = extractClientFields(clientSource, /export default\s*/);
    expect(clientFields).toEqual(serverFields);
  });
});
