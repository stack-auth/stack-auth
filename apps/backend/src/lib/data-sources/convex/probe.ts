import type { ConvexCapabilities } from "@hexclave/shared/dist/data-sources/modes";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import type { DataSourceColumn, DataSourceConnection, DataSourceProbeResult, ProbedTable } from "../types";
import { convexRequest, toConvexCredentials, type ConvexCredentials } from "./client";

/**
 * Convex's identifier column. Always present, always unique, and always the
 * whole key — so unlike Postgres there is no keyless table to fall back to an
 * append-only destination for.
 */
export const CONVEX_ID_COLUMN = "_id";
export const CONVEX_CREATION_TIME_COLUMN = "_creationTime";

/**
 * Convex has components rather than schemas, and the root app's component is the
 * empty string. An empty namespace would make an unreadable destination table
 * name (`_users_<hash>`) and an odd thing to show in the picker, so it is
 * reported under this name instead.
 */
export const CONVEX_ROOT_COMPONENT = "app";

export function componentToSchemaName(component: string): string {
  return component === "" ? CONVEX_ROOT_COMPONENT : component;
}

/**
 * A node of the JSON Schema Convex infers for a table. Convex documents are not
 * required to share a shape, so this describes what it has *seen*, not a contract:
 * a field only some documents carry simply will not be in `required`.
 */
type JsonSchemaNode = {
  type?: string | string[],
  properties?: Record<string, JsonSchemaNode>,
  required?: string[],
  /**
   * Convex's own annotation, and the only way to tell its richer types apart:
   * `Id(users)`, `int64 represented as base10 string`, `base64 bytes`.
   */
  $description?: string,
};

/**
 * Convex type -> ClickHouse type.
 *
 * Objects and arrays land as a JSON String rather than being unpacked into
 * columns or ClickHouse nested types. A Convex table can hold documents of
 * different shapes, so unpacking would mean a destination schema that changes
 * whenever a new shape appears; the JSON text is stable, and ClickHouse's JSON
 * functions can read into it at query time.
 */
export function mapConvexTypeToClickhouse(node: JsonSchemaNode): string {
  const description = node.$description ?? "";
  if (description.startsWith("Id(")) return "String";
  if (description.includes("int64")) return "Int64";
  if (description.includes("base64 bytes")) return "String";

  // A union of types (a field that is sometimes a string, sometimes a number)
  // has no single column that fits, so it keeps its JSON text.
  const type = Array.isArray(node.type) ? null : node.type;
  switch (type) {
    case "string": {
      return "String";
    }
    case "boolean": {
      return "Bool";
    }
    case "number": {
      // Convex numbers are IEEE doubles; Float64 is exact for them.
      return "Float64";
    }
    case "null": {
      // Seen only as null so far. String keeps the column readable if a later
      // document gives the field a real value.
      return "String";
    }
    default: {
      return "String";
    }
  }
}

export function describeConvexType(node: JsonSchemaNode): string {
  const description = node.$description ?? "";
  if (description.startsWith("Id(")) return description;
  if (description.includes("int64")) return "int64";
  if (description.includes("base64 bytes")) return "bytes";
  if (Array.isArray(node.type)) return node.type.join(" | ");
  return node.type ?? "unknown";
}

/**
 * Only the root app's tables are catalogued. Convex's schema endpoint does not
 * enumerate installed components, so a table inside one is never offered in the
 * picker and therefore never synced — the sync loop still matches changes by
 * component, so supporting them later is a catalog change alone.
 */
function readTable(tableName: string, schema: JsonSchemaNode): ProbedTable {
  const properties = schema.properties ?? {};
  const alwaysPresent = new Set(schema.required ?? []);
  const columns: DataSourceColumn[] = Object.entries(properties).map(([name, node]) => ({
    name,
    dataType: describeConvexType(node),
    // A field absent from `required` is one only some documents carry, which is
    // exactly what nullable means at the destination.
    nullable: !alwaysPresent.has(name),
    clickhouseType: name === CONVEX_CREATION_TIME_COLUMN
      // Convex stores it as a float of milliseconds. Kept as a real timestamp so
      // the customer can filter on it without converting first.
      ? "DateTime64(3)"
      : mapConvexTypeToClickhouse(node),
  }));

  // `_id` is guaranteed, but a table Convex has never seen a document in reports
  // no properties at all. Adding it keeps such a table syncable — its first
  // document will arrive through the change feed like any other.
  if (!columns.some(column => column.name === CONVEX_ID_COLUMN)) {
    columns.unshift({ name: CONVEX_ID_COLUMN, dataType: `Id(${tableName})`, nullable: false, clickhouseType: "String" });
  }

  return {
    schemaName: CONVEX_ROOT_COMPONENT,
    tableName,
    columns,
    // Convex does not expose a row-count estimate, and guessing one would feed a
    // size gate a number it has no business trusting.
    approxRows: null,
    primaryKeyColumns: [CONVEX_ID_COLUMN],
    // Cursor mode is not offered for Convex at all, so there is nothing to pick.
    cursorCandidates: [],
  };
}

async function readCatalog(credentials: ConvexCredentials): Promise<ProbedTable[]> {
  // The schemas Convex infers from the documents it holds. This is a catalog
  // read, not the change feed, so it stays cheap enough to run on every sync —
  // which is what keeps the destination in step with fields added since setup.
  const response = await convexRequest(credentials, "/api/json_schemas", { method: "GET" });
  if (response == null) return [];
  if (typeof response !== "object" || Array.isArray(response)) {
    throw new StatusError(StatusError.BadRequest, "Convex returned a table list we could not read.");
  }

  return Object.entries(response as Record<string, JsonSchemaNode>)
    .map(([tableName, schema]) => readTable(tableName, schema))
    .sort((a, b) => stringCompare(a.tableName, b.tableName));
}

/**
 * Reads what the deployment holds, and at connect time also confirms the deploy
 * key can read the change feed.
 *
 * The two fail differently: a key can be valid for the catalog while streaming
 * export is refused, and finding that out while the customer is still on the
 * connect screen is much better than at the first scheduled sync.
 *
 * That check is *not* repeated before every sync. A cursor-less call to the feed
 * is page one of a fresh deployment-wide snapshot, so running it every minute
 * would download and parse a large response purely to read its status code, and
 * would consume the customer's streaming-export quota to do it. The sync's own
 * first page surfaces the same failure a moment later anyway.
 */
export async function probeConvex(
  connection: DataSourceConnection,
  options?: { verifyAccess?: boolean },
): Promise<DataSourceProbeResult> {
  const credentials = await toConvexCredentials(connection);
  const tables = await readCatalog(credentials);

  if (options?.verifyAccess === true) {
    // Reads the first page and discards it, including the cursor. Nothing on the
    // deployment changes: the feed is only consumed by advancing a cursor we keep.
    await convexRequest(credentials, "/api/v1/data/sync", { method: "POST", body: {} });
  }

  const capabilities: ConvexCapabilities = {
    type: "convex",
    deploymentUrl: credentials.deploymentUrl,
    probedAtMillis: Date.now(),
  };
  return { capabilities, tables };
}
