import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import semver from "semver";
import packageJson from "../../../../../package.json";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
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
    const err = (severe: boolean, msg: string) => ({
      statusCode: 200,
      bodyType: "json",
      body: {
        upToDate: false,
        error: msg,
        severe,
      },
    } as const);

    const clientVersion = req.body.clientVersion;
    if (!semver.valid(clientVersion)) return err(true, `The client version you specified (v${clientVersion}) is not a valid semver version. Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);

    const serverVersion = packageJson.version;

    if (semver.major(clientVersion) !== semver.major(serverVersion) || semver.minor(clientVersion) !== semver.minor(serverVersion)) {
      return err(true, `YOUR VERSION OF STACK AUTH IS SEVERELY OUTDATED. YOU SHOULD UPDATE IT AS SOON AS POSSIBLE. WE CAN'T APPLY SECURITY UPDATES IF YOU DON'T UPDATE STACK AUTH REGULARLY. (your version is v${clientVersion}; the current version is v${serverVersion}).`);
    }
    if (semver.lt(clientVersion, serverVersion)) {
      return err(false, `You are running an outdated version of Stack Auth (v${clientVersion}; the current version is v${serverVersion}). Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);
    }
    if (semver.gt(clientVersion, serverVersion)) {
      return err(false, `You are running a version of Stack Auth that is newer than the newest known version (v${clientVersion} > v${serverVersion}). This is weird. Are you running on a development branch?`);
    }
    if (clientVersion !== serverVersion) {
      return err(true, `You are running a version of Stack Auth that is not the same as the newest known version (v${clientVersion} !== v${serverVersion}). Please update to the latest version as soon as possible to ensure that you get the latest feature and security updates.`);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        upToDate: true,
      },
    };
  },
});
