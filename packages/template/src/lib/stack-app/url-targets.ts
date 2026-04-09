import { getCustomPagePrompts, type CustomPagePrompt } from "@stackframe/stack-shared/dist/interface/handler-urls";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { envVars } from "../env";
import { DefaultHandlerUrlTarget, HandlerPageUrls, HandlerUrlOptions, HandlerUrlTarget, HandlerUrls, ResolvedHandlerUrls } from "./common";

const defaultHostedHandlerDomainSuffix = ".built-with-stack-auth.com";
const hostedHandlerProjectIdPlaceholder = "{projectId}";
const hostedHandlerPathPlaceholder = "{hostedPath}";
const localUrlPlaceholderOrigin = "http://example.com";
const schemePrefixRegex = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const customPagePrompts: Record<keyof Omit<HandlerPageUrls, "handler">, CustomPagePrompt> = getCustomPagePrompts();

const replaceStackPortPrefix = <T extends string | undefined>(input: T): T => {
  if (!input) return input;
  const prefix = envVars.NEXT_PUBLIC_STACK_PORT_PREFIX;
  return prefix ? input.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, prefix) as T : input;
};

const joinHandlerComponentPath = (basePath: string, pagePath: string): string => {
  const normalizedBasePath = basePath.endsWith("/") && basePath.length > 1
    ? basePath.slice(0, -1)
    : basePath;
  if (pagePath.length === 0) {
    return normalizedBasePath;
  }
  if (normalizedBasePath === "/") {
    return `/${pagePath}`;
  }
  return `${normalizedBasePath}/${pagePath}`;
};

const getHostedPagePathForHandlerName = (handlerName: keyof HandlerUrls): string => {
  switch (handlerName) {
    case "handler": {
      return "";
    }
    case "home": {
      return "";
    }
    case "afterSignIn": {
      return "";
    }
    case "afterSignUp": {
      return "";
    }
    case "afterSignOut": {
      return "";
    }
    case "signIn": {
      return "sign-in";
    }
    case "signUp": {
      return "sign-up";
    }
    case "signOut": {
      return "sign-out";
    }
    case "emailVerification": {
      return "email-verification";
    }
    case "passwordReset": {
      return "password-reset";
    }
    case "forgotPassword": {
      return "forgot-password";
    }
    case "oauthCallback": {
      return "oauth-callback";
    }
    case "magicLinkCallback": {
      return "magic-link-callback";
    }
    case "accountSettings": {
      return "account-settings";
    }
    case "teamInvitation": {
      return "team-invitation";
    }
    case "mfa": {
      return "mfa";
    }
    case "error": {
      return "error";
    }
    case "onboarding": {
      return "onboarding";
    }
  }
};

export const getHostedHandlerDomainSuffix = (): string => {
  const configuredValue = envVars.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX
    ?? defaultHostedHandlerDomainSuffix;
  const domainSuffix = replaceStackPortPrefix(configuredValue);
  if (!domainSuffix.startsWith(".")) {
    throw new StackAssertionError("The hosted handler domain suffix must start with a dot.", {
      domainSuffix,
      hint: "Set NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX to a value like '.built-with-stack-auth.com'.",
    });
  }
  return domainSuffix;
};

const getHostedHandlerUrlTemplate = (): string => {
  const configuredTemplate = replaceStackPortPrefix(envVars.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE);
  if (configuredTemplate != null) {
    if (!configuredTemplate.includes(hostedHandlerProjectIdPlaceholder) || !configuredTemplate.includes(hostedHandlerPathPlaceholder)) {
      throw new StackAssertionError("The hosted handler URL template must contain {projectId} and {hostedPath}.", {
        hostedHandlerUrlTemplate: configuredTemplate,
        hint: "Set NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE to a value like 'https://{projectId}.built-with-stack-auth.com/{hostedPath}'.",
      });
    }
    return configuredTemplate;
  }
  return `https://${hostedHandlerProjectIdPlaceholder}${getHostedHandlerDomainSuffix()}/${hostedHandlerPathPlaceholder}`;
};

const resolveCustomTargetUrl = (options: {
  target: { type: "custom", url: string, version: number },
  handlerName: keyof HandlerUrls,
}): string => {
  const handlerName = options.handlerName;
  if (handlerName in customPagePrompts) {
    const customPagePrompt = customPagePrompts[handlerName as keyof typeof customPagePrompts];
    if (options.target.version === 0 || options.target.version in customPagePrompt.versions) {
      return options.target.url;
    }

    throw new Error(`Unsupported custom page version ${options.target.version} for ${options.handlerName} page at ${options.target.url}. The latest supported version of this page is ${Math.max(0, ...Object.keys(customPagePrompt.versions).map(Number))}. Please upgrade your Stack Auth SDK to a version that supports this version.`);
  } else {
    throw new Error(`URL target ${options.handlerName} cannot be a custom page. Please specify the URL as a string instead.`);
  }
};

