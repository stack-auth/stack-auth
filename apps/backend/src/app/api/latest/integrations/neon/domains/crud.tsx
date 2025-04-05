import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { CrudTypeOf, createCrud } from "@stackframe/stack-shared/dist/crud";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { yupMixed, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
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


export const domainCrudHandlers = createLazyProxy(() => createCrudHandlers(domainCrud, {
  paramsSchema: yupObject({
    domain: domainSchema.optional(),
  }),
  onCreate: async ({ auth, data, params }) => {
    const oldDomains = auth.project.config.domains;
    await projectsCrudHandlers.adminUpdate({
      data: {
        config: {
          domains: [...oldDomains, { domain: data.domain, handler_path: "/handler" }],
        },
      },
      tenancy: auth.tenancy,
      allowedErrorTypes: [StatusError],
    });

    return { domain: data.domain };
  },
  onDelete: async ({ auth, params }) => {
    const oldDomains = auth.project.config.domains;
    await projectsCrudHandlers.adminUpdate({
      data: {
        config: { domains: oldDomains.filter((domain) => domain.domain !== params.domain) },
      },
      tenancy: auth.tenancy,
      allowedErrorTypes: [StatusError],
    });
  },
  onList: async ({ auth }) => {
    return {
      items: auth.project.config.domains.map((domain) => ({ domain: domain.domain })),
      is_paginated: false,
    };
  },
}));
