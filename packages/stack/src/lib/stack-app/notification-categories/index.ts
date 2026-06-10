
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================
export type NotificationCategory = {
  id: string,
  name: string,
  enabled: boolean,
  canDisable: boolean,

  setEnabled(enabled: boolean): Promise<void>,
}
