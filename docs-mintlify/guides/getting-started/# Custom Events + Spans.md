# Custom Events + Spans

## Table schemas

### Events

(current)
- id: UUID
- event_type: String
- event_at: DateTime
- data: JSONB
- project_id: UUID
- branch_id: UUID
- user_id: UUID
- team_id: UUID
- refresh_token_id: UUID
- session_replay_id: UUID
- session_replay_segment_id: UUID
- created_at: DateTime (ingested at)

(proposed)
- parent_span_ids: UUID[]
- session_replay_tab_id: UUID


### Spans

(proposed)
- id: UUID
- span_type: String
- span_started_at: DateTime
- span_ended_at: DateTime (optional)
- parent_span_ids: String[]
- data: JSONB (optional)
- created_at: DateTime (ingested at)
- updated_at: DateTime (ingested at) (default = created_at)
- project_id: UUID
- branch_id: UUID
- user_id: UUID
- team_id: UUID
- refresh_token_id: UUID
- session_replay_id: UUID
- session_replay_segment_id: UUID
- session_replay_tab_id: UUID


## Types

### Span types

(proposed)
- $session-replay
- $session-replay-segment
- $session-replay-tab
- $refresh-token

**Note**: We will add more span types as we need them. Easier to add new ones than to remove old ones.

### Event types

(current)
- $page-view — client SDK (analytics auto-capture)
- $click — client SDK (analytics auto-capture)
- $token-refresh — server (logged on token refresh)
- $sign-up-rule-trigger — server (logged when a sign-up rule fires)

## Id Conversions

(proposed)
- session_replay_id = sri-<id>
- session_replay_segment_id = srsi-<id>
- session_replay_tab_id = srta-<id>
- user_id = ui-<id>
- team_id = ti-<id>
- refresh_token_id = rti-<id>
- project_id = pi-<id>
- branch_id = bi-<id>


## Name Conversions

(current)
- internal event_type / span_type = $<name>
