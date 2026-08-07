"use client";

import { Button, Card, Input, Typography } from "@/components/ui";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { useMemo, useState } from "react";
import type { ConnectorDto } from "./api";
import { CATEGORY_LABELS, ConnectorMark } from "./shared";

/**
 * The connector catalogue: a searchable, categorized grid.
 *
 * Deliberately conventional — this is the one screen users arrive at with
 * expectations already set by Airbyte and Fivetran, and meeting them costs
 * nothing.
 */
export function Catalogue(props: {
  connectors: ConnectorDto[],
  onSelect: (connector: ConnectorDto) => void,
  onCancel: () => void,
}) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = props.connectors.filter(connector =>
      needle === ""
      || connector.display_name.toLowerCase().includes(needle)
      || connector.description.toLowerCase().includes(needle)
      || connector.category.toLowerCase().includes(needle));

    const byCategory = new Map<string, ConnectorDto[]>();
    for (const connector of matching) {
      const list = byCategory.get(connector.category) ?? [];
      list.push(connector);
      byCategory.set(connector.category, list);
    }
    return [...byCategory.entries()].sort((a, b) =>
      stringCompare(CATEGORY_LABELS[a[0]] ?? a[0], CATEGORY_LABELS[b[0]] ?? b[0]));
  }, [props.connectors, search]);

  const matchCount = grouped.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search connectors…"
          value={search}
          onChange={event => setSearch(event.target.value)}
          className="sm:max-w-sm"
          aria-label="Search connectors"
        />
        <Button variant="secondary" onClick={props.onCancel}>Cancel</Button>
      </div>

      {matchCount === 0 && (
        <Card className="p-6 text-center">
          <Typography variant="secondary">
            No connectors match “{search}”. To import from any other API, use the Custom REST API
            connector.
          </Typography>
        </Card>
      )}

      {grouped.map(([category, connectors]) => (
        <div key={category} className="flex flex-col gap-2">
          <Typography type="h4" className="text-sm font-semibold text-muted-foreground">
            {CATEGORY_LABELS[category] ?? category}
          </Typography>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connectors.map(connector => (
              <button
                key={connector.id}
                type="button"
                onClick={() => props.onSelect(connector)}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition hover:border-foreground/30 hover:shadow-sm"
              >
                <ConnectorMark name={connector.display_name} size="md" />
                <div className="min-w-0 flex-1">
                  <Typography className="truncate font-medium">{connector.display_name}</Typography>
                  <Typography variant="secondary" className="line-clamp-2 text-xs">
                    {connector.description}
                  </Typography>
                  <Typography variant="secondary" className="mt-1 text-xs">
                    {connector.stream_count} {connector.stream_count === 1 ? "stream" : "streams"}
                  </Typography>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
