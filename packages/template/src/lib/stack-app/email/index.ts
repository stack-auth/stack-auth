export type AdminSentEmail = {
  id: string,
  to: string[],
  subject: string,
  recipient: string, // We'll derive this from to[0] for display
  sentAt: Date, // We'll derive this from sent_at_millis for display
  error?: unknown,
}

export type SendEmailOptions =
  & {
    userIds: string[],
    themeId?: string | null | false,
    subject?: string,
    notificationCategoryName?: string,
  }
  & ({
    html: string,
  } | {
    templateId: string,
    variables?: Record<string, any>,
  })
