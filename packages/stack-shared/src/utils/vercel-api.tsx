import { StackAssertionError } from "./errors";
import { Json, parseJson } from "./json";
import { Result } from "./results";
import { createUrlIfValid, isValidUrl } from "./urls";

async function vercelApiRequest(options: { token: string, path: string, method: string, query?: Record<string, string>, body?: Json }): Promise<Result<any>> {
  const url = new URL(options.path, `https://api.vercel.com`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    method: options.method,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let errorMessage = text;
    let errorCode: string | undefined;

    const maybeJson = parseJson(text);
    if (maybeJson.status === "ok") {
      const json: any = maybeJson.data;
      errorMessage = json?.error?.message ?? errorMessage;
      errorCode = json?.error?.code ?? errorCode;
    }

    return Result.error(new StackAssertionError(`Vercel API returned ${res.status} ${res.statusText}: ${errorMessage}`, {
      status: res.status,
      code: errorCode,
      text,
      response: res,
    }));
  }
  const data = await res.json();
  return Result.ok(data);
}

export async function getCurrentUser(options: { token: string }): Promise<Result<{ id: string, email: string, name: string }>> {
  return await vercelApiRequest({
    token: options.token,
    path: '/v2/user',
    method: 'GET',
  });
}

export function parseProjectUrl(projectUrl: string): Result<{ teamSlug: string, projectName: string }> {
  let projectUrlWithProto = projectUrl.includes("://") ? projectUrl : `https://${projectUrl}`;
  const url = createUrlIfValid(projectUrlWithProto);
  if (url === null) {
    return Result.error(new StackAssertionError(`Invalid project URL`));
  }
  if (url.hostname !== "vercel.com") {
    return Result.error(new StackAssertionError(`Project URL must have the hostname "vercel.com"`));
  }
  const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  const parts = path.split("/");
  if (parts.length !== 2) {
    return Result.error(new StackAssertionError(`Project URL must be of the form "vercel.com/<team-slug>/<project-slug>"`));
  }
  const teamSlug = parts[0];
  const projectName = parts[1];
  return Result.ok({ teamSlug, projectName });
}


export async function getProject(options: { token: string, teamSlug: string, idOrName: string }): Promise<Result<{
  id: string,
  name: string,
}>> {
  return await vercelApiRequest({
    token: options.token,
    path: `/v9/projects/${options.idOrName}`,
    query: {
      slug: options.teamSlug,
    },
    method: 'GET',
  });
}

export async function getDeployment(options: { token: string, teamSlug: string } & ({ id: string } | { url: string })): Promise<Result<{
  id: string,
  url: string,
  public: boolean,
  team: {
    id: string,
    slug: string,
  },
}>> {
  let idOrUrl: string;
  if ("id" in options) {
    if (isValidUrl(options.id)) {
      return Result.error(new StackAssertionError(`Invalid deployment ID, should not be a URL: ${options.id}`));
    }
    idOrUrl = options.id;
  } else {
    if (!isValidUrl(options.url)) {
      return Result.error(new StackAssertionError(`Invalid deployment URL: ${options.url}`));
    }
    idOrUrl = options.url;
  }
  return await vercelApiRequest({
    token: options.token,
    path: `/v13/deployments/${idOrUrl}`,
    query: {
      slug: options.teamSlug,
    },
    method: 'GET',
  });
}
