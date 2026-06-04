export type NotificationCategory = {
  id: string,
  name: string,
  enabled: boolean,
  canDisable: boolean,

  setEnabled(enabled: boolean): Promise<void>,
}
