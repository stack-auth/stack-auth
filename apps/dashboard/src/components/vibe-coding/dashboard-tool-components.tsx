import { CodeBlock } from "@/components/code-block";
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SimpleTooltip,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

let setCurrentCodeRef: ((code: string) => void) | null = null;
let currentCodeRef: string = "";
const listeners: Set<() => void> = new Set();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useCurrentCode() {
  return useSyncExternalStore(subscribe, () => currentCodeRef);
}

function ToolRender({ args, isRunning }: { args: { content: string }, isRunning: boolean }) {
  const currentCode = useCurrentCode();
  const isActive = args.content === currentCode;
  const [isCodeOpen, setIsCodeOpen] = useState(false);

  return (
    <>
      <Card className={`flex items-center gap-2 p-4 justify-between transition-colors ${isActive ? "ring-1 ring-primary/30 bg-primary/[0.03]" : ""}`}>
        <span className="text-sm flex items-center gap-2">
          {isActive && <CheckCircleIcon className="size-4 text-primary" weight="fill" />}
          {isRunning ? "Updating dashboard..." : "Updated dashboard"}
        </span>
        <div className="flex items-center gap-0.5">
          <SimpleTooltip tooltip={isRunning ? "Streaming source..." : "View source"}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setIsCodeOpen(true)}
              aria-label="View generated source"
            >
              <EyeIcon className="size-4" />
            </Button>
          </SimpleTooltip>
          {!isActive && (
            <SimpleTooltip tooltip={isRunning ? "Available when generation finishes" : "Restore this version"}>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={isRunning}
                onClick={() => setCurrentCodeRef?.(args.content)}
                aria-label="Restore this version"
              >
                <ArrowCounterClockwiseIcon className="size-4" />
              </Button>
            </SimpleTooltip>
          )}
        </div>
      </Card>
      <Dialog open={isCodeOpen} onOpenChange={setIsCodeOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Generated source</DialogTitle>
            <DialogDescription>
              {isRunning
                ? "Streaming from the model — updates live as tokens arrive."
                : "The TSX the model returned for this turn."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CodeBlock
              language="tsx"
              content={args.content || "// Waiting for the model to produce code..."}
              title="Dashboard.tsx"
              icon="code"
              maxHeight={480}
              customRender={isRunning ? (
                <pre className="p-4 text-sm font-mono" style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                  {args.content || "// Waiting for the model to produce code..."}
                </pre>
              ) : undefined}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ToolUI = makeAssistantToolUI<
  { content: string },
  "success"
>({
  toolName: "updateDashboard",
  render: (props) => <ToolRender args={props.args} isRunning={props.status.type === "running"} />,
});

/* ────────────────────────────────────────────────────────────────────────────
 * queryAnalytics tool UI — inspection steps the agent takes before/between
 * writes. Visual weight is DELIBERATELY lighter than the updateDashboard card:
 * updateDashboard is a state transition ("the dashboard changed"); an inspection
 * step is a breadcrumb ("the agent looked something up"). If both looked alike
 * the chat would feel noisy and the user couldn't scan at a glance.
 * ────────────────────────────────────────────────────────────────────────── */

type QueryAnalyticsSuccess = {
  success: true,
  rowCount: number,
  totalRows?: number,
  truncated?: boolean,
  truncationNote?: string,
  result: Array<Record<string, unknown>>,
}

type QueryAnalyticsError = {
  success: false,
  error: string,
}

type QueryAnalyticsResult = QueryAnalyticsSuccess | QueryAnalyticsError;

function isQueryAnalyticsResult(v: unknown): v is QueryAnalyticsResult {
  return typeof v === "object" && v !== null && "success" in v && typeof (v as { success: unknown }).success === "boolean";
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return s.trim();
}

/** Renders cell values inside the result preview table. Objects are JSON-encoded
 *  so the agent's `data` JSON column is still inspectable without a custom viewer. */
function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function QueryAnalyticsToolRender({
  args,
  result,
  isRunning,
}: {
  args: { query?: string },
  result: unknown,
  isRunning: boolean,
}) {
  const [open, setOpen] = useState(false);
  const query = (args.query ?? "").trim();
  const parsedResult = isQueryAnalyticsResult(result) ? result : undefined;

  const previewLine = useMemo(() => {
    const line = firstNonEmptyLine(query);
    return line.length > 0 ? line : "(pending)";
  }, [query]);

  const label = isRunning
    ? "Inspecting analytics"
    : parsedResult?.success === false
      ? "Query failed"
      : "Inspected analytics";

  const isError = parsedResult?.success === false;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group w-full flex items-center gap-3 rounded-lg py-2 pl-2.5 pr-2 text-left",
          "bg-foreground/[0.015] hover:bg-foreground/[0.035]",
          "ring-1 ring-foreground/[0.05] hover:ring-foreground/[0.09]",
          "transition-colors",
          isError && "ring-red-500/20 hover:ring-red-500/30 bg-red-500/[0.02]",
        )}
        aria-label="View query details"
      >
        {/* Icon bubble — the single visual indicator that this is a "thinking" step */}
        <div
          className={cn(
            "size-6 shrink-0 rounded-md flex items-center justify-center",
            isError
              ? "bg-red-500/10 text-red-500/80"
              : "bg-foreground/[0.05] text-muted-foreground",
          )}
        >
          {isRunning ? (
            <span
              className="size-1.5 rounded-full bg-current"
              style={{ animation: "pulse 1.2s ease-in-out infinite" }}
            />
          ) : isError ? (
            <WarningIcon className="size-3.5" weight="fill" />
          ) : (
            <MagnifyingGlassIcon className="size-3.5" />
          )}
        </div>

        {/* Label + SQL preview */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 font-medium">
            {label}
          </div>
          <code className="block text-xs font-mono text-foreground/75 truncate">
            {previewLine}
          </code>
        </div>

        {/* Trailing status chip */}
        {!isRunning && parsedResult?.success && (
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground/80 whitespace-nowrap bg-foreground/[0.05] rounded-md px-1.5 py-0.5">
            {parsedResult.rowCount} {parsedResult.rowCount === 1 ? "row" : "rows"}
            {parsedResult.truncated ? " +" : ""}
          </span>
        )}
        {!isRunning && isError && (
          <span className="shrink-0 text-[10px] font-medium text-red-500/90 whitespace-nowrap bg-red-500/[0.1] rounded-md px-1.5 py-0.5">
            error
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Analytics query</DialogTitle>
            <DialogDescription>
              {isRunning
                ? "Running against the project's ClickHouse database…"
                : parsedResult?.success
                  ? parsedResult.truncationNote
                    ?? `${parsedResult.rowCount} ${parsedResult.rowCount === 1 ? "row" : "rows"} returned`
                  : isError
                    ? "The query did not complete successfully."
                    : "Query details"}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CodeBlock
              language="sql"
              content={query || "-- Waiting for the model to emit a query…"}
              title="query.sql"
              icon="code"
              maxHeight={240}
            />

            {parsedResult?.success && parsedResult.result.length > 0 && (
              <div className="mt-4 rounded-lg ring-1 ring-foreground/[0.06] overflow-hidden">
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="bg-foreground/[0.03] sticky top-0">
                      <tr>
                        {Object.keys(parsedResult.result[0]).map((key) => (
                          <th
                            key={key}
                            className="text-left px-3 py-2 font-medium text-muted-foreground/80 border-b border-foreground/[0.05] whitespace-nowrap"
                          >
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedResult.result.map((row, i) => (
                        <tr key={i} className="odd:bg-foreground/[0.012]">
                          {Object.keys(parsedResult.result[0]).map((key) => (
                            <td
                              key={key}
                              className="px-3 py-1.5 text-foreground/80 border-b border-foreground/[0.04] max-w-[260px] truncate"
                              title={formatCell(row[key])}
                            >
                              {formatCell(row[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {parsedResult?.success && parsedResult.result.length === 0 && (
              <div className="mt-4 rounded-lg py-6 text-center text-xs text-muted-foreground/70 bg-foreground/[0.015] ring-1 ring-foreground/[0.04]">
                Query returned no rows.
              </div>
            )}

            {isError && (
              <div className="mt-4 rounded-lg px-3 py-3 text-xs bg-red-500/[0.05] ring-1 ring-red-500/20 text-red-500/90 font-mono whitespace-pre-wrap break-words">
                {parsedResult.error}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

const QueryAnalyticsToolUI = makeAssistantToolUI<
  { query?: string },
  QueryAnalyticsResult
>({
  toolName: "queryAnalytics",
  render: (props) => (
    <QueryAnalyticsToolRender
      args={props.args}
      result={props.result}
      isRunning={props.status.type === "running"}
    />
  ),
});

type DashboardToolUIProps = {
  setCurrentCode: (code: string) => void,
  currentCode: string,
}

export const DashboardToolUI = ({ setCurrentCode, currentCode }: DashboardToolUIProps) => {
  useEffect(() => {
    setCurrentCodeRef = setCurrentCode;
    return () => {
      setCurrentCodeRef = null;
    };
  }, [setCurrentCode]);

  useEffect(() => {
    currentCodeRef = currentCode;
    for (const listener of listeners) {
      listener();
    }
  }, [currentCode]);

  return (
    <>
      <ToolUI />
      <QueryAnalyticsToolUI />
    </>
  );
};
