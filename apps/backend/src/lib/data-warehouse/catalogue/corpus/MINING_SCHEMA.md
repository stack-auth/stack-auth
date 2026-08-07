# Connector mining output schema — v2.1

You are extracting FACTS from github.com/estuary/connectors (`source-*` directories,
dual MIT / Apache-2.0). Do NOT copy or translate code. Extract the configuration
facts that the code encodes, and cite where you found each one.

Emit exactly one JSON object matching the shape below. No prose, no markdown fence.

> **v2 changes** (a pilot of 8 connectors produced 42 union misfits; these are the fixes):
> credentials are hoisted out of transport and are a *set* of alternatives; base URLs
> may be templated or runtime-resolved; a connector may have more than one transport;
> a stream list may be mixed static/discovered; a single binding may have *two* pull
> shapes (backfill and incremental); schedules may be cron; and `lease` is replaced by
> `continuity`, which can describe risk accruing on either side.

```jsonc
{
  "id": "<estuary slug, e.g. postgres-batch>",
  "estuaryDir": "source-<slug>",
  "displayName": "<vendor-facing name, e.g. PostgreSQL>",
  "description": "<one sentence: what data this imports>",
  "category": "payments|crm|marketing|support|product|engineering|hr|finance|analytics|database|files|streaming|other",

  // ── how we reach the source ────────────────────────────────────────────
  // A LIST. Most connectors have one entry with role "primary"; some need a
  // second service (e.g. Kafka + Confluent Schema Registry) — give that
  // role "sidecar" and describe what it is for in `purpose`.
  "transports": [
    { "role": "primary"|"sidecar",
      "purpose": str|null,
      "spec":
          { "kind": "http",
            "baseUrl": { "kind": "constant",  "value": str }
                      | { "kind": "template",  "template": str,      // e.g. "https://{dc}.api.mailchimp.com/3.0"
                          "placeholders": { "<name>": "<how it is resolved>" } }
                      | { "kind": "resolved",  "resolution": str }   // e.g. "per-tenant instance_url from the token response"
                      | null,
            "defaultHeaders": {..}|null,
            "apiVersionPinning": str|null }        // header, path segment, or query param — say which
        | { "kind": "sql", "engine": "postgres|mysql|sqlserver|oracle|bigquery|redshift|db2|snowflake|mongodb",
            "defaultPort": int|null, "sslPolicy": str|null, "tunnelSupport": str|null }
        | { "kind": "objectStore", "store": "s3|gcs|azure_blob|sftp|sharepoint|drive|https" }
        | { "kind": "stream", "system": "kafka|kinesis|pubsub|sqs|dynamodb|firestore|other",
            "endpointConfig": str|null }           // how brokers/endpoints are specified
    }
  ],

  // ── credentials ────────────────────────────────────────────────────────
  // TOP LEVEL, not inside a transport: sql / objectStore / stream connectors
  // have credentials too. A LIST, because connectors commonly offer
  // alternatives (API key OR OAuth; static keys OR assumed IAM role).
  "credentialModes": [
    { "name": str,                                 // e.g. "API key", "AWS IAM role"
      "appliesToTransport": "primary"|"sidecar",
      "tier": "T1_SIMPLE|T2_BYO_APP|T3_BYO_REFRESH",
      "scheme":
          { "type": "bearer", "field": str }
        | { "type": "header", "header": str, "field": str, "prefix": str|null }
        | { "type": "basic",  "usernameField": str, "passwordField": str }
        | { "type": "query",  "param": str, "field": str }
        | { "type": "oauth2", "authUrl": str|null, "tokenUrl": str|null, "scopes": [str],
            "grant": "authorization_code|refresh_token|client_credentials" }
        | { "type": "dsn",    "fields": [str] }    // host/port/user/password/database
        | { "type": "cloudIam", "provider": str, "fields": [str] }
        | { "type": "sasl",   "mechanisms": [str] }
        | { "type": "other",  "description": str }
    }
  ],

  // ── how a bounded, resumable slice is produced ─────────────────────────
  "execution": {
    "mode": "poll"|"log",
    // v2.1: scheduling is usually a PER-BINDING property, not a connector one.
    // Put the connector-wide default here (often null) and the real schedules
    // on each stream. A schedule may also be neither an interval nor a cron
    // (e.g. Go duration string, or "daily at HH:MMZ") — use kind "other".
    "defaultSchedule": <Schedule>|null,
    // Replaces v1 `lease`. REQUIRED when mode is "log", optional otherwise.
    // The question this answers: if we stop consuming between cron ticks,
    // WHO PAYS — the customer, or us?
    "continuity": null | {
      "artifacts": [str],                  // every server-side object left behind
                                           // (slot, publication, scratch table, consumer group…)
      "customerSideAccrual": str|null,     // what grows on THEIR infra if we stop (WAL, binlog, change table).
                                           // null when nothing accrues.
      "ourSideLoss": str|null,             // what WE lose if we stop too long (retention window expiry,
                                           // resume-token invalidation). null when nothing is lost.
      "resumeWindow": str|null,            // how long we may pause before resumption breaks
      "releasedOnShutdown": bool|null,     // does the connector drop its artifacts when it stops?
      "notes": str
    }
  },

  // ── credentials/settings the user supplies ─────────────────────────────
  // Nested config is expressed with DOTTED names, e.g. "networkTunnel.sshForwarding.sshEndpoint".
  // v2.1: `scope` separates connection-level settings from per-binding ones —
  // they are configured at different times by different UI and must not be
  // flattened together.
  "configFields": [
    { "name": str, "displayName": str, "required": bool, "secret": bool,
      "scope": "endpoint"|"resource",
      "type": "string|date|number|boolean|array", "description": str|null }
  ],

  // v2.1: Schedule union, referenced as <Schedule> below.
  //   { "kind": "interval",   "seconds": int }
  //   { "kind": "cron",       "expr": str }
  //   { "kind": "continuous" }
  //   { "kind": "other",      "literal": str, "description": str }
  // A binding may legitimately carry MORE THAN ONE at once (e.g. a 5-minute
  // interval for the main sweep plus a nightly cron for a partial refresh);
  // that is why `streams[].schedules` is a list. Give each a `role` saying
  // what it drives.

  // ── streams ────────────────────────────────────────────────────────────
  // "static"     -> fixed list shipped by the connector
  // "discovered" -> comes from the customer's own schema at connect time
  // "mixed"      -> some of each (set `origin` per stream)
  "streamMode": "static"|"discovered"|"mixed",
  "discovery": null | {
    "method": str,                          // e.g. "pg_catalog query", "ListObjectsV2", "REST global describe"
    "querySketch": str|null,                // SHAPE of the query, not verbatim code
    "excludes": [str],
    "allowlist": str|null                   // when discovery is intersected with a shipped list
  },
  "streams": [
    { "name": str,
      "origin": "static"|"discovered",
      // v2.1: for a discovered source there is no literal stream list. Emit
      // representative ARCHETYPES instead — one per distinct capture shape the
      // code can produce — and mark them so a reader never mistakes an
      // archetype for a stream that actually exists.
      "kind": "actual"|"archetype",
      "primaryKey": [str],
      "primaryKeyKind": "columns"|"json_pointers"|"synthetic"|"none",
      "cursorField": str|null,
      "supportedSyncModes": ["full_refresh"] | ["full_refresh","incremental"],
      "writeDisposition": "merge"|"append"|"snapshot_with_tombstone",
      // v2.1: a LIST — a binding may hold an interval and a cron at once.
      "schedules": [ { "role": str, "schedule": <Schedule> } ],

      // A binding may have more than one pull shape. Fill whichever exist and
      // null the rest:
      //   backfill    — the initial historical sweep
      //   incremental — the ongoing changed-rows-only leg
      //   snapshot    — v2.1: a binding that only ever re-reads the whole
      //                 collection (no historical/ongoing split at all).
      //                 Full-refresh and snapshot_with_tombstone streams go
      //                 here, NOT parked in `backfill`.
      "pull": {
        "backfill":    <PullSpec>|null,
        "incremental": <PullSpec>|null,
        "snapshot":    <PullSpec>|null
      }
    }
  ],

  // ── PullSpec ───────────────────────────────────────────────────────────
  // { "kind": "http", "path": str, "httpMethod": "GET"|"POST",
  //   "recordsPath": str|null, "params": {..}|null,
  //   "pathPlaceholders": {..}|null,          // parent-scoped paths, e.g. {list_id}
  //   "paginator": <Paginator>,
  //   "incrementalParam": { "param": str, "format": "iso8601|unix_seconds|date" }|null }
  // { "kind": "table",   "schema": str|null, "table": str|null,
  //   "keyColumns": [str], "cursorColumns": [str], "querySketch": str|null,
  //   "chunking": str|null }                  // how one bounded chunk is bounded
  // { "kind": "objects", "prefix": str|null, "matchExpr": str|null,
  //   "matchExprKind": "glob"|"regex"|null,
  //   "format": "csv|jsonl|json|parquet|avro|auto", "compression": str|null,
  //   "listing": str|null,                    // how the object LISTING itself resumes
  //   "objectChunking": str|null }            // byte-range reads, or null if whole-object
  // { "kind": "changes", "scope": "table"|"database"|"cluster",
  //   "schema": str|null, "table": str|null, "publication": str|null,
  //   "emitsDeletes": bool, "resumeTokenKind": str|null }
  // { "kind": "query",   "language": "soql|sql|other", "querySketch": str }
  // { "kind": "partitioned_log", "unit": str, "offsetKind": str,
  //   "shardable": bool, "notes": str }       // Kafka/Kinesis topic-partition assignment

  // ── Paginator (http only) ──────────────────────────────────────────────
  // Factored into orthogonal axes so near-identical mechanisms stop colliding
  // into one union member:
  //   "type"        : none | offset | page | cursor | record_cursor | next_url | body_cursor
  //   "tokenFrom"   : body | header | url_query | url_path_segment | last_record | n/a
  //   "tokenTo"     : query_param | header | body_field | path_segment | full_url
  //                   (v2.1 — where the token is SENT. It is routinely not
  //                    where it was read from: Salesforce Bulk reads a response
  //                    header and sends a query param.)
  //   "terminateOn" : envelope_flag | short_page | absent_token | explicit_total
  // A paginator may be attached to any PullSpec kind that speaks HTTP,
  // including `query` (v2.1) — not only `kind: "http"`.
  // {"type":"none"}
  // {"type":"offset","limitParam":str,"offsetParam":str,"pageSize":int,"terminateOn":..}
  // {"type":"page","limitParam":str,"pageParam":str,"pageSize":int,"startPage":int,"terminateOn":..}
  // {"type":"cursor","cursorParam":str,"cursorPath":str,"tokenFrom":..,"terminateOn":..,
  //  "pageSizeParam":str|null,"pageSize":int|null}
  // {"type":"record_cursor","param":str,"recordField":str,"hasMorePath":str,...}
  // {"type":"next_url","nextUrlPath":str}      // ONLY when the URL is followed verbatim
  // {"type":"body_cursor","cursorBodyKey":str,"cursorPath":str,"hasMorePath":str|null,...}

  "authTierOverall": "T1_SIMPLE|T2_BYO_APP|T3_BYO_REFRESH",   // the EASIEST credentialMode offered
  "authTierRationale": str,

  "unionMisfits": [ { "where": str, "description": str, "proposedShape": {..} } ],
  "evidence":   { "<dotted.field.path>": { "file": str, "lines": str, "snippet": str } },
  "confidence": { "<dotted.field.path>": "high|medium|low" },
  "abstained":  { "<dotted.field.path>": "<why the source was not conclusive>" }
}
```

