import { StyledLink } from "@/components/link";
import { DashboardAccountSettingsPage } from "@/components/dashboard-account-settings/dashboard-account-settings-page";
import { StackHandler } from "@hexclave/next";

export default async function Handler(props: {
  params: Promise<{ hexclave?: string[]}>,
}) {
  const params = await props.params;
  const hexclave = params.hexclave || [];

  if (hexclave.join("/") === "account-settings") {
    return <DashboardAccountSettingsPage />;
  }

  const extraInfo = <>
    <p className="text-xs">By signing in, you agree to the</p>
    <p className="text-xs"><StyledLink href="https://www.iubenda.com/privacy-policy/19290387/cookie-policy">Terms of Service</StyledLink> and <StyledLink href="https://www.iubenda.com/privacy-policy/19290387">Privacy Policy</StyledLink></p>
    {process.env.NODE_ENV === "development" ?
      <div className="relative">
        <div className="bg-red-500 text-white p-2 rounded-md m-2 animate-bounce [animation-duration:2s]">
          Looks like you&apos;re in development mode! Sign in with GitHub and then admin@example.com to access the admin user with the internal & the dummy project.
        </div>
      </div>
      : null}
  </>;
  return (
    <div data-hexclave-handler-page className="min-h-screen">
      <StackHandler
        fullPage
        componentProps={{
          SignIn: { extraInfo },
          SignUp: { extraInfo },
        }}
      />
    </div>
  );
}