export const getHostedHandlerUrl = (options: { projectId: string, pagePath: string }): string => {
  const normalizedPagePath = options.pagePath.replace(/^\/+/, "");
  const hostedPath = normalizedPagePath.length > 0 ? `handler/${normalizedPagePath}` : "handler";
  const template = getHostedHandlerUrlTemplate();
  const templateFilled = template
    .replaceAll(hostedHandlerProjectIdPlaceholder, options.projectId)
    .replaceAll(hostedHandlerPathPlaceholder, hostedPath);
  return new URL(templateFilled).toString();
};

const isRelativeUrlString = (url: string): boolean => {
  if (url.startsWith("//")) {
    return false;
  }
  return !schemePrefixRegex.test(url);
};

export const isLocalHandlerUrlTarget = (options: {
  targetUrl: string,
  handlerPath: string,
  currentOrigin?: string,
}): boolean => {
  const urlObject = new URL(options.targetUrl, localUrlPlaceholderOrigin);
  const isHandlerPathTarget = urlObject.pathname === options.handlerPath
    || urlObject.pathname.startsWith(`${options.handlerPath}/`);
  if (!isHandlerPathTarget) {
    return false;
  }

  // On server we only have path information, so treat matching handler paths as local.
  if (options.currentOrigin == null) {
    return true;
  }

  return isRelativeUrlString(options.targetUrl) || urlObject.origin === options.currentOrigin;
};

const resolveUrlTarget = (options: {
  target: HandlerUrlTarget,
  fallbackPath: string,
  handlerName: keyof HandlerUrls,
  projectId: string,
}): string => {
  if (typeof options.target === "string") {
    return options.target;
  }

  switch (options.target.type) {
    case "handler-component": {
      return options.fallbackPath;
    }
    case "hosted": {
      return getHostedHandlerUrl({
        projectId: options.projectId,
        pagePath: getHostedPagePathForHandlerName(options.handlerName),
      });
    }
    case "custom": {
      return resolveCustomTargetUrl({
        target: options.target,
        handlerName: options.handlerName,
      });
    }
  }
};

