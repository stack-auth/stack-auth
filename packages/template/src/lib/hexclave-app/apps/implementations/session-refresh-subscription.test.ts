import { describe, expect, it, vi } from "vitest";
import { subscribeSessionRefresh } from "./session-refresh-subscription";

type Listener = () => void;

function createTokenStoreTestDouble() {
  const listeners = new Set<Listener>();
  const unsubscribe = vi.fn((listener: Listener) => {
    listeners.delete(listener);
  });

  return {
    tokenStore: {
      onChange: vi.fn((listener: Listener) => {
        listeners.add(listener);
        return {
          unsubscribe: () => unsubscribe(listener),
        };
      }),
    },
    emitChange: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    unsubscribe,
  };
}

function createSessionTestDouble(sessionKey: string) {
  const refreshUnsubscribe = vi.fn();
  return {
    session: {
      sessionKey,
      startRefreshingAccessToken: vi.fn(() => ({
        unsubscribe: refreshUnsubscribe,
      })),
    },
    refreshUnsubscribe,
  };
}

describe("subscribeSessionRefresh", () => {
  it("starts token refresh while subscribed and stops it on unsubscribe", () => {
    const tokenStore = createTokenStoreTestDouble();
    const firstSession = createSessionTestDouble("refresh-token-1");
    const onTokenStoreChange = vi.fn();

    const unsubscribe = subscribeSessionRefresh({
      tokenStore: tokenStore.tokenStore,
      getSession: () => firstSession.session,
      onTokenStoreChange,
    });

    expect(firstSession.session.startRefreshingAccessToken).toHaveBeenCalledWith(30_000, 60_000);
    expect(tokenStore.tokenStore.onChange).toHaveBeenCalledOnce();

    unsubscribe();

    expect(tokenStore.unsubscribe).toHaveBeenCalledOnce();
    expect(firstSession.refreshUnsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps the existing refresh loop when the token store changes within the same session", () => {
    const tokenStore = createTokenStoreTestDouble();
    const firstSession = createSessionTestDouble("refresh-token-1");
    const onTokenStoreChange = vi.fn();

    subscribeSessionRefresh({
      tokenStore: tokenStore.tokenStore,
      getSession: () => firstSession.session,
      onTokenStoreChange,
    });

    tokenStore.emitChange();

    expect(onTokenStoreChange).toHaveBeenCalledOnce();
    expect(firstSession.session.startRefreshingAccessToken).toHaveBeenCalledOnce();
    expect(firstSession.refreshUnsubscribe).not.toHaveBeenCalled();
  });

  it("moves the refresh loop when the token store changes to a different session", () => {
    const tokenStore = createTokenStoreTestDouble();
    const firstSession = createSessionTestDouble("refresh-token-1");
    const secondSession = createSessionTestDouble("refresh-token-2");
    const sessions = [firstSession.session, secondSession.session];
    const onTokenStoreChange = vi.fn();

    subscribeSessionRefresh({
      tokenStore: tokenStore.tokenStore,
      getSession: () => sessions[0] ?? secondSession.session,
      onTokenStoreChange,
    });

    sessions.shift();
    tokenStore.emitChange();

    expect(onTokenStoreChange).toHaveBeenCalledOnce();
    expect(firstSession.refreshUnsubscribe).toHaveBeenCalledOnce();
    expect(secondSession.session.startRefreshingAccessToken).toHaveBeenCalledWith(30_000, 60_000);
  });
});
