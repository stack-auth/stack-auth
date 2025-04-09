import { Confetti } from "@/components/confetti";
import { Card, CardContent, CardFooter, CardHeader, InlineCode, Typography } from "@stackframe/stack-ui";
import Actions from "./actions";
import PostHog from "./posthog";

export const metadata = {
  title: "Setup complete!",
};

export default function WizardCongratsPage() {
  return (
    <>
      <PostHog />
      <Confetti />
      <style>
        {`
          body {
            background-image: linear-gradient(45deg, #ff4444, #dd00dd, #dddd00, #ff4444, #dd00dd, #dddd00);
            background-size: 400% 400%;
            background-repeat: no-repeat;
            animation: celebrate-gradient 60s linear infinite;
          }
          @keyframes celebrate-gradient {
            0% { background-position: 0% 100%; }
            100% { background-position: 100% 0%; }
          }
        `}
      </style>
      <div className="flex items-center justify-center min-h-screen text-center">
        <Card className="max-w-lg">
          <CardHeader>
            <Typography type='h1'>
              Congrats! 🎉
            </Typography>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Typography>
              You successfully installed Stack in your project! 🚀
            </Typography>
            <Typography>
              Next, please sign up on our dashboard to create a new API key, and paste it into your <InlineCode>.env.local</InlineCode> file.
            </Typography>
          </CardContent>
          <CardFooter className="flex justify-center mt-4">
            <Actions />
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
