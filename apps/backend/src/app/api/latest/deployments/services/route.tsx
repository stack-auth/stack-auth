import { HEXCLAVE_SERVICE_ID, assertServiceDefinitionsEditable, createServiceDefinitionInConfig, listServiceDefinitions, serviceToApiShape } from "@/lib/deployments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List deployment services",
    description: "Lists all deployment services defined in the project configuration, merged with their operational state (deploy status, env vars, domains).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const definitions = listServiceDefinitions(auth.tenancy);
    const operationalRows = await prisma.deploymentService.findMany({
      where: { tenancyId: auth.tenancy.id },
      include: { envVars: true, domains: true },
    });
    const operationalByServiceId = new Map(operationalRows.map((row) => [row.serviceId, row]));
    const items = await Promise.all([...definitions.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(async ([serviceId, definition]) => await serviceToApiShape({
        prisma,
        tenancy: auth.tenancy,
        serviceId,
        definition,
        operational: operationalByServiceId.get(serviceId) ?? null,
      })));
    return {
      statusCode: 200,
      bodyType: "json",
      body: { items },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create deployment service",
    description: "Creates a new deployment service definition in the project configuration. Only available when the project's configuration is managed by the dashboard (not pushed from a config file or GitHub).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      id: userSpecifiedIdSchema("serviceId").defined(),
      // null is accepted (and means the same as omitting the field) so the
      // SDK can use one build-options type for both create and update.
      framework: yupString().nullable().optional(),
      install_command: yupString().nullable().optional(),
      build_command: yupString().nullable().optional(),
      output_directory: yupString().nullable().optional(),
      root_directory: yupString().nullable().optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => {
    if (body.id === HEXCLAVE_SERVICE_ID) {
      throw new StatusError(400, `The service id ${JSON.stringify(HEXCLAVE_SERVICE_ID)} is reserved for the managed Hexclave service.`);
    }
    await assertServiceDefinitionsEditable(auth.tenancy);
    if (listServiceDefinitions(auth.tenancy).has(body.id)) {
      throw new StatusError(400, `A deployment service with id ${JSON.stringify(body.id)} already exists.`);
    }
    await createServiceDefinitionInConfig(auth.tenancy, body.id, {
      framework: body.framework ?? undefined,
      installCommand: body.install_command ?? undefined,
      buildCommand: body.build_command ?? undefined,
      outputDirectory: body.output_directory ?? undefined,
      rootDirectory: body.root_directory ?? undefined,
    });
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    // The tenancy's rendered config is a snapshot from before our write, so
    // build the response from the definition we just wrote.
    const created = await serviceToApiShape({
      prisma,
      tenancy: auth.tenancy,
      serviceId: body.id,
      definition: {
        framework: body.framework ?? undefined,
        installCommand: body.install_command ?? undefined,
        buildCommand: body.build_command ?? undefined,
        outputDirectory: body.output_directory ?? undefined,
        rootDirectory: body.root_directory ?? undefined,
        domains: {},
      },
      operational: null,
    });
    return {
      statusCode: 201,
      bodyType: "json",
      body: created,
    };
  },
});
