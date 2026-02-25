import { DesignBadgeColor } from "@/components/design-components/badge";
import { AdminEmailOutboxStatus } from "@stackframe/stack";
import { StatsBarData } from "./stats-bar";

export const STATUS_LABELS: Record<AdminEmailOutboxStatus, string> = {
  "paused": "Paused",
  "preparing": "Preparing",
  "rendering": "Rendering",
  "render-error": "Render Error",
  "scheduled": "Scheduled",
  "queued": "Queued",
  "sending": "Sending",
  "server-error": "Server Error",
  "skipped": "Skipped",
  "bounced": "Bounced",
  "delivery-delayed": "Delivery Delayed",
  "sent": "Sent",
  "opened": "Opened",
  "clicked": "Clicked",
  "marked-as-spam": "Marked as Spam",
};

export function getStatusBadgeColor(status: AdminEmailOutboxStatus): DesignBadgeColor {
  switch (status) {
    case "sent": {
      return "green";
    }
    case "opened": {
      return "blue";
    }
    case "clicked": {
      return "purple";
    }
    case "bounced":
    case "server-error":
    case "render-error": {
      return "red";
    }
    case "marked-as-spam": {
      return "orange";
    }
    default: {
      return "cyan";
    }
  }
}

export function computeEmailStats(emails: { status: AdminEmailOutboxStatus }[]): StatsBarData {
  let sent = 0, bounced = 0, spam = 0, errors = 0, inProgress = 0;
  for (const email of emails) {
    switch (email.status) {
      case "sent":
      case "opened":
      case "clicked":
      case "delivery-delayed":
      case "skipped": {
        sent++;
        break;
      }
      case "bounced": {
        bounced++;
        break;
      }
      case "marked-as-spam": {
        spam++;
        break;
      }
      case "server-error":
      case "render-error": {
        errors++;
        break;
      }
      default: {
        inProgress++;
        break;
      }
    }
  }
  return { sent, bounced, spam, errors, inProgress };
}
