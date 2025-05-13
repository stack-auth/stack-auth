export type AdminSentEmail = {
  id: string,
  to: string[],
  subject: string,
  recipient: string, // We'll derive this from to[0] for display
  sentAt: Date, // We'll derive this from sent_at_millis for display
  error?: unknown,
}
