import { cacheFunction } from "@hexclave/shared/dist/utils/caches";

export function cacheTeamInvitationOperation<TApp extends object, TResult>(
  operation: (app: TApp, code: string) => Promise<TResult>,
): (app: TApp, session: object, code: string) => Promise<TResult> {
  return cacheFunction(async (app: TApp, _session: object, code: string) => {
    return await operation(app, code);
  });
}
