import { KnownErrors } from "@hexclave/shared";
import { useStackApp, useUser } from "@hexclave/react";
import { useState } from "react";

import { HostedAuthLoading, HostedAuthMessage } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

export function HostedTeamInvitation(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser({ includeRestricted: true });
  const searchParams = getSearchParams();
  const code = searchParams.code;

  const [accepted, setAccepted] = useState(false);
  const [details, setDetails] = useState<null | { teamDisplayName: string }>(null);
  const [pageError, setPageError] = useState<null | "invalid" | "expired" | "used" | "unknown">(null);
  const [verifying, setVerifying] = useState(false);
  const [joining, setJoining] = useState(false);

  const invalidJsx = (
    <HostedAuthMessage
      title="Invalid Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Please double check if you have the correct team invitation link.
    </HostedAuthMessage>
  );

  const expiredJsx = (
    <HostedAuthMessage
      title="Expired Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Your team invitation link has expired. Please request a new team invitation link.
    </HostedAuthMessage>
  );

  const usedJsx = (
    <HostedAuthMessage
      title="Used Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      This team invitation link has already been used.
    </HostedAuthMessage>
  );

  const unknownJsx = (
    <HostedAuthMessage
      title="Something went wrong"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      An unexpected error occurred. Please try again later.
    </HostedAuthMessage>
  );

  if (!code) {
    return invalidJsx;
  }

  if (!user) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in"
        secondaryAction={() => app.redirectToHome()}
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
        secondaryAction={() => app.redirectToHome()}
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

  if (verifying) {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  if (!details) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={async () => {
          setVerifying(true);
          setPageError(null);
          try {
            if (code === "demo-code") {
              await new Promise((resolve) => setTimeout(resolve, 600));
              setDetails({ teamDisplayName: "Acme Corp" });
              return;
            }

            const verification = await app.verifyTeamInvitationCode(code);
            if (verification.status === "error") {
              if (KnownErrors.VerificationCodeNotFound.isInstance(verification.error)) {
                setPageError("invalid");
                return;
              }
              if (KnownErrors.VerificationCodeExpired.isInstance(verification.error)) {
                setPageError("expired");
                return;
              }
              if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(verification.error)) {
                setPageError("used");
                return;
              }
              throw verification.error;
            }

            const invitationDetails = await app.getTeamInvitationDetails(code);
            if (invitationDetails.status === "error") {
              setPageError("unknown");
              return;
            }

            setDetails(invitationDetails.data);
          } catch (e) {
            setPageError("unknown");
          } finally {
            setVerifying(false);
          }
        }}
        primaryText="Check invitation"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        We will verify your invitation before showing the join action.
      </HostedAuthMessage>
    );
  }

  if (accepted) {
    return (
      <HostedAuthMessage
        title="Joined Team!"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        You have successfully joined <span className="font-semibold text-foreground">{details.teamDisplayName}</span>.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthMessage
      title="Team Invitation"
      primaryAction={async () => {
        setJoining(true);
        try {
          if (code === "demo-code") {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setAccepted(true);
            return;
          }

          const result = await app.acceptTeamInvitation(code);
          if (result.status === "ok") {
            setAccepted(true);
          } else {
            setPageError("unknown");
          }
        } catch (e) {
          setPageError("unknown");
        } finally {
          setJoining(false);
        }
      }}
      primaryText={joining ? "Joining..." : "Join"}
      secondaryAction={() => app.redirectToHome()}
      secondaryText="Ignore"
      fullPage={props.fullPage}
    >
      You are invited to join <span className="font-semibold text-foreground">{details.teamDisplayName}</span>.
    </HostedAuthMessage>
  );
}