## Rules

1. **ABSTAIN RATHER THAN GUESS.** A wrong paginator or cursor fails *silently* in
   production — it returns page one forever and reports a clean sync. A `null`
   costs one unenabled connector; a confident wrong value costs silently
   truncated customer data. Set the field null and record the reason in
   `abstained`.

2. **Cursor semantics are the highest-value and most error-prone field.**
   Distinguish carefully between:
   - following a next-page URL **verbatim** → `next_url`
   - **extracting a token out of** a next-page URL and resending it → `cursor` + `tokenFrom: url_query`
   - reading a token from an envelope field → `cursor` + `tokenFrom: body`
   - reading a token from a response **header** → `cursor` + `tokenFrom: header`
   - echoing back the **id of the last record** → `record_cursor`
   - sending the token in a **JSON request body** → `body_cursor`

   A parameter *named* `offset` that carries an opaque token is a `cursor`, not
   an `offset` — check what the value actually is before classifying.

3. **Evidence for every non-null field.** `evidence` keys are dotted paths
   (`credentialModes[0].scheme`, `streams[3].pull.incremental.paginator`), each
   citing file, line range, and a verbatim snippet of at most 3 lines.

4. **Report misfits rather than forcing a fit.** Misfits are valuable output, not
   failure — v2 of this schema was written from v1's misfit reports.

