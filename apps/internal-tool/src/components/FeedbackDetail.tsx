import { format } from "date-fns";
import type { FeedbackLogRow, McpCallLogRow } from "../types";
import { toDate } from "../utils";
import { Badge, Button } from "./design";

function Field({ label, value }: { label: string, value: string | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words font-mono text-foreground">{value}</span>
    </div>
  );
}

export function FeedbackDetail({
  row,
  relatedCall,
  onClose,
  onOpenRelatedCall,
}: {
  row: FeedbackLogRow,
  relatedCall: McpCallLogRow | null,
  onClose: () => void,
  onOpenRelatedCall: (call: McpCallLogRow) => void,
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <Badge>{row.category}</Badge>
          <div className="text-[10px] tabular-nums text-muted-foreground">
            {format(toDate(row.createdAt), "yyyy-MM-dd HH:mm:ss")}
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="whitespace-pre-wrap break-words rounded-xl border border-black/[0.06] bg-foreground/[0.04] p-3 text-xs text-foreground dark:border-white/[0.06]">
        {row.message}
      </div>

      {row.conversationId != null && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Related conversation</div>
          {relatedCall != null ? (
            <button
              onClick={() => onOpenRelatedCall(relatedCall)}
              className="w-full rounded-lg border border-black/[0.08] px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:transition-none hover:bg-foreground/[0.05] dark:border-white/[0.08]"
            >
              <span className="font-mono text-[10px] text-muted-foreground">{relatedCall.toolName}</span>
              <span className="block truncate">{relatedCall.question}</span>
            </button>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              {row.conversationId} (not in the live call log window)
            </div>
          )}
        </div>
      )}

      <div className="space-y-1 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
        <Field label="correlationId" value={row.correlationId} />
        <Field label="conversationId" value={row.conversationId} />
        <Field label="transport" value={row.transport} />
        <Field label="requestIp" value={row.requestIp} />
        <Field label="requestIpSource" value={row.requestIpSource} />
        <Field label="requestHost" value={row.requestHost} />
        <Field label="mcpProtocolVersion" value={row.mcpProtocolVersion} />
        <Field label="userAgent" value={row.userAgent} />
      </div>
    </div>
  );
}
