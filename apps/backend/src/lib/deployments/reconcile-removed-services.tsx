import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { HexclaveAssertionError, captureError } from "@hexclave/shared/dist/utils/errors";
import { VercelApiError, getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull } from "./vercel-client";

/**
 * Removes operational rows (and their Vercel projects) whose service
 * definition disappeared through a whole-config write, such as a GitHub or
 * CLI config push. Interactive dashboard deletion performs the same cleanup
 * in its DELETE route; without this reconciliation, config-as-code deletion
 * would hide the service while leaking its live Vercel project indefinitely.
 *
 * External deletion is best-effort after the config write has committed. A
 * failed Vercel call leaves the operational row in place so the next service
 * list or config write retries it instead of forgetting the leaked target.
 */
export async function reconcileRemovedDeploymentServices(tenancyId: string): Promise<{ deleted: number, pending: number }> {
  const tenancy = await getTenancy(tenancyId);
  if (tenancy == null) {
    throw new HexclaveAssertionError("Cannot reconcile deployment services for a tenancy that no longer exists", { tenancyId });
  }
  const prisma = await getPrismaClientForTenancy(tenancy);
  const definedServiceIds = Object.keys(tenancy.config.deployments.services);
  const orphaned = await prisma.deploymentService.findMany({
    where: {
      tenancyId,
      ...(definedServiceIds.length > 0 ? { serviceId: { notIn: definedServiceIds } } : {}),
    },
  });
  if (orphaned.length === 0) {
    return { deleted: 0, pending: 0 };
  }

  const client = getVercelDeploymentsConfigOrNull() == null ? null : getVercelDeploymentsClientOrThrow();
  let deleted = 0;
  let pending = 0;
  for (const service of orphaned) {
    if (service.vercelProjectId != null) {
      if (client == null) {
        pending++;
        captureError(
          "deployments-orphan-cleanup-unconfigured",
          new HexclaveAssertionError("A removed deployment service still has a Vercel project, but Vercel deployments are not configured; leaving the operational row for a later cleanup retry.", {
            tenancyId,
            deploymentServiceId: service.id,
          }),
        );
        continue;
      }
      try {
        await client.deleteProject(service.vercelProjectId);
      } catch (error) {
        // A previous cleanup may have deleted the remote project and died
        // before deleting the row. Vercel's 404 confirms cleanup is complete.
        if (!(error instanceof VercelApiError && error.status === 404)) {
          pending++;
          captureError("deployments-orphan-cleanup", error);
          continue;
        }
      }
    }
    const result = await prisma.deploymentService.deleteMany({
      where: {
        tenancyId,
        id: service.id,
        // A concurrent deploy that re-provisioned this row must win.
        vercelProjectId: service.vercelProjectId,
      },
    });
    deleted += result.count;
  }
  return { deleted, pending };
}
