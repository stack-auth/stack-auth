
The **Queries** page is a ClickHouse SQL workspace for deeper analysis and reusable reporting. It lives at **Analytics → Queries** in the dashboard sidebar.

Use it when you need to write your own SQL, share named queries with your team, or build a library of repeatable reports.

## Editor

The right pane is a freeform SQL editor:

- **Run** button — execute the current SQL (also bound to `Cmd+Enter` / `Ctrl+Enter`)
- **Save** — overwrite the currently selected saved query (preserves name and description)
- **Save As…** — save the current SQL as a new query into a folder
- **New Query** (sidebar) — clear the editor and selection to start a fresh query

Queries run with a **30-second timeout** budget. Results stream back as a virtualized table; click any row for the same **Row Details** dialog as the [Tables](/guides/dashboard-references/analytics/tables) page.

Any read-only ClickHouse SQL is accepted. You can query the same 12 tables documented on the [Tables page](/guides/dashboard-references/analytics/tables#tables-sidebar), all under the `default` schema (e.g. `default.events`, `default.users`).

### Example

```sql
SELECT * FROM default.events
ORDER BY event_at DESC
LIMIT 100
```

## Saved queries

The left sidebar contains folders of saved queries. Each saved query stores:

- **Display name**
- **SQL**
- **Description** (optional)

Click a saved query to load it into the editor and run it immediately. The selected query is highlighted in blue.

### Folder management

- **New folder** (`+` button next to **Folders**) — create a new folder by name
- **Delete folder** (trash icon, shown on hover) — delete a folder and all queries inside it (confirmation required)
- Folders are ordered by `sortOrder`, assigned automatically on creation

### Query management

- **Save As…** opens a dialog with:
  - **Name** (required)
  - **Folder** — pick an existing folder, or choose **Create new…** to open the folder creation dialog inline
  - **Description** (optional)
- **Save** updates the SQL of the currently loaded query in-place. Use this after editing a previously saved query.
- **Delete query** (trash icon on hover) — delete a single saved query (confirmation required)

Saved queries are stored in your project's **environment config** under `analytics.queryFolders.<folderId>.queries.<queryId>` and persist across dashboard sessions.

### Loading a query

Clicking a saved query:

1. Loads its SQL into the editor
2. Runs the query immediately
3. Marks it as the current selection so the **Save** button overwrites this query in place

To stop editing a saved query and start fresh, click **New Query** in the sidebar.

## Result states

The right pane handles five distinct states:

| State           | When it shows                                | Notes                                                 |
| --------------- | -------------------------------------------- | ----------------------------------------------------- |
| **Empty**       | No query has been run yet                    | Shows an example query                                |
| **Loading**     | Query is in flight                           | Spinner with "Running query..."                       |
| **Error**       | ClickHouse returned an error                 | Shows the error message and a **Retry** button        |
| **No results**  | Query ran successfully but returned 0 rows   | Shows "Query executed successfully but returned no rows." |
| **Results**     | Query returned ≥1 row                        | Virtualized table with row count and click-to-inspect rows |

## Keyboard shortcuts

| Shortcut                  | Action               |
| ------------------------- | -------------------- |
| `Cmd+Enter` / `Ctrl+Enter` | Run the current SQL  |

## Limits

The analytics events usage banner appears at the top of the Queries page when your project is at ≥80% of its monthly event quota — see [Usage and Quotas](/guides/apps/analytics/overview#usage-and-quotas).
