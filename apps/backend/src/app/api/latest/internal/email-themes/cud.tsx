import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { renderEmailWithTemplate } from "@/lib/email-rendering";
import { createCudHandlers } from "@/route-handlers/cud-handler";
import { Tenancy } from "@/lib/tenancies";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { LightEmailTheme } from "@stackframe/stack-shared/dist/helpers/emails";
import { CrudTypeOf } from "@stackframe/stack-shared/dist/crud";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { createCrud } from "@stackframe/stack-shared/dist/crud";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

type ThemeItem = {
  id: string,
  display_name: string,
  tsx_source: string,
};

function listThemes(tenancy: Tenancy): ThemeItem[] {
  return typedEntries(tenancy.config.emails.themes).map(([id, theme]) => ({
    id,
    display_name: theme.displayName,
    tsx_source: theme.tsxSource,
  }));
}

function getThemeOrThrow(tenancy: Tenancy, id: string) {
  const themeList = tenancy.config.emails.themes;
  if (!Object.prototype.hasOwnProperty.call(themeList, id)) {
    throw new StatusError(404, "No theme found with given id");
  }
  return themeList[id]!;
}

const internalEmailThemesCrud = createCrud({
  adminReadSchema: yupObject({
    id: yupString().uuid().defined(),
    display_name: yupString().defined(),
    tsx_source: yupString().defined(),
  }).defined(),
  adminCreateSchema: yupObject({
    id: yupString().uuid().optional(),
    display_name: yupString().defined(),
  }).defined(),
  adminUpdateSchema: yupObject({
    id: yupString().uuid().optional(),
    tsx_source: yupString().defined(),
  }).defined(),
  adminDeleteSchema: yupObject({
    id: yupString().uuid().defined(),
  }).defined(),
  docs: {
    adminRead: { hidden: true },
    adminList: { hidden: true },
    adminCreate: { hidden: true },
    adminUpdate: { hidden: true },
    adminDelete: { hidden: true },
  },
});

type InternalEmailThemesCrudType = CrudTypeOf<typeof internalEmailThemesCrud>;
type CreateTheme = InternalEmailThemesCrudType["Admin"]["Create"];
type UpdateTheme = InternalEmailThemesCrudType["Admin"]["Update"];
type ThemeRead = InternalEmailThemesCrudType["Admin"]["Read"];

export const internalEmailThemesCudHandlers = createCudHandlers(internalEmailThemesCrud, {
  paramsSchema: yupObject({
    id: yupString().uuid().defined(),
  }).defined(),
  onCreate: async ({ auth, data }) => {
    const id = data.id ?? generateUuid();

    await overrideEnvironmentConfigOverride({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      environmentConfigOverrideOverride: {
        [`emails.themes.${id}`]: {
          displayName: data.display_name,
          tsxSource: LightEmailTheme,
        },
      },
    });

    return id;
  },
  onUpdate: async ({ auth, params, data }) => {
    const paramsId = params.id;

    if (data.length === 0) {
      if (paramsId) {
        const theme = getThemeOrThrow(auth.tenancy, paramsId);
        return {
          items: [{
            id: paramsId,
            display_name: theme.displayName,
            tsx_source: theme.tsxSource,
          }],
          is_paginated: false,
        };
      }

      const items = listThemes(auth.tenancy);
      return {
        items,
        is_paginated: false,
      };
    }

    const first = data[0];
    if ("display_name" in first) {
      const created = first as (Omit<CreateTheme, "id"> & { id: string });
      return {
        items: [{
          id: created.id,
          display_name: created.display_name,
          tsx_source: LightEmailTheme,
        }],
        is_paginated: false,
      };
    }

    const updateBatch = data as UpdateTheme[];
    const resolvedUpdates = updateBatch.map((d) => ({
      id: paramsId ?? d.id,
      tsx_source: d.tsx_source,
    })) satisfies Array<{ id: string | undefined, tsx_source: string }>;

    if (resolvedUpdates.some((u) => !u.id)) {
      throw new StatusError(400, "Theme id is required");
    }
    if (paramsId && resolvedUpdates.length !== 1) {
      throw new StatusError(400, "Cannot batch-update a single theme id");
    }

    for (const update of resolvedUpdates) {
      getThemeOrThrow(auth.tenancy, update.id!);
      const result = await renderEmailWithTemplate(
        previewTemplateSource,
        update.tsx_source,
        { previewMode: true },
      );
      if (result.status === "error") {
        throw new KnownErrors.EmailRenderingError(result.error);
      }
    }

    await overrideEnvironmentConfigOverride({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      environmentConfigOverrideOverride: Object.fromEntries(resolvedUpdates.map((u) => ([
        `emails.themes.${u.id}.tsxSource`,
        u.tsx_source,
      ]))),
    });

    const updatedThemes = {
      ...auth.tenancy.config.emails.themes,
      ...Object.fromEntries(resolvedUpdates.map((u) => {
        const current = getThemeOrThrow(auth.tenancy, u.id!);
        return [u.id!, { ...current, tsxSource: u.tsx_source }];
      })),
    };

    const items: ThemeRead[] = typedEntries(updatedThemes).map(([id, theme]) => ({
      id,
      display_name: theme.displayName,
      tsx_source: theme.tsxSource,
    }));

    return {
      items: paramsId ? items.filter((t) => t.id === paramsId) : items,
      is_paginated: false,
    };
  },
  onDelete: async ({ auth, params, data }) => {
    const ids = new Set([params.id, ...data.map((d) => d.id)].filter(Boolean));

    const themes = { ...auth.tenancy.config.emails.themes };
    for (const id of ids) {
      getThemeOrThrow(auth.tenancy, id);
      delete themes[id];
    }

    await overrideEnvironmentConfigOverride({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      environmentConfigOverrideOverride: {
        "emails.themes": themes,
      },
    });

    return {
      items: typedEntries(themes).map(([id, theme]) => ({
        id,
        display_name: theme.displayName,
        tsx_source: theme.tsxSource,
      })),
      is_paginated: false,
    };
  },
});
