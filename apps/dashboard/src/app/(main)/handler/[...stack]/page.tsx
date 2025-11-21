import { StyledLink } from "@/components/link";
import { stackServerApp } from "@/stack";
import { StackHandler } from "@stackframe/stack";

export default function Handler(props: unknown) {
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
  return <StackHandler
    fullPage
    routeProps={props}
    app={stackServerApp}
    componentProps={{ SignIn: { extraInfo }, SignUp: { extraInfo } }}
  />;
}
