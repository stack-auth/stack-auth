import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { clsx } from "clsx";



export function LoadOlderButton({
  hasMore,
  isLoading,
  onLoadOlder,
  hasRows,
  className,
}: {
  hasMore: boolean,
  isLoading: boolean,
  onLoadOlder: () => Promise<void>,
  /** Suppresses the end-of-history note while the list is simply empty. */
  hasRows: boolean,
  className?: string,
}) {
  if (!hasMore) {
    if (!hasRows) return null;
    return <span className={clsx("text-gray-400", className)}>end of history</span>;
  }

  return (
    <button
      onClick={() => runAsynchronouslyWithAlert(onLoadOlder())}
      disabled={isLoading}
      title="Fetch older rows from the server. The live view only streams the newest window."
      className={clsx(
        "px-2 py-0.5 text-xs rounded bg-white border border-gray-200 text-gray-600 transition-colors hover:transition-none hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-white",
        className,
      )}
    >
      {isLoading ? "Loading…" : "Load older"}
    </button>
  );
}

/** Props every list that supports history paging takes, kept in one place. */
export type HistoryPagingProps = {
  hasMoreHistory: boolean,
  isLoadingOlder: boolean,
  onLoadOlder: () => Promise<void>,
};
