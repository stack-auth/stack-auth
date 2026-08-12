import { getDataWarehouseConnectionInfo, provisionDataWarehouse } from "@/lib/data-warehouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Provision data warehouse",
    description: "Creates a ClickHouse database for the project along with a user that has read/write access to it. The password is returned once and cannot be retrieved again; use the rotate endpoint to issue a new one.",
    tags: ["Data Warehouse"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      database_name: yupString().defined(),
      username: yupString().defined(),
      password: yupString().defined(),
      connection: yupObject({
        host: yupString().defined(),
        https_port: yupNumber().defined(),
        native_port: yupNumber().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const { password, warehouse } = await provisionDataWarehouse(auth.tenancy);
    const connection = getDataWarehouseConnectionInfo();
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        database_name: warehouse.databaseName,
        username: warehouse.userName,
        password,
        connection: {
          host: connection.host,
          https_port: connection.httpsPort,
          native_port: connection.nativePort,
        },
      },
    };
  },
});
