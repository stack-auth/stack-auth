import { SiteLoadingIndicator } from "@/components/site-loading-indicator";

import type { JSX } from "react";

type Pagination = {
  hasPrevPage?: boolean,
  hasNextPage?: boolean,
  prevPage?: () => void,
  nextPage?: () => void,
}

export function getSvixResult<D>(data: {
  loading: boolean,
  error: any,
  data: D,
} & Pagination): { loaded: true, data: NonNullable<D> } & Pagination | { loaded: false, rendered: JSX.Element } & Pagination {
  if (data.error) {
    throw data.error;
  }

  if (data.loading || !data.data) {
    return {
      loaded: false,
      rendered: <SiteLoadingIndicator />,
    };
  }

  return {
    loaded: true,
    data: data.data,
  };
}
