export type AnalyticsQueryOptions = {
  query: string,
  params?: Record<string, unknown>,
  timeout_ms?: number,
  include_all_branches?: boolean,
};

export type AnalyticsQueryResponse = {
  result: Record<string, unknown>[],
  query_id: string,
};
