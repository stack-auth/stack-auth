import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { HostedAuthLoading, HostedAuthMessage } from "../auth/supporting/layout";

type AccountDeletionState = "active" | "deleting" | "deleted";
type DeleteAccountOperation = () => Promise<void>;
export type DeleteAccountCallback = (deleteAccount: DeleteAccountOperation) => Promise<void>;

export function AccountDeletionBoundary(props: {
  children: (onDeleteAccount: DeleteAccountCallback) => ReactNode,
}) {
  const [deletionState, setDeletionState] = useState<AccountDeletionState>("active");

  const handleDeleteAccount: DeleteAccountCallback = async (deleteAccount) => {
    // The authenticated tree contains hooks that react to session invalidation. Commit its unmount
    // before delete() clears the session so it cannot redirect away from this terminal state.
    flushSync(() => setDeletionState("deleting"));
    try {
      await deleteAccount();
      setDeletionState("deleted");
    } catch (error) {
      flushSync(() => setDeletionState("active"));
      throw error;
    }
  };

  if (deletionState === "deleting") {
    return <HostedAuthLoading fullPage />;
  }

  if (deletionState === "deleted") {
    return (
      <HostedAuthMessage title="Account deleted" fullPage>
        Your account and its associated data have been deleted. You can close this tab.
      </HostedAuthMessage>
    );
  }

  return props.children(handleDeleteAccount);
}
