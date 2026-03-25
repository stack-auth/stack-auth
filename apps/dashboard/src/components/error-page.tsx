"use client";

import { Logo } from "@/components/logo";
import { useRouter } from "@/components/router";
import { Button, Typography } from "@/components/ui";

export default function ErrorPage(props: {
  title: React.ReactNode,
  description?: React.ReactNode,
  secondaryDescription?: React.ReactNode,
  redirectUrl: string,
  redirectText: string,
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      <main className="max-w-lg flex flex-col gap-4 items-center text-center">
        <Logo width={80} />

        <Typography type='h1'>
          {props.title}
        </Typography>

        <Typography>
          {props.description}
        </Typography>

        <Button onClick={() => router.push(props.redirectUrl)}>
          {props.redirectText}
        </Button>

        {props.secondaryDescription && (
          <Typography variant="secondary">
            {props.secondaryDescription}
          </Typography>
        )}
      </main>
    </div>
  );
}
