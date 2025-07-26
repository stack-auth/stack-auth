import { OrganizationRenderedConfig } from "../config/schema";
import { ProjectsCrud } from "../interface/crud/projects";
import { StackAssertionError, captureError } from "../utils/errors";
import { isLocalhost } from "../utils/urls";

export type ProductionModeError = {
  message: string,
  relativeFixUrl: `/${string}`,
};

export function getProductionModeErrors(
  project: ProjectsCrud["Admin"]["Read"],
  config: OrganizationRenderedConfig
): ProductionModeError[] {
  const errors: ProductionModeError[] = [];
  const domainsFixUrl = `/projects/${project.id}/domains` as const;

  if (config.domains.allowLocalhost) {
    errors.push({
      message: "Localhost is not allowed in production mode, turn off 'Allow localhost' in project settings",
      relativeFixUrl: domainsFixUrl,
    });
  }

  for (const { baseUrl } of Object.values(config.domains.trustedDomains)) {
    if (!baseUrl) {
      continue;
    }

    let url;
    try {
      url = new URL(baseUrl);
    } catch (e) {
      captureError("production-mode-domain-not-valid", new StackAssertionError("Domain was somehow not a valid URL; we should've caught this when setting the domain in the first place", {
        domain: baseUrl,
        projectId: project
      }));
      errors.push({
        message: "Trusted domain is not a valid URL: " + baseUrl,
        relativeFixUrl: domainsFixUrl,
      });
      continue;
    }

    if (isLocalhost(url)) {
      errors.push({
        message: "Localhost domains are not allowed to be trusted in production mode: " + baseUrl,
        relativeFixUrl: domainsFixUrl,
      });
    } else if (url.hostname.match(/^\d+(\.\d+)*$/)) {
      errors.push({
        message: "Direct IPs are not valid for trusted domains in production mode: " + baseUrl,
        relativeFixUrl: domainsFixUrl,
      });
    } else if (url.protocol !== "https:") {
      errors.push({
        message: "Trusted domains should be HTTPS: " + baseUrl,
        relativeFixUrl: domainsFixUrl,
      });
    }
  }

  return errors;
}
