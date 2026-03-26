"use client";

import { DesignSelectorDropdown, DesignSelectorOptionGroup } from "@/components/design-components/select";
import { DesignInput } from "@/components/design-components/input";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { cn } from "@/lib/utils";
import { LinkSimpleIcon, PlusIcon, SpinnerGapIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApp } from "../use-admin-app";

// ============================================================================
// Schema — fixed table-level columns. Data paths discovered at runtime.
// ============================================================================

const OPERATORS_BY_TYPE = {
  string: ["=", "!=", "LIKE", "NOT LIKE", "IS NULL", "IS NOT NULL"],
  datetime: [">", "<", ">=", "<=", "=", "!=", "IS NULL", "IS NOT NULL"],
} as const;

type ColumnType = keyof typeof OPERATORS_BY_TYPE;

const EVENTS_TABLE_COLUMNS = {
  event_type: { type: "string", label: "Event Type" },
  event_id: { type: "string", label: "Event ID" },
  trace_id: { type: "string", label: "Trace ID" },
  parent_span_ids: { type: "string", label: "Parent Span IDs" },
  event_at: { type: "datetime", label: "Event At" },
  created_at: { type: "datetime", label: "Created At" },
  user_id: { type: "string", label: "User ID" },
  team_id: { type: "string", label: "Team ID" },
  refresh_token_id: { type: "string", label: "Refresh Token" },
  session_replay_id: { type: "string", label: "Session Replay" },
  session_replay_segment_id: { type: "string", label: "Segment ID" },
  from_server: { type: "string", label: "From Server" },
} as const satisfies Record<string, { type: ColumnType; label: string }>;

const SPANS_TABLE_COLUMNS: Record<string, { type: ColumnType; label: string }> = {
  span_type: { type: "string", label: "Span Type" },
  span_id: { type: "string", label: "Span ID" },
  trace_id: { type: "string", label: "Trace ID" },
  started_at: { type: "datetime", label: "Started At" },
  created_at: { type: "datetime", label: "Created At" },
  ended_at: { type: "datetime", label: "Ended At" },
  parent_ids: { type: "string", label: "Parent IDs" },
  user_id: { type: "string", label: "User ID" },
  team_id: { type: "string", label: "Team ID" },
  refresh_token_id: { type: "string", label: "Refresh Token ID" },
  session_replay_id: { type: "string", label: "Session Replay ID" },
  session_replay_segment_id: { type: "string", label: "Segment ID" },
  from_server: { type: "string", label: "From Server" },
};

export const TABLE_CONFIGS = {
  events: {
    columns: EVENTS_TABLE_COLUMNS,
    jsonColumn: "data",
    discoveryQueries: {
      types: "SELECT DISTINCT event_type FROM default.events ORDER BY event_type LIMIT 500",
      paths: "SELECT DISTINCT arrayJoin(JSONAllPaths(data)) AS path FROM default.events ORDER BY path LIMIT 500",
    },
    typesResultKey: "event_type",
    defaultFilterColumn: "event_type",
    defaultOrderBy: "event_at",
    sqlTable: "default.events",
  },
  spans: {
    columns: SPANS_TABLE_COLUMNS,
    jsonColumn: "data",
    discoveryQueries: {
      types: "SELECT DISTINCT span_type FROM default.spans ORDER BY span_type LIMIT 500",
      paths: "SELECT DISTINCT arrayJoin(JSONAllPaths(data)) AS path FROM default.spans ORDER BY path LIMIT 500",
    },
    typesResultKey: "span_type",
    defaultFilterColumn: "span_type",
    defaultOrderBy: "started_at",
    sqlTable: "default.spans",
  },
} as const;

export type QueryTable = keyof typeof TABLE_CONFIGS;

// ============================================================================
// Join configuration
// ============================================================================

export const TABLE_ALIASES: Record<QueryTable, string> = {
  events: "e",
  spans: "s",
};

const JOIN_TYPES = ["JOIN", "LEFT JOIN", "RIGHT JOIN"] as const;
type JoinType = typeof JOIN_TYPES[number];

function getOtherTable(table: QueryTable): QueryTable {
  return table === "events" ? "spans" : "events";
}

function getCommonJoinColumns(table1: QueryTable, table2: QueryTable): string[] {
  const cols1 = new Set(Object.keys(getTableColumns(table1)));
  const cols2 = Object.keys(getTableColumns(table2));
  return cols2.filter((c) => cols1.has(c));
}

// ============================================================================
// Helpers
// ============================================================================

function getTableColumns(table: QueryTable) {
  return TABLE_CONFIGS[table].columns;
}

function getSelectColumns(table: QueryTable) {
  const cols = getTableColumns(table);
  const jsonCol = TABLE_CONFIGS[table].jsonColumn;
  return { ...cols, [jsonCol]: { label: jsonCol.charAt(0).toUpperCase() + jsonCol.slice(1) } } as Record<string, { type?: ColumnType; label: string }>;
}

function getSelectColumnNames(table: QueryTable): string[] {
  return Object.keys(getSelectColumns(table));
}

function getTableColumnNames(table: QueryTable): string[] {
  return Object.keys(getTableColumns(table));
}

function getOrderColumnOptions(table: QueryTable) {
  const selectCols = getSelectColumns(table);
  return Object.keys(selectCols).map((n) => ({
    value: n,
    label: selectCols[n].label,
  }));
}

