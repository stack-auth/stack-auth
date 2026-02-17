import { generateDashboardRuntimeCodegen } from "@/lib/ai-dashboard/model";
import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const requestSchema = yupObject({
  projectId: yupString().defined().nonEmpty(),
  prompt: yupString().defined().nonEmpty(),
}).defined();

export async function POST(req: Request) {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const payload = await requestSchema.validate(await req.json());

  const projects = await user.listOwnedProjects();
  const project = projects.find((p: { id: string }) => p.id === payload.projectId);
  if (!project) {
    return Response.json({ error: "You do not own this project" }, { status: 403 });
  }

  const runtimeCodegen = await generateDashboardRuntimeCodegen(payload.prompt);

  return Response.json({
    prompt: payload.prompt,
    projectId: payload.projectId,
    runtimeCodegen,
  });
}
