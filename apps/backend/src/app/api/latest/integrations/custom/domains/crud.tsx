import { Tenancy } from "@/lib/tenancies";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { CrudTypeOf, createCrud } from "@stackframe/stack-shared/dist/crud";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { yupMixed, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { projectsCrudHandlers } from "../../../internal/projects/current/crud";

const domainSchema = schemaFields.urlSchema.defined()
  .matches(/^https?:\/\//, 'URL must start with http:// or https://')
  .meta({ openapiField: { description: 'URL. Must start with http:// or https://', exampleValue: 'https://example.com' } });

const domainReadSchema = yupObject({
  domain: domainSchema,
});

const domainCreateSchema = yupObject({
  domain: domainSchema,
});

export const domainDeleteSchema = yupMixed();

export const domainCrud = createCrud({
  adminReadSchema: domainReadSchema,
  adminCreateSchema: domainCreateSchema,
  adminDeleteSchema: domainDeleteSchema,
  docs: {
    adminList: {
      hidden: true,
    },
    adminRead: {
      hidden: true,
    },
    adminCreate: {
      hidden: true,
    },
    adminUpdate: {
      hidden: true,
    },
    adminDelete: {
      hidden: true,
    },
  },
});
export type DomainCrud = CrudTypeOf<typeof domainCrud>;

function domainConfigToLegacyConfig(domain: Tenancy['config']['domains']['trustedDomains'][string]) {
  return { domain: domain.baseUrl || throwErr('Domain base URL is required'), handler_path: domain.handlerPath };
}


export const domainCrudHandlers = createLazyProxy(() => createCrudHandlers(domainCrud, {
  paramsSchema: yupObject({
    domain: domainSchema.optional(),
  }),
  onCreate: async ({ auth, data, params }) => {
    const oldDomains = auth.tenancy.config.domains.trustedDomains;
    await projectsCrudHandlers.adminUpdate({
      data: {
        config: {
          domains: [...Object.values(oldDomains).map(domainConfigToLegacyConfig), { domain: data.domain, handler_path: "/handler" }],
        },
      },
      tenancy: auth.tenancy,
      allowedErrorTypes: [StatusError],
    });

    return { domain: data.domain };
  },
  onDelete: async ({ auth, params }) => {
    const oldDomains = auth.tenancy.config.domains.trustedDomains;
    await projectsCrudHandlers.adminUpdate({
      data: {
        config: { domains: Object.values(oldDomains).filter((domain) => domain.baseUrl !== params.domain).map(domainConfigToLegacyConfig) },
      },
      tenancy: auth.tenancy,
      allowedErrorTypes: [StatusError],
    });
  },
  onList: async ({ auth }) => {
    return {
      items: Object.values(auth.tenancy.config.domains.trustedDomains)
        .map(domainConfigToLegacyConfig)
        .sort((a, b) => stringCompare(a.domain, b.domain)),
      is_paginated: false,
    };
  },
}));
