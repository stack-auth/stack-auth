import { KnownErrors } from "@hexclave/shared";
import { useStackApp, useUser } from "@hexclave/react";
import { useState } from "react";

import { HostedAuthMessage } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

type InvitationPageError = "invalid" | "expired" | "used" | "unknown";
type InvitationTerminalOutcome =
  | { status: "accepted", teamDisplayName: string }
  | { status: "cancelled" }
  | { status: "ignored" };

function getInvitationPageError(error: unknown): InvitationPageError {
  if (KnownErrors.VerificationCodeNotFound.isInstance(error)) return "invalid";
  if (KnownErrors.VerificationCodeExpired.isInstance(error)) return "expired";
  if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(error)) return "used";
  return "unknown";
}

export function HostedTeamInvitation(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser({ includeRestricted: true });
  const searchParams = getSearchParams();
  const code = searchParams.code;

  const [details, setDetails] = useState<null | { teamDisplayName: string }>(null);
  const [pageError, setPageError] = useState<null | InvitationPageError>(null);
  const [terminalOutcome, setTerminalOutcome] = useState<null | InvitationTerminalOutcome>(null);

  const invalidJsx = (
    <HostedAuthMessage
      title="Invalid Invitation Link"
      fullPage={props.fullPage}
    >
      Please double check if you have the correct team invitation link. You can close this tab.
    </HostedAuthMessage>
  );

  const expiredJsx = (
    <HostedAuthMessage
      title="Expired Invitation Link"
      fullPage={props.fullPage}
    >
      Your team invitation link has expired. Please request a new team invitation link. You can close this tab.
    </HostedAuthMessage>
  );

  const usedJsx = (
    <HostedAuthMessage
      title="Used Invitation Link"
      fullPage={props.fullPage}
    >
      This team invitation link has already been used. You can close this tab.
    </HostedAuthMessage>
  );

  const unknownJsx = (
    <HostedAuthMessage
      title="Something went wrong"
      fullPage={props.fullPage}
    >
      An unexpected error occurred. Please try again later. You can close this tab.
    </HostedAuthMessage>
  );

  if (!code) {
    return invalidJsx;
  }

  if (terminalOutcome?.status === "cancelled") {
    return (
      <HostedAuthMessage title="Invitation cancelled" fullPage={props.fullPage}>
        You did not continue with this team invitation. You can close this tab.
      </HostedAuthMessage>
    );
  }

  if (terminalOutcome?.status === "ignored") {
    return (
      <HostedAuthMessage title="Invitation ignored" fullPage={props.fullPage}>
        You did not join the team. You can close this tab.
      </HostedAuthMessage>
    );
  }

  if (terminalOutcome?.status === "accepted") {
    return (
      <HostedAuthMessage title="Joined Team!" fullPage={props.fullPage}>
        You have successfully joined <span className="font-semibold text-foreground">{terminalOutcome.teamDisplayName}</span>. You can close this tab.
      </HostedAuthMessage>
    );
  }

  if (!user) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in"
        secondaryAction={() => setTerminalOutcome({ status: "cancelled" })}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        Sign in or create an account to join the team.
      </HostedAuthMessage>
    );
  }

  if (user.isRestricted) {
    return (
      <HostedAuthMessage
        title="Complete your account setup"
        primaryAction={() => app.redirectToOnboarding()}
        primaryText="Complete setup"
        secondaryAction={() => setTerminalOutcome({ status: "cancelled" })}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        Please complete your account setup before joining teams.
      </HostedAuthMessage>
    );
  }

  if (pageError === "invalid") return invalidJsx;
  if (pageError === "expired") return expiredJsx;
  if (pageError === "used") return usedJsx;
  if (pageError === "unknown") return unknownJsx;

  if (!details) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={async () => {
          setPageError(null);
          if (code === "demo-code") {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setDetails({ teamDisplayName: "Acme Corp" });
            return;
          }

          const verification = await app.verifyTeamInvitationCode(code);
          if (verification.status === "error") {
            setPageError(getInvitationPageError(verification.error));
            return;
          }

          const invitationDetails = await app.getTeamInvitationDetails(code);
          if (invitationDetails.status === "error") {
            setPageError(getInvitationPageError(invitationDetails.error));
            return;
          }

          setDetails(invitationDetails.data);
        }}
        primaryText="Check invitation"
        secondaryAction={() => setTerminalOutcome({ status: "cancelled" })}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        We will verify your invitation before showing the join action.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthMessage
      title="Team Invitation"
      primaryAction={async () => {
        if (code === "demo-code") {
          await new Promise((resolve) => setTimeout(resolve, 600));
          setTerminalOutcome({ status: "accepted", teamDisplayName: details.teamDisplayName });
          return;
        }

        const result = await app.acceptTeamInvitation(code);
        if (result.status === "ok") {
          setTerminalOutcome({ status: "accepted", teamDisplayName: details.teamDisplayName });
        } else {
          setPageError(getInvitationPageError(result.error));
        }
      }}
      primaryText="Join"
      secondaryAction={() => setTerminalOutcome({ status: "ignored" })}
      secondaryText="Ignore"
      fullPage={props.fullPage}
    >
      You are invited to join <span className="font-semibold text-foreground">{details.teamDisplayName}</span>.
    </HostedAuthMessage>
  );
}
