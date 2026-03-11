'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import React from "react";
import { useStackApp } from "./hooks";
import type { TurnstileFlowOptions } from "./stack-app/apps/interfaces/client-app";
import { useStagedTurnstile } from "./turnstile";

export type UseTurnstileAuthOptions = {
  action: TurnstileAction,
  missingVisibleChallengeMessage: string,
  challengeRequiredMessage: string,
};

export type TurnstileAuthRunResult<T> =
  | {
    status: "completed",
    result: T,
  }
  | {
    status: "blocked",
  };

type TurnstileChallengeResult = {
  status: "error",
  error: InstanceType<typeof KnownErrors.TurnstileChallengeRequired>,
};

function isTurnstileChallengeResult(value: object | null): value is TurnstileChallengeResult {
  return value != null
    && Reflect.get(value, "status") === "error"
    && KnownErrors.TurnstileChallengeRequired.isInstance(Reflect.get(value, "error"));
}

export function useTurnstileAuth(options: UseTurnstileAuthOptions) {
  const app = useStackApp();
  const stagedTurnstile = useStagedTurnstile(app, options);
  const isWaitingForVisibleChallenge = stagedTurnstile.challengeRequiredResult != null;
  const canSubmit = !isWaitingForVisibleChallenge || stagedTurnstile.visibleTurnstileToken != null;

  return {
    challengeError: stagedTurnstile.challengeError,
    clearChallengeError: stagedTurnstile.clearChallengeError,
    visibleTurnstileWidget: stagedTurnstile.visibleTurnstileWidget,
    invisibleTurnstileWidget: stagedTurnstile.invisibleTurnstileWidget,
    isWaitingForVisibleChallenge,
    canSubmit,
    turnstileWidget: (
      <>
        {stagedTurnstile.visibleTurnstileWidget}
        {stagedTurnstile.invisibleTurnstileWidget}
      </>
    ),
    async run<T>(callback: (turnstileFlowOptions: TurnstileFlowOptions) => Promise<T>): Promise<TurnstileAuthRunResult<T>> {
      const turnstileFlowOptions = await stagedTurnstile.getTurnstileFlowOptions();
      if (turnstileFlowOptions == null) {
        return { status: "blocked" };
      }

      try {
        const result = await callback(turnstileFlowOptions);
        if (typeof result === "object" && isTurnstileChallengeResult(result)) {
          stagedTurnstile.handleChallengeRequired(result.error);
          return { status: "blocked" };
        }
        return {
          status: "completed",
          result,
        };
      } catch (error) {
        if (KnownErrors.TurnstileChallengeRequired.isInstance(error)) {
          stagedTurnstile.handleChallengeRequired(error);
          return { status: "blocked" };
        }
        throw error;
      }
    },
  };
}
