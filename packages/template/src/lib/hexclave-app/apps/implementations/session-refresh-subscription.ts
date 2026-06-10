type TokenStoreSubscription = {
  unsubscribe: () => void,
};

type TokenStoreLike = {
  onChange: (callback: () => void) => TokenStoreSubscription,
};

type SessionRefreshLike = {
  sessionKey: string,
  startRefreshingAccessToken: (minMillisUntilExpiration: number, maxMillisSinceIssued: number | null) => TokenStoreSubscription,
};

/**
 * Keeps the currently mounted React session fresh while `useSyncExternalStore`
 * has an active subscriber. The token store owns which session is current; when
 * it changes to a different session key, we stop refreshing the old session and
 * start refreshing the new one. The caller still receives every token-store
 * change through `onTokenStoreChange` so React can re-read the session snapshot.
 */
export function subscribeSessionRefresh(options: {
  tokenStore: TokenStoreLike,
  getSession: () => SessionRefreshLike,
  onTokenStoreChange: () => void,
  minMillisUntilExpiration?: number,
  maxMillisSinceIssued?: number | null,
}): () => void {
  const minMillisUntilExpiration = options.minMillisUntilExpiration ?? 30_000;
  const maxMillisSinceIssued = options.maxMillisSinceIssued ?? 60_000;

  let refreshedSession = options.getSession();
  let refreshSubscription = refreshedSession.startRefreshingAccessToken(minMillisUntilExpiration, maxMillisSinceIssued);

  const tokenStoreSubscription = options.tokenStore.onChange(() => {
    const nextSession = options.getSession();
    if (nextSession.sessionKey !== refreshedSession.sessionKey) {
      refreshSubscription.unsubscribe();
      refreshedSession = nextSession;
      refreshSubscription = refreshedSession.startRefreshingAccessToken(minMillisUntilExpiration, maxMillisSinceIssued);
    }
    options.onTokenStoreChange();
  });

  return () => {
    tokenStoreSubscription.unsubscribe();
    refreshSubscription.unsubscribe();
  };
}
