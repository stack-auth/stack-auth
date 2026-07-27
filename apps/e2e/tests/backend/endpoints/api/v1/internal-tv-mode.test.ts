import { TvSnapshotSchema } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { it } from "../../../../helpers";
import { Project, niceBackendFetch } from "../../../backend-helpers";

it("returns one validated, project-scoped TV snapshot for an admin", async ({ expect }) => {
  const firstProject = await Project.createAndSwitch();
  const firstResponse = await niceBackendFetch(
    "/api/v1/internal/tv-mode/profiles/company-pulse/snapshot",
    { accessType: "admin" },
  );

  expect(firstResponse.status).toBe(200);
  await expect(TvSnapshotSchema.validate(firstResponse.body, { strict: true })).resolves.toMatchObject({
    project: { id: firstProject.projectId },
    profile: { id: "company-pulse" },
    presentation: { banner: null, takeover: null },
  });

  const secondProject = await Project.createAndSwitch();
  const secondResponse = await niceBackendFetch(
    "/api/v1/internal/tv-mode/profiles/company-pulse/snapshot",
    { accessType: "admin" },
  );

  expect(secondResponse.status).toBe(200);
  expect(secondResponse.body.project.id).toBe(secondProject.projectId);
  expect(secondResponse.body.project.id).not.toBe(firstProject.projectId);
});

it("rejects non-admin access and unknown TV profile resources", async ({ expect }) => {
  await Project.createAndSwitch();

  const nonAdminResponse = await niceBackendFetch(
    "/api/v1/internal/tv-mode/profiles/company-pulse/snapshot",
    { accessType: "server" },
  );
  expect(nonAdminResponse.status).toBe(401);

  const unknownProfileResponse = await niceBackendFetch(
    "/api/v1/internal/tv-mode/profiles/unknown%20profile/snapshot",
    { accessType: "admin" },
  );
  expect(unknownProfileResponse.status).toBe(404);
});
