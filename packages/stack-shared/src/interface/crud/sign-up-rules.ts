export type SignUpRuleMetadataEntry = {
  value: string | number | boolean,
  target: 'client' | 'client_read_only' | 'server',
};

export type SignUpRuleAction = {
  type: 'allow' | 'reject' | 'restrict' | 'log' | 'add_metadata',
  metadata?: Record<string, SignUpRuleMetadataEntry>,
  message?: string,
};

export type SignUpRule = {
  enabled: boolean,
  displayName: string | undefined,
  priority: number,
  condition: string | undefined,
  action: SignUpRuleAction,
};
