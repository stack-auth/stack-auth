import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, Badge, Button, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useUser } from "../../../lib/hooks";
import { ActiveSession } from "../../../lib/stack-app/users";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";

export function ActiveSessionsPage() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  const [isLoading, setIsLoading] = useState(true);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [showConfirmRevokeAll, setShowConfirmRevokeAll] = useState(false);

  // Fetch sessions when component mounts
  useEffect(() => {
    runAsynchronously(async () => {
      setIsLoading(true);
      const sessionsData = await user.getActiveSessions();
      const enhancedSessions = sessionsData;
      setSessions(enhancedSessions);
      setIsLoading(false);
    });
  }, [user]);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await user.revokeSession(sessionId);

      // Remove the session from the list
      setSessions(prev => prev.filter(session => session.id !== sessionId));
    } catch (error) {
      captureError("Failed to revoke session", { sessionId ,error });
      throw error;
    }
  };

  const handleRevokeAllSessions = async () => {
    setIsRevokingAll(true);
    try {
      const deletionPromises = sessions
        .filter(session => !session.isCurrentSession)
        .map(session => user.revokeSession(session.id));
      await Promise.all(deletionPromises);
      setSessions(prevSessions => prevSessions.filter(session => session.isCurrentSession));
    } catch (error) {
      captureError("Failed to revoke all sessions", { error, sessionIds: sessions.map(session => session.id) });
      throw error;
    } finally {
      setIsRevokingAll(false);
      setShowConfirmRevokeAll(false);
    }
  };

  return (
    <PageLayout>
      <div>
        <div className="flex justify-between items-center mb-2">
          <Typography className='font-medium'>{t("Active Sessions")}</Typography>
          {sessions.filter(s => !s.isCurrentSession).length > 0 && !isLoading && (
            showConfirmRevokeAll ? (
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  loading={isRevokingAll}
                  onClick={handleRevokeAllSessions}
                >
                  {t("Confirm")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isRevokingAll}
                  onClick={() => setShowConfirmRevokeAll(false)}
                >
                  {t("Cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmRevokeAll(true)}
              >
                {t("Revoke All Other Sessions")}
              </Button>
            )
          )}
        </div>
        <Typography variant='secondary' type='footnote' className="mb-4">
          {t("These are devices where you're currently logged in. You can revoke access to end a session.")}
        </Typography>

        {isLoading ? (
          <Skeleton className="h-[300px] w-full rounded-md" />
        ) : (
          <div className='border rounded-md'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">{t("Session")}</TableHead>
                  <TableHead className="w-[150px]">{t("IP Address")}</TableHead>
                  <TableHead className="w-[150px]">{t("Location")}</TableHead>
                  <TableHead className="w-[150px]">{t("Last used")}</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6">
                      <Typography variant="secondary">{t("No active sessions found")}</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          {/* We currently do not save any usefull information about the user, in the future, the name should probably say what kind of session it is (e.g. cli, browser, maybe what auth method was used) */}
                          <Typography>{session.isCurrentSession ? t("Current Session") : t("Other Session")}</Typography>
                          {session.isImpersonation && <Badge variant="secondary" className="w-fit mt-1">{t("Impersonation")}</Badge>}
                          <Typography variant='secondary' type='footnote'>
                            {t("Signed in {time}", { time: new Date(session.createdAt).toLocaleDateString() })}
                          </Typography>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Typography>{session.geoInfo?.ip || t('-')}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography>{session.geoInfo?.cityName || t('Unknown')}</Typography>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <Typography>{session.lastUsedAt ? fromNow(new Date(session.lastUsedAt)) : t("Never")}</Typography>
                          <Typography variant='secondary' type='footnote' title={session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : ""}>
                            {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleDateString() : ""}
                          </Typography>
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <ActionCell
                          items={[
                            {
                              item: t("Revoke"),
                              onClick: () => handleRevokeSession(session.id),
                              danger: true,
                              disabled: session.isCurrentSession,
                              disabledTooltip: session.isCurrentSession ? t("You cannot revoke your current session") : undefined,
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
