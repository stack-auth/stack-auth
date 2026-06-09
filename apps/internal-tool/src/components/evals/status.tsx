// Shared status badge/chip styling for eval runs and step runs.
// Run statuses: queued | booting | running | completed | failed | cancelled
// Step statuses: pending | running | completed | failed | cancelled

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "booting": {
      return "bg-amber-100 text-amber-800";
    }
    case "running": {
      return "bg-blue-100 text-blue-800 animate-pulse";
    }
    case "completed": {
      return "bg-green-100 text-green-800";
    }
    case "failed": {
      return "bg-red-100 text-red-800";
    }
    // queued, pending, cancelled and anything unknown render gray.
    default: {
      return "bg-gray-100 text-gray-600";
    }
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(status)}`}>
      {status}
    </span>
  );
}
