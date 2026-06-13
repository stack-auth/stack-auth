import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupUnion } from "@hexclave/shared/dist/schema-fields";
import semver from "semver";
import packageJson from "../../../../../package.json";

type VersionCheckResult =
  | {
    upToDate: true,
  }
  | {
    upToDate: false,
    error: string,
    severe: boolean,
  };

function err(severe: boolean, msg: string): VersionCheckResult {
  return {
    upToDate: false,
    error: msg,
    severe,
  };
}

export function checkClientVersion(options: {
  clientPackageName: string | undefined,
  clientVersion: string,
  serverVersion: string,
}): VersionCheckResult {
  const clientPackageName = options.clientPackageName;

  if (clientPackageName == null || !clientPackageName.startsWith("@hexclave/")) {
    return err(true, `You are running an old version of Stack Auth.\n\nStack Auth is rebranding to Hexclave! Please see the instructions on how to migrate your project: https://docs.hexclave.com/migration`);
  }


  const clientVersion = options.clientVersion;
  if (!semver.valid(clientVersion)) return err(true, `The client version you specified (v${clientVersion}) is not a valid semver version. Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);

  const serverVersion = options.serverVersion;

  if (semver.major(clientVersion) !== semver.major(serverVersion) || semver.minor(clientVersion) !== semver.minor(serverVersion)) {
    return err(true, `YOUR VERSION OF HEXCLAVE IS SEVERELY OUTDATED. YOU SHOULD UPDATE IT AS SOON AS POSSIBLE. WE CAN'T APPLY SECURITY UPDATES IF YOU DON'T UPDATE HEXCLAVE REGULARLY. (your version is v${clientVersion}; the current version is v${serverVersion}).`);
  }
  if (semver.lt(clientVersion, serverVersion)) {
    return err(false, `You are running an outdated version of Hexclave (v${clientVersion}; the current version is v${serverVersion}). Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);
  }
  if (!semver.gt(clientVersion, serverVersion) && clientVersion !== serverVersion) {
    return err(true, `You are running a version of Hexclave that is not the same as the newest known version (v${clientVersion} !== v${serverVersion}). Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);
  }

  return {
    upToDate: true,
  };
}

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      clientPackageName: yupString().optional(),
      clientVersion: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupUnion(
      yupObject({
        upToDate: yupBoolean().oneOf([true]).defined(),
      }),
      yupObject({
        upToDate: yupBoolean().oneOf([false]).defined(),
        error: yupString().defined(),
        severe: yupBoolean().defined(),
      }),
    ).defined(),
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: checkClientVersion({
        clientPackageName: req.body.clientPackageName,
        clientVersion: req.body.clientVersion,
        serverVersion: packageJson.version,
      }),
    };
  },
});

import.meta.vitest?.test("checkClientVersion marks @stackframe packages as deprecated", ({ expect }) => {
  expect(checkClientVersion({
    clientPackageName: "@stackframe/dashboard",
    clientVersion: "2.8.109",
    serverVersion: "1.0.0",
  })).toMatchObject({
    upToDate: false,
    severe: true,
  });
});

import.meta.vitest?.test("checkClientVersion only compares @hexclave package versions", ({ expect }) => {
  expect(checkClientVersion({
    clientPackageName: "@hexclave/dashboard",
    clientVersion: "1.0.0",
    serverVersion: "1.0.0",
  })).toEqual({
    upToDate: true,
  });
  expect(checkClientVersion({
    clientPackageName: "@hexclave/dashboard",
    clientVersion: "1.0.0",
    serverVersion: "1.0.1",
  })).toMatchObject({
    upToDate: false,
    severe: false,
  });
});
