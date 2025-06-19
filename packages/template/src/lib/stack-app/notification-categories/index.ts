export type NotificationCategory = {
  id: string,
  name: string,
  enabled: boolean,

  setEnabled(enabled: boolean): Promise<void>,
}