const UNARY_OPERATORS = new Set(["IS NULL", "IS NOT NULL"]);

function isTableColumn(v: string, table: QueryTable): boolean {
  return v in getTableColumns(table);
}

function isSelectColumn(v: string, table: QueryTable): boolean {
  return v in getSelectColumns(table);
}

/**
 * Resolve an alias-prefixed column (e.g. "e.event_type") to its table and bare column name.
 */
function resolveAliasedColumn(col: string): { table: QueryTable; column: string } | null {
  for (const [tableId, alias] of Object.entries(TABLE_ALIASES) as [QueryTable, string][]) {
    if (col.startsWith(alias + ".")) {
      return { table: tableId, column: col.slice(alias.length + 1) };
    }
  }
  return null;
}

function getColumnType(col: string, table: QueryTable): ColumnType {
  // Handle alias-prefixed columns (e.g. "e.event_type")
  const resolved = resolveAliasedColumn(col);
  if (resolved) {
    return getColumnType(resolved.column, resolved.table);
  }
  if (isTableColumn(col, table)) {
    const cols = getTableColumns(table) as Record<string, { type: ColumnType }>;
    return cols[col].type;
  }
  return "string"; // json paths default to string
}

function operatorOptionsFor(col: string, table: QueryTable) {
  return OPERATORS_BY_TYPE[getColumnType(col, table)].map((op) => ({ value: op, label: op }));
}

// ============================================================================
// Discovery
// ============================================================================

type DiscoveredSchema = {
  typeValues: string[]; // event_type values for events, name values for metrics
  jsonPaths: string[]; // raw paths from JSONAllPaths (without json column prefix)
};

// ============================================================================
// SQL generation
// ============================================================================

