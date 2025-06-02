import { stackServerApp } from "@/stack";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { redirect } from "next/navigation";
import ConfirmCard from "./oauth-confirm-card";

export default async function IntegrationConfirmPage(props: {
  searchParams: Promise<{ interaction_uid: string }>,
  type: "neon" | "custom",
}) {
  const interactionUid = (await props.searchParams).interaction_uid;
  if (!interactionUid) {
    return <>
      <div>Error: No interaction UID provided.</div>
    </>;
  }

  const onContinue = async (options: { projectId: string, projectName?: string }) => {
    "use server";

    const user = await stackServerApp.getUser();
    if (!user) {
      return { error: "unauthorized" };
    }
    const ownedProjects = await user.listOwnedProjects();
    if (!ownedProjects.find((p) => p.id === options.projectId)) {
      return { error: "unauthorized" };
    }

    const response = await fetch(new URL(`/api/v1/integrations/${props.type}/internal/confirm`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL")), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stack-Project-Id": "internal",
        "X-Stack-Access-Type": "server",
        "X-Stack-Secret-Server-Key": getEnvVariable("STACK_SECRET_SERVER_KEY"),
      },
      body: JSON.stringify({
        project_id: options.projectId,
        interaction_uid: (await props.searchParams).interaction_uid,
        external_project_name: options.projectName,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new StackAssertionError(`Failed to confirm integration: ${response.status} ${text}`, { response, text });
    }
    const json = await response.json();
    const authorizationCode = json.authorization_code;

    const redirectUrl = new URL(`/api/v1/integrations/${props.type}/oauth/idp/interaction/${encodeURIComponent((await props.searchParams).interaction_uid)}/done`, getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
    redirectUrl.searchParams.set("code", authorizationCode);
    redirect(redirectUrl.toString());
  };

  return (
    <>
      <ConfirmCard onContinue={onContinue} type={props.type} />
    </>
  );
}
