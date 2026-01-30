export type SignUpRuleAction = {
  type: 'allow' | 'reject' | 'restrict' | 'log',
  message?: string,
};

export type SignUpRule = {
  enabled: boolean,
  displayName: string | undefined,
  priority: number,
  condition: string | undefined,
  action: SignUpRuleAction,
};