function escapeString(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

type Filter = {
  id: string;
  column: string; // table column name, "data.some.path", or alias-prefixed like "e.event_type"
  operator: string;
  value: string;
};

type FilterGroup = {
  id: string;
  filters: Filter[];
};

type JoinConfig = {
  joinType: JoinType;
  leftColumn: string;  // bare column name from primary table
  rightColumn: string; // bare column name from join table
};

type BuilderState = {
  selectAll: boolean;
  selectedColumns: string[];
  filterGroups: FilterGroup[];
  orderBy: string;
  orderDir: "ASC" | "DESC";
  limit: number;
  join: JoinConfig | null;
};

function buildGroupConditions(filters: Filter[]): string[] {
  const LIKE_OPERATORS = new Set(["LIKE", "NOT LIKE"]);
  return filters.flatMap((f) => {
    if (UNARY_OPERATORS.has(f.operator)) return [`${f.column} ${f.operator}`];
    if (!f.value.trim()) return [];
    const escaped = escapeString(f.value);
    const val = LIKE_OPERATORS.has(f.operator) ? `%${escaped}%` : escaped;
    return [`${f.column} ${f.operator} '${val}'`];
  });
}

export function buildSql(s: BuilderState, table: QueryTable = "events"): string {
  const config = TABLE_CONFIGS[table];

  if (s.join) {
    const joinTable = getOtherTable(table);
    const joinTableConfig = TABLE_CONFIGS[joinTable];
    const a = TABLE_ALIASES[table];
    const ja = TABLE_ALIASES[joinTable];

    const cols =
      s.selectAll || s.selectedColumns.length === 0
        ? "*"
        : s.selectedColumns.join(", ");

    let sql = `SELECT ${cols}\nFROM ${config.sqlTable} ${a}`;
    sql += `\n${s.join.joinType} ${joinTableConfig.sqlTable} ${ja} ON ${a}.${s.join.leftColumn} = ${ja}.${s.join.rightColumn}`;

    const orClauses = s.filterGroups
      .map((g) => buildGroupConditions(g.filters))
      .filter((conds) => conds.length > 0);

    if (orClauses.length === 1) {
      sql += `\nWHERE ${orClauses[0].join("\n  AND ")}`;
    } else if (orClauses.length > 1) {
      const parts = orClauses.map((conds) =>
        conds.length === 1 ? conds[0] : `(${conds.join(" AND ")})`
      );
      sql += `\nWHERE ${parts.join("\n  OR ")}`;
    }

    sql += `\nORDER BY ${s.orderBy} ${s.orderDir}`;
    sql += `\nLIMIT ${s.limit}`;
    return sql;
  }

  // Single table (original logic)
  const cols =
    s.selectAll || s.selectedColumns.length === 0
      ? "*"
      : s.selectedColumns.join(", ");

  let sql = `SELECT ${cols}\nFROM ${config.sqlTable}`;

  const orClauses = s.filterGroups
    .map((g) => buildGroupConditions(g.filters))
    .filter((conds) => conds.length > 0);

  if (orClauses.length === 1) {
    sql += `\nWHERE ${orClauses[0].join("\n  AND ")}`;
  } else if (orClauses.length > 1) {
    const parts = orClauses.map((conds) =>
      conds.length === 1 ? conds[0] : `(${conds.join(" AND ")})`
    );
    sql += `\nWHERE ${parts.join("\n  OR ")}`;
  }

  sql += `\nORDER BY ${s.orderBy} ${s.orderDir}`;
  sql += `\nLIMIT ${s.limit}`;
  return sql;
}

let nextFilterId = 0;
let nextGroupId = 0;

// ============================================================================
// SQL parsing (reverse of buildSql)
// ============================================================================

function unescapeString(s: string): string {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function parseCondition(cond: string): Filter | null {
  const trimmed = cond.trim();
  let match: RegExpMatchArray | null;

  match = trimmed.match(/^([\w.]+)\s+IS\s+NOT\s+NULL$/i);
  if (match) return { id: `qb-${++nextFilterId}`, column: match[1], operator: "IS NOT NULL", value: "" };

  match = trimmed.match(/^([\w.]+)\s+IS\s+NULL$/i);
  if (match) return { id: `qb-${++nextFilterId}`, column: match[1], operator: "IS NULL", value: "" };

  match = trimmed.match(/^([\w.]+)\s+NOT\s+LIKE\s+'%(.*?)%'$/i);
  if (match) return { id: `qb-${++nextFilterId}`, column: match[1], operator: "NOT LIKE", value: unescapeString(match[2]) };

  match = trimmed.match(/^([\w.]+)\s+LIKE\s+'%(.*?)%'$/i);
  if (match) return { id: `qb-${++nextFilterId}`, column: match[1], operator: "LIKE", value: unescapeString(match[2]) };

  match = trimmed.match(/^([\w.]+)\s+(!=|>=|<=|=|>|<)\s+'(.*)'$/);
  if (match) return { id: `qb-${++nextFilterId}`, column: match[1], operator: match[2], value: unescapeString(match[3]) };

  return null;
}

function splitAtTopLevel(str: string, keyword: "AND" | "OR"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === "'") {
      if (!inQuote) {
        inQuote = true;
      } else if (i > 0 && str[i - 1] === "\\") {
        // escaped quote, stay in quote
      } else {
        inQuote = false;
      }
      current += ch;
      continue;
    }
    if (inQuote) {
      current += ch;
      continue;
    }

    if (ch === "(") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      current += ch;
      continue;
    }

    if (depth === 0) {
      const rest = str.slice(i);
      const m = rest.match(new RegExp(`^\\s+${keyword}\\s+`, "i"));
      if (m) {
        parts.push(current.trim());
        i += m[0].length - 1;
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripOuterParens(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "(") depth++;
      if (trimmed[i] === ")") depth--;
      if (depth === 0 && i < trimmed.length - 1) return trimmed;
    }
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeSql(s: string): string {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

function parseFilterGroups(wherePart: string): FilterGroup[] {
  const filterGroups: FilterGroup[] = [];
  const orParts = splitAtTopLevel(wherePart, "OR");
  for (const orPart of orParts) {
    const stripped = stripOuterParens(orPart);
    const andParts = splitAtTopLevel(stripped, "AND");
    const filters: Filter[] = [];
    for (const condStr of andParts) {
      const filter = parseCondition(condStr);
      if (!filter) return []; // return empty on parse failure
      filters.push(filter);
    }
    if (filters.length > 0) {
      filterGroups.push({ id: `qbg-${++nextGroupId}`, filters });
    }
  }
  return filterGroups;
}

export function parseSql(sql: string): { state: BuilderState; table: QueryTable } | null {
  const norm = sql.replace(/\s+/g, " ").trim();

  const tableEntries = Object.entries(TABLE_CONFIGS) as [QueryTable, typeof TABLE_CONFIGS[QueryTable]][];

  // ── Try JOIN syntax first ──
  for (const [primaryId, primaryConfig] of tableEntries) {
    for (const [joinId, joinConfig] of tableEntries) {
      if (primaryId === joinId) continue;

      const primaryEscaped = primaryConfig.sqlTable.replace(/\./g, "\\.");
      const joinEscaped = joinConfig.sqlTable.replace(/\./g, "\\.");

      // Match: SELECT ... FROM table1 alias (LEFT|RIGHT)? JOIN table2 alias ON a.col = b.col (WHERE ...)? ORDER BY col DIR LIMIT n
      const joinRegex = new RegExp(
        `^SELECT\\s+(.+?)\\s+FROM\\s+${primaryEscaped}\\s+(\\w+)\\s+` +
        `((?:LEFT|RIGHT)\\s+)?JOIN\\s+${joinEscaped}\\s+(\\w+)\\s+` +
        `ON\\s+(\\w+(?:\\.\\w+)+)\\s*=\\s*(\\w+(?:\\.\\w+)+)` +
        `(?:\\s+WHERE\\s+(.+?))?` +
        `\\s+ORDER\\s+BY\\s+(\\S+)\\s+(ASC|DESC)\\s+LIMIT\\s+(\\d+)$`,
        "i"
      );

      const joinMatch = norm.match(joinRegex);
      if (!joinMatch) continue;

      const [, selectPart, , joinTypePrefix, , onLeft, onRight, wherePart, orderCol, orderDirStr, limitStr] = joinMatch;

      const joinType = (joinTypePrefix ? joinTypePrefix.trim() + " JOIN" : "JOIN").toUpperCase() as JoinType;

      // Strip aliases from ON columns
      const leftCol = onLeft.includes(".") ? onLeft.split(".").slice(1).join(".") : onLeft;
      const rightCol = onRight.includes(".") ? onRight.split(".").slice(1).join(".") : onRight;

      // Parse SELECT
      let selectAll: boolean;
      let selectedColumns: string[];
      if (selectPart.trim() === "*") {
        selectAll = true;
        selectedColumns = [];
      } else {
        selectAll = false;
        selectedColumns = selectPart.split(/\s*,\s*/).map((c) => c.trim()).filter(Boolean);
        if (selectedColumns.length === 0) continue;
      }

      // Parse ORDER BY & LIMIT
      const orderBy = orderCol;
      const orderDir = orderDirStr.toUpperCase() as "ASC" | "DESC";
      const limit = parseInt(limitStr, 10);
      if (limit < 1 || limit > 10000) continue;

      // Parse WHERE
      const filterGroups = wherePart ? parseFilterGroups(wherePart) : [];

      return {
        state: {
          selectAll,
          selectedColumns,
          filterGroups,
          orderBy,
          orderDir,
          limit,
          join: { joinType, leftColumn: leftCol, rightColumn: rightCol },
        },
        table: primaryId,
      };
    }
  }

  // ── Try single-table syntax ──
  for (const [tableId, config] of tableEntries) {
    const escapedTable = config.sqlTable.replace(/\./g, "\\.");
    const regex = new RegExp(
      `^SELECT\\s+(.+?)\\s+FROM\\s+${escapedTable}(?:\\s+WHERE\\s+(.+?))?\\s+ORDER\\s+BY\\s+(\\S+)\\s+(ASC|DESC)\\s+LIMIT\\s+(\\d+)$`,
      "i"
    );
    const structMatch = norm.match(regex);
    if (!structMatch) continue;

    const [, selectPart, wherePart, orderCol, orderDirStr, limitStr] = structMatch;

    // Parse SELECT
    let selectAll: boolean;
    let selectedColumns: string[];
    if (selectPart.trim() === "*") {
      selectAll = true;
      selectedColumns = [];
    } else {
      selectAll = false;
      const rawCols = selectPart.split(/\s*,\s*/);
      selectedColumns = [];
      for (const col of rawCols) {
        if (!isSelectColumn(col, tableId)) return null;
        selectedColumns.push(col);
      }
      if (selectedColumns.length === 0) return null;
    }

    // Parse ORDER BY
    if (!isSelectColumn(orderCol, tableId)) return null;
    const orderBy = orderCol;
    const orderDir = orderDirStr.toUpperCase() as "ASC" | "DESC";

    // Parse LIMIT
    const limit = parseInt(limitStr, 10);
    if (limit < 1 || limit > 10000) return null;

    // Parse WHERE
    let filterGroups: FilterGroup[] = [];
    if (wherePart) {
      const orParts = splitAtTopLevel(wherePart, "OR");
      for (const orPart of orParts) {
        const stripped = stripOuterParens(orPart);
        const andParts = splitAtTopLevel(stripped, "AND");
        const filters: Filter[] = [];
        for (const condStr of andParts) {
          const filter = parseCondition(condStr);
          if (!filter) return null;
          filters.push(filter);
        }
        if (filters.length > 0) {
          filterGroups.push({ id: `qbg-${++nextGroupId}`, filters });
        }
      }
    }

    return { state: { selectAll, selectedColumns, filterGroups, orderBy, orderDir, limit, join: null }, table: tableId };
  }

  return null;
}

// ============================================================================
// Component
// ============================================================================

export function QueryBuilder({
  sql: externalSql,
  onSqlChange,
  table = "events",
}: {
  sql: string;
  onSqlChange: (sql: string) => void;
  table?: QueryTable;
}) {
  const adminApp = useAdminApp();
  const config = TABLE_CONFIGS[table];
  const selectColumnNames = useMemo(() => getSelectColumnNames(table), [table]);
  const orderColumnOptions = useMemo(() => getOrderColumnOptions(table), [table]);

  // Discovery state (primary table)
  const [discovered, setDiscovered] = useState<DiscoveredSchema | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const discoveryRan = useRef(false);

  // Join state
  const [joinEnabled, setJoinEnabled] = useState(false);
  const [joinType, setJoinType] = useState<JoinType>("JOIN");
  const [joinLeftColumn, setJoinLeftColumn] = useState<string>("");
  const [joinRightColumn, setJoinRightColumn] = useState<string>("");

  // Discovery state (join table)
  const [joinDiscovered, setJoinDiscovered] = useState<DiscoveredSchema | null>(null);
  const [joinDiscovering, setJoinDiscovering] = useState(false);
  const joinDiscoveryRan = useRef(false);

  const joinTable = getOtherTable(table);
  const joinTableConfig = TABLE_CONFIGS[joinTable];
  const primaryAlias = TABLE_ALIASES[table];
  const joinAlias = TABLE_ALIASES[joinTable];

  // Common join columns for the ON condition
  const commonJoinColumns = useMemo(() => getCommonJoinColumns(table, joinTable), [table, joinTable]);

  // Initialize default join columns
  useEffect(() => {
    if (commonJoinColumns.length > 0 && !joinLeftColumn) {
      // Default to user_id if available, otherwise first common column
      const defaultCol = commonJoinColumns.includes("user_id") ? "user_id" : commonJoinColumns[0];
      setJoinLeftColumn(defaultCol);
      setJoinRightColumn(defaultCol);
    }
  }, [commonJoinColumns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Builder state
  const [selectAll, setSelectAll] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [orderBy, setOrderBy] = useState<string>(config.defaultOrderBy);
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("DESC");
  const [limit, setLimit] = useState(100);

  // Run discovery on mount (primary table)
  useEffect(() => {
    if (discoveryRan.current) return;
    discoveryRan.current = true;
    setDiscovering(true);

    const run = async (query: string) => {
      try {
        const res = await adminApp.queryAnalytics({
          query,
          include_all_branches: false,
          timeout_ms: 10_000,
        });
        return res.result;
      } catch {
        return [];
      }
    };

    void Promise.all([run(config.discoveryQueries.types), run(config.discoveryQueries.paths)])
      .then(([typeRows, pathRows]) => {
        setDiscovered({
          typeValues: typeRows
            .map((r) => r[config.typesResultKey])
            .filter((v): v is string => typeof v === "string"),
          jsonPaths: pathRows
            .map((r) => r.path)
            .filter((v): v is string => typeof v === "string"),
        });
      })
      .catch(() => {})
      .finally(() => setDiscovering(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once on mount

  // Run discovery for join table when join is enabled
  useEffect(() => {
    if (!joinEnabled || joinDiscoveryRan.current) return;
    joinDiscoveryRan.current = true;
    setJoinDiscovering(true);

    const run = async (query: string) => {
      try {
        const res = await adminApp.queryAnalytics({
          query,
          include_all_branches: false,
          timeout_ms: 10_000,
        });
        return res.result;
      } catch {
        return [];
      }
    };

    void Promise.all([run(joinTableConfig.discoveryQueries.types), run(joinTableConfig.discoveryQueries.paths)])
      .then(([typeRows, pathRows]) => {
        setJoinDiscovered({
          typeValues: typeRows
            .map((r) => r[joinTableConfig.typesResultKey])
            .filter((v): v is string => typeof v === "string"),
          jsonPaths: pathRows
            .map((r) => r.path)
            .filter((v): v is string => typeof v === "string"),
        });
      })
      .catch(() => {})
      .finally(() => setJoinDiscovering(false));
  }, [joinEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Column options for join mode ──

  const joinSelectColumnNames = useMemo(() => {
    if (!joinEnabled) return selectColumnNames;
    const primaryCols = getSelectColumnNames(table).map((c) => `${primaryAlias}.${c}`);
    const jCols = getSelectColumnNames(joinTable).map((c) => `${joinAlias}.${c}`);
    return [...primaryCols, ...jCols];
  }, [joinEnabled, table, joinTable, primaryAlias, joinAlias, selectColumnNames]);

  const joinOrderColumnOptions = useMemo(() => {
    if (!joinEnabled) return orderColumnOptions;
    const primaryCols = getSelectColumns(table);
    const jCols = getSelectColumns(joinTable);
    return [
      ...Object.keys(primaryCols).map((n) => ({ value: `${primaryAlias}.${n}`, label: `${primaryAlias}.${primaryCols[n].label}` })),
      ...Object.keys(jCols).map((n) => ({ value: `${joinAlias}.${n}`, label: `${joinAlias}.${jCols[n].label}` })),
    ];
  }, [joinEnabled, table, joinTable, primaryAlias, joinAlias, orderColumnOptions]);

  // Derived filter column options (grouped with collapsible data fields)
  const filterColumnGroups = useMemo((): DesignSelectorOptionGroup[] => {
    if (!joinEnabled) {
      // Single table mode
      const tableCols = getTableColumns(table);
      const colNames = getTableColumnNames(table);
      const groups: DesignSelectorOptionGroup[] = [{
        key: "columns",
        label: "Columns",
        options: colNames.map((n) => ({ value: n, label: (tableCols as Record<string, { label: string }>)[n].label })),
      }];

      if (discovered && discovered.jsonPaths.length > 0) {
        const jsonCol = config.jsonColumn;
        const label = jsonCol.charAt(0).toUpperCase() + jsonCol.slice(1);
        groups.push({
          key: "data_fields",
          label: `${label} Fields`,
          collapsible: true,
          defaultCollapsed: true,
          options: discovered.jsonPaths.map((p) => ({ value: `${jsonCol}.${p}`, label: `${jsonCol}.${p}` })),
        });
      }

      return groups;
    }

    // Join mode: show columns from both tables with alias prefix
    const groups: DesignSelectorOptionGroup[] = [];

    // Primary table
    const primaryCols = getTableColumns(table);
    const primaryColNames = getTableColumnNames(table);
    const primaryLabel = table.charAt(0).toUpperCase() + table.slice(1);
    groups.push({
      key: "primary_columns",
      label: `${primaryLabel} (${primaryAlias})`,
      options: primaryColNames.map((n) => ({
        value: `${primaryAlias}.${n}`,
        label: `${primaryAlias}.${(primaryCols as Record<string, { label: string }>)[n].label}`,
      })),
    });

    // Primary table discovered json paths
    if (discovered && discovered.jsonPaths.length > 0) {
      const jsonCol = config.jsonColumn;
      groups.push({
        key: "primary_data_fields",
        label: `${primaryAlias}.${jsonCol} Fields`,
        collapsible: true,
        defaultCollapsed: true,
        options: discovered.jsonPaths.map((p) => ({
          value: `${primaryAlias}.${jsonCol}.${p}`,
          label: `${primaryAlias}.${jsonCol}.${p}`,
        })),
      });
    }

    // Join table
    const jCols = getTableColumns(joinTable);
    const jColNames = getTableColumnNames(joinTable);
    const jLabel = joinTable.charAt(0).toUpperCase() + joinTable.slice(1);
    groups.push({
      key: "join_columns",
      label: `${jLabel} (${joinAlias})`,
      options: jColNames.map((n) => ({
        value: `${joinAlias}.${n}`,
        label: `${joinAlias}.${(jCols as Record<string, { label: string }>)[n].label}`,
      })),
    });

    // Join table discovered json paths
    if (joinDiscovered && joinDiscovered.jsonPaths.length > 0) {
      const jsonCol = joinTableConfig.jsonColumn;
      groups.push({
        key: "join_data_fields",
        label: `${joinAlias}.${jsonCol} Fields`,
        collapsible: true,
        defaultCollapsed: true,
        options: joinDiscovered.jsonPaths.map((p) => ({
          value: `${joinAlias}.${jsonCol}.${p}`,
          label: `${joinAlias}.${jsonCol}.${p}`,
        })),
      });
    }

    return groups;
  }, [joinEnabled, discovered, joinDiscovered, table, joinTable, primaryAlias, joinAlias, config.jsonColumn, joinTableConfig.jsonColumn]);

  // Join condition column options
  const joinOnLeftOptions = useMemo(() => {
    const cols = getTableColumns(table);
    return Object.keys(cols).map((n) => ({ value: n, label: (cols as Record<string, { label: string }>)[n].label }));
  }, [table]);

  const joinOnRightOptions = useMemo(() => {
    const cols = getTableColumns(joinTable);
    return Object.keys(cols).map((n) => ({ value: n, label: (cols as Record<string, { label: string }>)[n].label }));
  }, [joinTable]);

  // SQL generation
  const state: BuilderState = useMemo(
    () => ({
      selectAll,
      selectedColumns,
      filterGroups,
      orderBy,
      orderDir,
      limit,
      join: joinEnabled ? { joinType, leftColumn: joinLeftColumn, rightColumn: joinRightColumn } : null,
    }),
    [selectAll, selectedColumns, filterGroups, orderBy, orderDir, limit, joinEnabled, joinType, joinLeftColumn, joinRightColumn]
  );

  const builtSql = useMemo(() => buildSql(state, table), [state, table]);
  const suppressEmit = useRef(false);

  // Emit SQL to parent when builder UI drives the change
  useEffect(() => {
    if (suppressEmit.current) {
      suppressEmit.current = false;
      return;
    }
    onSqlChange(builtSql);
  }, [builtSql, onSqlChange]);

  // Parse external SQL (textarea edits) back into builder state
  useEffect(() => {
    if (normalizeSql(externalSql) === normalizeSql(builtSql)) return;

    const parsed = parseSql(externalSql);
    if (!parsed) return;

    // Only update if the parsed state would produce different SQL
    const parsedBuilt = buildSql(parsed.state, table);
    if (normalizeSql(parsedBuilt) === normalizeSql(builtSql)) return;

    suppressEmit.current = true;
    setSelectAll(parsed.state.selectAll);
    setSelectedColumns(parsed.state.selectedColumns);
    setFilterGroups(parsed.state.filterGroups);
    setOrderBy(parsed.state.orderBy);
    setOrderDir(parsed.state.orderDir);
    setLimit(parsed.state.limit);

    if (parsed.state.join) {
      setJoinEnabled(true);
      setJoinType(parsed.state.join.joinType);
      setJoinLeftColumn(parsed.state.join.leftColumn);
      setJoinRightColumn(parsed.state.join.rightColumn);
    } else {
      setJoinEnabled(false);
    }
  }, [externalSql]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to external sql changes

  // --- handlers ---

  const defaultFilterColumn = joinEnabled ? `${primaryAlias}.${config.defaultFilterColumn}` : config.defaultFilterColumn;
  const defaultOrderByCol = joinEnabled ? `${primaryAlias}.${config.defaultOrderBy}` : config.defaultOrderBy;

  const handleToggleJoin = useCallback(() => {
    setJoinEnabled((prev) => {
      const enabling = !prev;
      // Reset columns and order when toggling join mode
      setSelectAll(true);
      setSelectedColumns([]);
      setFilterGroups([]);
      if (enabling) {
        setOrderBy(`${TABLE_ALIASES[table]}.${TABLE_CONFIGS[table].defaultOrderBy}`);
      } else {
        setOrderBy(TABLE_CONFIGS[table].defaultOrderBy);
      }
      return enabling;
    });
  }, [table]);

  const addFilterToGroup = useCallback((groupId: string) => {
    setFilterGroups((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, filters: [...g.filters, { id: `qb-${++nextFilterId}`, column: defaultFilterColumn, operator: "=", value: "" }] }
      )
    );
  }, [defaultFilterColumn]);

  const addGroup = useCallback(() => {
    setFilterGroups((prev) => [
      ...prev,
      { id: `qbg-${++nextGroupId}`, filters: [{ id: `qb-${++nextFilterId}`, column: defaultFilterColumn, operator: "=", value: "" }] },
    ]);
  }, [defaultFilterColumn]);

  const removeFilter = useCallback((groupId: string, filterId: string) => {
    setFilterGroups((prev) => {
      const next = prev
        .map((g) =>
          g.id !== groupId ? g : { ...g, filters: g.filters.filter((f) => f.id !== filterId) }
        )
        .filter((g) => g.filters.length > 0);
      return next;
    });
  }, []);

  const updateFilter = useCallback(
    (groupId: string, filterId: string, patch: Partial<Pick<Filter, "column" | "operator" | "value">>) => {
      setFilterGroups((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
              ...g,
              filters: g.filters.map((f) => {
                if (f.id !== filterId) return f;
                const next = { ...f, ...patch };
                if (patch.column && patch.column !== f.column) {
                  const ops = OPERATORS_BY_TYPE[getColumnType(patch.column, table)];
                  if (!ops.some((o) => o === next.operator)) {
                    next.operator = ops[0];
                  }
                  next.value = "";
                }
                return next;
              }),
            }
        )
      );
    },
    [table]
  );

  const activeSelectColumnNames = joinEnabled ? joinSelectColumnNames : selectColumnNames;

  const toggleColumn = useCallback(
    (col: string) => {
      if (selectAll) {
        setSelectAll(false);
        setSelectedColumns(activeSelectColumnNames.filter((c) => c !== col));
        return;
      }
      setSelectedColumns((prev) => {
        const next = prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col];
        if (next.length === 0 || next.length === activeSelectColumnNames.length) {
          setSelectAll(true);
          return [];
        }
        return next;
      });
    },
    [selectAll, activeSelectColumnNames]
  );

  // Determine which column gets the type autocomplete datalist
  const typeFilterColumn = joinEnabled ? `${primaryAlias}.${config.defaultFilterColumn}` : config.defaultFilterColumn;
  const joinTypeFilterColumn = joinEnabled ? `${joinAlias}.${joinTableConfig.defaultFilterColumn}` : null;
  const datalistId = `qb-type-values-${table}`;
  const joinDatalistId = `qb-type-values-${joinTable}`;

  // Split join select columns into primary and join groups for display
  const primarySelectCols = useMemo(() =>
    joinEnabled ? getSelectColumnNames(table).map((c) => `${primaryAlias}.${c}`) : selectColumnNames,
    [joinEnabled, table, primaryAlias, selectColumnNames]
  );
  const joinSelectCols = useMemo(() =>
    joinEnabled ? getSelectColumnNames(joinTable).map((c) => `${joinAlias}.${c}`) : [],
    [joinEnabled, joinTable, joinAlias]
  );

  return (
    <div className="space-y-4">
      {/* SELECT columns */}
      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
          Columns
        </span>
        {joinEnabled ? (
          <div className="space-y-2">
            {/* Primary table columns */}
            <div>
              <span className="text-[10px] font-mono text-muted-foreground/60 block mb-1">
                {table} ({primaryAlias})
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => {
                    setSelectAll(true);
                    setSelectedColumns([]);
                  }}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                    selectAll
                      ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                      : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                  )}
                >
                  *
                </button>
                {primarySelectCols.map((col) => (
                  <button
                    key={col}
                    onClick={() => toggleColumn(col)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                      selectAll || selectedColumns.includes(col)
                        ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                        : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                    )}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
            {/* Join table columns */}
            <div>
              <span className="text-[10px] font-mono text-muted-foreground/60 block mb-1">
                {joinTable} ({joinAlias})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {joinSelectCols.map((col) => (
                  <button
                    key={col}
                    onClick={() => toggleColumn(col)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                      selectAll || selectedColumns.includes(col)
                        ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/25"
                        : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                    )}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                setSelectAll(true);
                setSelectedColumns([]);
              }}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                selectAll
                  ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                  : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
              )}
            >
              *
            </button>
            {selectColumnNames.map((col) => (
              <button
                key={col}
                onClick={() => toggleColumn(col)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                  selectAll || selectedColumns.includes(col)
                    ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                    : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                )}
              >
                {col}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* JOIN configuration */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Join
          </span>
          <button
            onClick={handleToggleJoin}
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors duration-150 hover:transition-none",
              joinEnabled
                ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/25"
                : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
            )}
          >
            <LinkSimpleIcon className="h-3 w-3" />
            {joinEnabled ? joinTable : "Add join"}
          </button>
          {(discovering && joinEnabled || joinDiscovering) && (
            <SpinnerGapIcon className="h-3 w-3 text-muted-foreground animate-spin" />
          )}
        </div>
        {joinEnabled && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <DesignSelectorDropdown
                value={joinType}
                onValueChange={(v) => {
                  if (JOIN_TYPES.includes(v as JoinType)) setJoinType(v as JoinType);
                }}
                options={JOIN_TYPES.map((t) => ({ value: t, label: t }))}
                size="sm"
                className="w-32"
              />
              <SimpleTooltip type="info" tooltip={
                <div className="text-xs space-y-1.5 max-w-xs">
                  <p><span className="font-semibold">JOIN</span> (inner) — only rows that match in both tables</p>
                  <p><span className="font-semibold">LEFT JOIN</span> — all rows from {table}, matched rows from {joinTable} (or nulls)</p>
                  <p><span className="font-semibold">RIGHT JOIN</span> — all rows from {joinTable}, matched rows from {table} (or nulls)</p>
                </div>
              } />
              <span className="text-[11px] font-mono text-muted-foreground">
                {joinTableConfig.sqlTable}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-muted-foreground w-6">ON</span>
              <span className="text-[11px] font-mono text-muted-foreground/60">{primaryAlias}.</span>
              <DesignSelectorDropdown
                value={joinLeftColumn}
                onValueChange={(v) => setJoinLeftColumn(v)}
                options={joinOnLeftOptions}
                size="sm"
                className="w-40"
              />
              <span className="text-[11px] font-mono text-muted-foreground">=</span>
              <span className="text-[11px] font-mono text-muted-foreground/60">{joinAlias}.</span>
              <DesignSelectorDropdown
                value={joinRightColumn}
                onValueChange={(v) => setJoinRightColumn(v)}
                options={joinOnRightOptions}
                size="sm"
                className="w-40"
              />
            </div>
          </div>
        )}
      </div>

      {/* WHERE filters */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filters
          </span>
          {discovering && !joinEnabled && (
            <SpinnerGapIcon className="h-3 w-3 text-muted-foreground animate-spin" />
          )}
        </div>
        {filterGroups.length > 0 && (
          <div className="space-y-2 mb-2">
            {filterGroups.map((group, gi) => (
              <div key={group.id}>
                {gi > 0 && (
                  <div className="flex items-center gap-3 my-2.5">
                    <div className="flex-1 border-t border-orange-500/20" />
                    <span className="text-[11px] font-semibold text-orange-500 dark:text-orange-400 font-mono px-2 py-0.5 rounded bg-orange-500/10">
                      OR
                    </span>
                    <div className="flex-1 border-t border-orange-500/20" />
                  </div>
                )}
                <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-1.5">
                  {group.filters.map((filter, fi) => {
                    const needsValue = !UNARY_OPERATORS.has(filter.operator);
                    // Determine datalist for type autocomplete
                    let filterDatalistId: string | undefined;
                    if (filter.column === typeFilterColumn && discovered?.typeValues.length) {
                      filterDatalistId = datalistId;
                    } else if (filter.column === joinTypeFilterColumn && joinDiscovered?.typeValues.length) {
                      filterDatalistId = joinDatalistId;
                    }

                    return (
                      <div key={filter.id} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground/60 w-7 text-right shrink-0 font-mono">
                          {fi === 0 ? "" : "AND"}
                        </span>
                        <DesignSelectorDropdown
                          value={filter.column}
                          onValueChange={(v) => {
                            if (v) updateFilter(group.id, filter.id, { column: v });
                          }}
                          groups={filterColumnGroups}
                          size="sm"
                          className="w-40 shrink-0"
                        />
                        <DesignSelectorDropdown
                          value={filter.operator}
                          onValueChange={(v) => updateFilter(group.id, filter.id, { operator: v })}
                          options={operatorOptionsFor(filter.column, table)}
                          size="sm"
                          className="w-24 shrink-0"
                        />
                        {needsValue ? (
                          <div className="w-48 shrink-0">
                            <DesignInput
                              value={filter.value}
                              onChange={(e) =>
                                updateFilter(group.id, filter.id, { value: e.target.value })
                              }
                              placeholder={
                                getColumnType(filter.column, table) === "datetime"
                                  ? "2026-01-01 00:00:00"
                                  : "value"
                              }
                              size="sm"
                              list={filterDatalistId}
                            />
                          </div>
                        ) : (
                          <div className="w-48" />
                        )}
                        <button
                          onClick={() => removeFilter(group.id, filter.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors duration-150 hover:transition-none shrink-0"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => addFilterToGroup(group.id)}
                    className="flex items-center gap-1 ml-[34px] px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors duration-150 hover:transition-none"
                  >
                    <PlusIcon className="h-3 w-3" />
                    And
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={addGroup}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors duration-150 hover:transition-none"
        >
          <PlusIcon className="h-3 w-3" />
          {filterGroups.length === 0 ? "Add filter" : "Or"}
        </button>
      </div>

      {/* ORDER BY & LIMIT */}
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
            Order By
          </span>
          <div className="flex gap-1.5">
            <DesignSelectorDropdown
              value={orderBy}
              onValueChange={(v) => setOrderBy(v)}
              options={joinEnabled ? joinOrderColumnOptions : orderColumnOptions}
              size="sm"
            />
            <DesignSelectorDropdown
              value={orderDir}
              onValueChange={(v) => {
                if (v === "ASC" || v === "DESC") setOrderDir(v);
              }}
              options={[
                { value: "DESC", label: "DESC" },
                { value: "ASC", label: "ASC" },
              ]}
              size="sm"
            />
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
            Limit
          </span>
          <div className="w-20">
            <DesignInput
              type="number"
              value={String(limit)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n) && n > 0 && n <= 10000) setLimit(n);
              }}
              size="sm"
            />
          </div>
        </div>
      </div>

      {/* Datalist for type value autocomplete */}
      {discovered && discovered.typeValues.length > 0 && (
        <datalist id={datalistId}>
          {discovered.typeValues.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      )}
      {joinDiscovered && joinDiscovered.typeValues.length > 0 && (
        <datalist id={joinDatalistId}>
          {joinDiscovered.typeValues.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      )}
    </div>
  );
}
