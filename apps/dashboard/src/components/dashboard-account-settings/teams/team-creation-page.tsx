'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp, useUser } from "@hexclave/next";
import { PageLayout } from "../page-layout";
import { Section } from "../section";
import { Warning } from "@phosphor-icons/react";

export function TeamCreationPage(props?: {
  mockMode?: boolean,
}) {
  const teamCreationSchema = yupObject({
    displayName: yupString().defined().nonEmpty("Please enter a team name"),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(teamCreationSchema)
  });
  const app = useStackApp();
  const project = app.useProject();
  const user = useUser({ or: props?.mockMode ? 'return-null' : 'redirect' });
  const navigate = app.useNavigate();
  const [loading, setLoading] = useState(false);

  // In mock mode, show that team creation is disabled
  if (props?.mockMode) {
    return (
      <PageLayout>
        <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex gap-4 items-center">
          <Warning className="h-5 w-5 text-zinc-500 shrink-0" />
          <span className="text-sm text-muted-foreground font-medium">Team creation is disabled in demo mode.</span>
        </div>
      </PageLayout>
    );
  }

  if (!project.config.clientTeamCreationEnabled) {
    return (
      <PageLayout>
        <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex gap-4 items-center">
          <Warning className="h-5 w-5 text-zinc-500 shrink-0" />
          <span className="text-sm text-muted-foreground font-medium">Team creation is not enabled for this project.</span>
        </div>
      </PageLayout>
    );
  }

  const onSubmit = async (data: yup.InferType<typeof teamCreationSchema>) => {
    setLoading(true);

    let team;
    try {
      team = await user?.createTeam({ displayName: data.displayName });
    } finally {
      setLoading(false);
    }

    if (team) {
      navigate(`#team-${team.id}`);
    }
  };

  return (
    <PageLayout>
      <Section title="Create a Team" description="Enter a display name for your new team">
        <form
          onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
          noValidate
          className="flex flex-col gap-2 w-full md:w-[350px]"
        >
          <div className="flex gap-2 w-full">
            <Input
              id="displayName"
              type="text"
              {...register("displayName")}
              placeholder="Team name"
              className="bg-white dark:bg-zinc-900 border-black/[0.08] dark:border-white/[0.08] rounded-xl px-3 py-2 shadow-sm focus-visible:ring-black/[0.06] dark:focus-visible:ring-white/[0.06] flex-1"
            />
            <Button
              type="submit"
              loading={loading}
              className="bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-xl px-4"
            >
              Create
            </Button>
          </div>
          {errors.displayName && (
            <span className="text-red-500 text-xs font-medium">{errors.displayName.message?.toString()}</span>
          )}
        </form>
      </Section>
    </PageLayout>
  );
}