export const resolveHandlerUrls = (options: { urls: HandlerUrlOptions | undefined, projectId: string }): ResolvedHandlerUrls => {
  const configuredUrls = options.urls;
  const defaultTarget: HandlerUrlTarget = configuredUrls?.default ?? { type: "handler-component" };
  let handlerComponentBasePath = "/handler";
  if (typeof configuredUrls?.handler === "string") {
    handlerComponentBasePath = configuredUrls.handler;
  } else if (configuredUrls?.handler != null && configuredUrls.handler.type === "custom") {
    handlerComponentBasePath = resolveCustomTargetUrl({
      target: configuredUrls.handler,
      handlerName: "handler",
    });
  }

  const home = resolveUrlTarget({
    target: configuredUrls?.home ?? defaultTarget,
    fallbackPath: "/",
    handlerName: "home",
    projectId: options.projectId,
  });
  const afterSignIn = resolveUrlTarget({
    target: configuredUrls?.afterSignIn ?? defaultTarget,
    fallbackPath: home,
    handlerName: "afterSignIn",
    projectId: options.projectId,
  });

  return {
    handler: resolveUrlTarget({
      target: configuredUrls?.handler ?? defaultTarget,
      fallbackPath: handlerComponentBasePath,
      handlerName: "handler",
      projectId: options.projectId,
    }),
    signIn: resolveUrlTarget({
      target: configuredUrls?.signIn ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-in"),
      handlerName: "signIn",
      projectId: options.projectId,
    }),
    signUp: resolveUrlTarget({
      target: configuredUrls?.signUp ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-up"),
      handlerName: "signUp",
      projectId: options.projectId,
    }),
    afterSignIn,
    afterSignUp: resolveUrlTarget({
      target: configuredUrls?.afterSignUp ?? defaultTarget,
      fallbackPath: afterSignIn,
      handlerName: "afterSignUp",
      projectId: options.projectId,
    }),
    signOut: resolveUrlTarget({
      target: configuredUrls?.signOut ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-out"),
      handlerName: "signOut",
      projectId: options.projectId,
    }),
    afterSignOut: resolveUrlTarget({
      target: configuredUrls?.afterSignOut ?? defaultTarget,
      fallbackPath: home,
      handlerName: "afterSignOut",
      projectId: options.projectId,
    }),
    emailVerification: resolveUrlTarget({
      target: configuredUrls?.emailVerification ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "email-verification"),
      handlerName: "emailVerification",
      projectId: options.projectId,
    }),
    passwordReset: resolveUrlTarget({
      target: configuredUrls?.passwordReset ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "password-reset"),
      handlerName: "passwordReset",
      projectId: options.projectId,
    }),
    forgotPassword: resolveUrlTarget({
      target: configuredUrls?.forgotPassword ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "forgot-password"),
      handlerName: "forgotPassword",
      projectId: options.projectId,
    }),
    home,
    oauthCallback: resolveUrlTarget({
      target: configuredUrls?.oauthCallback ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "oauth-callback"),
      handlerName: "oauthCallback",
      projectId: options.projectId,
    }),
    magicLinkCallback: resolveUrlTarget({
      target: configuredUrls?.magicLinkCallback ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "magic-link-callback"),
      handlerName: "magicLinkCallback",
      projectId: options.projectId,
    }),
    accountSettings: resolveUrlTarget({
      target: configuredUrls?.accountSettings ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "account-settings"),
      handlerName: "accountSettings",
      projectId: options.projectId,
    }),
    teamInvitation: resolveUrlTarget({
      target: configuredUrls?.teamInvitation ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "team-invitation"),
      handlerName: "teamInvitation",
      projectId: options.projectId,
    }),
    mfa: resolveUrlTarget({
      target: configuredUrls?.mfa ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "mfa"),
      handlerName: "mfa",
      projectId: options.projectId,
    }),
    error: resolveUrlTarget({
      target: configuredUrls?.error ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "error"),
      handlerName: "error",
      projectId: options.projectId,
    }),
    onboarding: resolveUrlTarget({
      target: configuredUrls?.onboarding ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "onboarding"),
      handlerName: "onboarding",
      projectId: options.projectId,
    }),
  };
};

export const resolveUnknownHandlerPathFallbackUrl = (options: {
  defaultTarget: DefaultHandlerUrlTarget | undefined,
  projectId: string,
  unknownPath: string,
}): string | null => {
  const defaultTarget = options.defaultTarget ?? { type: "handler-component" } satisfies HandlerUrlTarget;
  if (typeof defaultTarget === "string") {
    return defaultTarget;
  }

  switch (defaultTarget.type) {
    case "handler-component": {
      return null;
    }
    case "hosted": {
      return getHostedHandlerUrl({
        projectId: options.projectId,
        pagePath: options.unknownPath,
      });
    }
  }
};

export function getPagePrompt(pageName: string, currentVersion?: number): { title: string; fullPrompt: string; upgradePrompt: string | null; latestVersion: number } | null {
  if (!(pageName in customPagePrompts)) return null;
  const prompt = customPagePrompts[pageName as keyof typeof customPagePrompts];
  const versionKeys = Object.keys(prompt.versions).map(Number);
  const latestVersion = versionKeys.length > 0 ? Math.max(...versionKeys) : 0;

  let upgradePrompt: string | null = null;
  if (currentVersion != null) {
    const relevantVersions = versionKeys
      .filter(v => v > currentVersion)
      .sort((a, b) => a - b);
    const prompts = relevantVersions
      .map(v => prompt.versions[v].upgradePrompt)
      .filter(p => p.length > 0);
    upgradePrompt = prompts.length > 0 ? prompts.join("\n\n") : null;
  } else {
    const upgradeEntry = latestVersion > 0 ? prompt.versions[latestVersion] : undefined;
    upgradePrompt = upgradeEntry?.upgradePrompt ?? null;
  }

  return { title: prompt.title, fullPrompt: prompt.fullPrompt, upgradePrompt, latestVersion };
}

export const isHostedHandlerUrlForProject = (options: { url: string, projectId: string }): boolean => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.url);
  } catch {
    return false;
  }

  const hostedBaseUrl = new URL(getHostedHandlerUrl({ projectId: options.projectId, pagePath: "" }));
  return parsedUrl.origin === hostedBaseUrl.origin
    && (parsedUrl.pathname === hostedBaseUrl.pathname || parsedUrl.pathname.startsWith(`${hostedBaseUrl.pathname}/`));
};
