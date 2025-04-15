import { getRenderedOrganizationConfigQuery } from "@/lib/config";
import { prismaClient, rawQueryAll } from "@/prisma-client";
import { errorToNiceString } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { nicify, stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const result: any[] = await prismaClient.$queryRawUnsafe(fs.readFileSync("../../big_query.untracked.sql", "utf8"));
  console.log("Received big query result");

  const renderedConfigQueries = result.map((row: any) => getRenderedOrganizationConfigQuery({
    projectId: row.project_id,
    branchId: "main",
    organizationId: null,
  }));

  console.log("Querying rendered configs");
  const renderedConfigs = [];

  const batchSize = 500;
  for (let i = 0; i < renderedConfigQueries.length; i += batchSize) {
    const batchQueries = renderedConfigQueries.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(renderedConfigQueries.length / batchSize)}`);
    const batchResults = await rawQueryAll(Object.fromEntries(batchQueries.entries()));
    renderedConfigs.push(...Object.values(batchResults));
  }

  console.log("Done querying rendered configs");

  for (let i = 0; i < result.length; i++) {
    if ((i & (i - 1)) === 0) {
      console.log(`Processing row ${i} of ${result.length}`);
    }

    const row = result[i];
    let renderedConfig: any;
    try {
      renderedConfig = await (renderedConfigs[i] as any);
    } catch (e) {
      console.log(row);
      console.error(errorToNiceString(e));
      return Response.json({
        status: "error",
        message: "ERRRROOOOOOOOORRRR",
      });
    }

    const modifiedRowConfig = {
      ...row.config,
      domains: {
        ...row.config.domains,
        trustedDomains: Object.values(row.config.domains.trustedDomains ?? {}).sort((a: any, b: any) => stringCompare(a.baseUrl, b.baseUrl)),
      },
    };
    const modifiedRenderedConfig = {
      ...renderedConfig,
      domains: {
        ...renderedConfig.domains,
        trustedDomains: Object.values(renderedConfig.domains.trustedDomains ?? {}).sort((a: any, b: any) => stringCompare(a.baseUrl, b.baseUrl)),
      },
    };
    if (!deepPlainEquals(modifiedRowConfig, modifiedRenderedConfig)) {
      console.log("!!!! CONFIG MISMATCH !!!! on row", i);
      fs.writeFileSync(`./mismatch-db.untracked.txt`, "db=" + nicify(modifiedRowConfig));
      fs.writeFileSync(`./mismatch-js.untracked.txt`, "js=" + nicify(modifiedRenderedConfig));
      return Response.json({
        status: "error",
        message: "Config mismatch",
      });
    }
  }

  return NextResponse.json({
    status: "ok",
  });
}