5. **The shared CDK is in scope.** `estuary-cdk/estuary_cdk/` is where Python
   connectors resolve credentials (`TokenSource`, credential base classes). Read
   it rather than abstaining on auth. Go connectors do not use it.

6. **Auth tiers** measure how much work the USER does:
   - `T1_SIMPLE`: one self-serve API key / token / password / connection string
   - `T2_BYO_APP`: the user must register their own OAuth app (client id + secret)
   - `T3_BYO_REFRESH`: the user must additionally supply a refresh token

   Judge each `credentialMode` separately; `authTierOverall` is the easiest one
   offered. If the connector relies on a hosted control plane registering the
   OAuth app on the user's behalf, say so — the standalone tier is what matters.

7. For `sql`, `objectStore`, and `stream` transports the stream list is almost
   always `discovered`. Put the real value in `discovery`, `configFields`, and the
   `pull` sketches; leave `streams` empty or list only what the code names literally.

8. **`execution.continuity` is where cron-tick safety is decided.** Be concrete and
   symmetric: name every artifact left on the customer's side, say what grows if we
   stop, say what *we* lose if we stop too long, and state whether the connector
   releases its artifacts on shutdown. "Nothing accrues" is a valid and important
   answer — record it as `customerSideAccrual: null` rather than omitting it.
