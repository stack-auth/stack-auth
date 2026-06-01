
The **Sent** tab is your live email log. Every email that flows through the [pipeline](/guides/apps/emails/overview#how-emails-works) - whether triggered by built-in auth flows, a draft, a template, or `sendEmail()` - shows up here with its current status. The right rail shows your **Domain Reputation** so you always know how much sending capacity you have left.

## Email log

The log is a paginated grid sorted by time (newest first). It supports an **infinite scroll** to load more rows.

### View modes

The pill toggle at the top of the card switches between two views:

- **List all** - Flat table of every outbox entry.
- **Group by template/draft** - Collapse rows under their parent template or draft so you can see how a given campaign performed at a glance.

### Columns

| Column | Notes |
|---|---|
| **Recipient** | The recipient's email or `User: <prefix>...` if the email was addressed by user ID. |
| **Subject** | The rendered subject line, or `(Not yet rendered)` if the email hasn't been processed yet. |
| **Time** | `deliveredAt` if available, otherwise the `scheduledAt` time. |
| **Status** | Color-coded badge - see the [status reference](#status-reference) below. |

Click any row to open the **email viewer**, which shows the rendered HTML, recipient details, status timeline, and any rendering / delivery errors.

### Status reference

| Status | Badge | Meaning |
|---|---|---|
| Paused | cyan | The email is paused (e.g. domain reputation issues). |
| Preparing | cyan | Initial outbox record created. |
| Rendering | cyan | Template is being compiled. |
| Render Error | red | Template compilation failed. |
| Scheduled | cyan | Waiting for `scheduledAt`. |
| Queued | cyan | Ready to send, waiting for capacity. |
| Sending | cyan | Handed off to the SMTP provider. |
| Server Error | red | Provider rejected the request. |
| Skipped | cyan | Recipient unsubscribed or didn't qualify. |
| Bounced | red | Recipient's mail server rejected the message. |
| Delivery Delayed | cyan | Provider is retrying delivery. |
| Sent | green | Delivered successfully. |
| Opened | blue | Recipient opened the email. |
| Clicked | purple | Recipient clicked a tracked link. |
| Marked as Spam | orange | Recipient flagged the email as spam. |

## Domain Reputation

The right-hand card surfaces three signals that determine how much - and how fast - you can send.

### Email Capacity

Shows hourly sends versus your current cap (`emails sent / max per hour`). Hexclave automatically buffers email as your domain warms up, so this number scales over time.

If you need a temporary lift (e.g. you're launching a campaign), click **Temporarily increase capacity** to activate a **boost**. While a boost is active, the bar animates and a countdown timer shows when it expires. Boosts can also be triggered programmatically:

```typescript
await stackServerApp.activateEmailCapacityBoost();
```

### Bounce Rate

Percentage of emails that couldn't be delivered, against a healthy ceiling (`5%`). High bounce rates hurt your sender reputation and deliverability.

### Spam Complaint

Percentage of recipients who marked your emails as spam, against the standard threshold (`0.1%`). Keep this low to stay deliverable.

## Programmatic access

Pull the same metrics that power Domain Reputation from your server:

```typescript
const info = await stackServerApp.getEmailDeliveryStats();

info.stats.hour.sent;
info.stats.day.bounced;
info.stats.week.marked_as_spam;
info.stats.month.sent;

info.capacity.rate_per_second;
info.capacity.is_boost_active;
info.capacity.boost_multiplier;
info.capacity.boost_expires_at;
```

Stats are bucketed by `hour`, `day`, `week`, and `month`, with counts for `sent`, `bounced`, `marked_as_spam`, and more.

## Local emulator

When you're running the local emulator, mock emails are captured by Inbucket instead of being delivered. Open the **Mock Emails → Open Inbox** card at the top of the Emails app to inspect them.

## Related

- [Drafts](/guides/dashboard-references/emails/drafts) - compose and send one-off emails.
- [Templates](/guides/dashboard-references/emails/templates) - author the templates that show up in the log.
- [Email Settings](/guides/dashboard-references/emails/email-settings) - configure the sender that emails are sent from.
