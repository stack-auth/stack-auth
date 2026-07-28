import { getBranchConfigPushedError, getDevelopmentEnvironmentConfigWarnings, renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { createOrUpdateProjectWithLegacyConfig } from "@/lib/projects";
import { getHexclaveStripe } from "@/lib/stripe";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { projectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { yupObject } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";
import Stripe from "stripe";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    if (
      data.config?.email_theme &&
      !Object.keys(auth.tenancy.config.emails.themes).includes(data.config.email_theme)
    ) {
      throw new StatusError(400, "Invalid email theme");
    }
    const project = await createOrUpdateProjectWithLegacyConfig({
      type: "update",
      projectId: auth.project.id,
      branchId: auth.branchId,
      data: data,
    });
    const tenancy = await getTenancy(auth.tenancy.id) ?? throwErr("Tenancy not found after project update?"); // since we updated the project, we need to re-fetch the new tenancy config
    return {
      ...project,
      pushed_config_error: await getBranchConfigPushedError({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
      }),
      config_warnings: await getDevelopmentEnvironmentConfigWarnings({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        organizationId: auth.tenancy.organization?.id ?? null,
      }),
      config: renderedOrganizationConfigToProjectCrud(tenancy.config),
    };
  },
  onRead: async ({ auth }) => {
    return {
      ...auth.project,
      pushed_config_error: await getBranchConfigPushedError({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
      }),
      config_warnings: await getDevelopmentEnvironmentConfigWarnings({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        organizationId: auth.tenancy.organization?.id ?? null,
      }),
      config: renderedOrganizationConfigToProjectCrud(auth.tenancy.config),
    };
  },
  onDelete: async ({ auth }) => {
    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { stripeAccountId: true },
    });
    if (project?.stripeAccountId) {
      // The connected accounts we create are fully platform-controlled (no Stripe dashboard), so we're
      // allowed to delete them; otherwise they'd linger in the Stripe platform account forever.
      // Stripe refuses deletion while the account still holds a balance or has pending payouts. We don't
      // want that to block the project deletion (the user can't do anything about it), so we only report
      // the orphaned account instead of failing the request.
      try {
        await getHexclaveStripe().accounts.del(project.stripeAccountId);
      } catch (error) {
        if (!(error instanceof Stripe.errors.StripeError)) {
          throw error;
        }
        captureError("delete-project-stripe-account", new HexclaveAssertionError(
          "Failed to delete the Stripe connected account of a deleted project; it is now orphaned and needs to be cleaned up manually",
          { projectId: auth.project.id, stripeAccountId: project.stripeAccountId, cause: error },
        ));
      }
    }
    await globalPrismaClient.project.delete({
      where: {
        id: auth.project.id
      }
    });
  }
}));
