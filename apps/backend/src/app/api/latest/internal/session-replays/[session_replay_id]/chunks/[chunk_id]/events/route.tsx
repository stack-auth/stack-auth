import { getPrismaClientForTenancy } from "@/prisma-client";
import { downloadBytes } from "@/s3";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";

const gunzip = promisify(gunzipCb);

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_replay_id: yupString().defined(),
      chunk_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      events: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth, params }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const sessionReplayId = params.session_replay_id;
    const chunkId = params.chunk_id;

    const chunk = await prisma.sessionReplayChunk.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        sessionReplayId,
        id: chunkId,
      },
      select: {
        s3Key: true,
      },
    });
    if (!chunk) {
      throw new KnownErrors.ItemNotFound(chunkId);
    }

    let bytes: Uint8Array;
    try {
      bytes = await downloadBytes({ key: chunk.s3Key, private: true });
    } catch (e: any) {
      const status = e?.$metadata?.httpStatusCode;
      if (status === 404) {
        throw new KnownErrors.ItemNotFound(chunkId);
      }
      throw e;
    }
    const unzipped = new Uint8Array(await gunzip(bytes));

    let parsed: any;
    try {
      parsed = JSON.parse(new TextDecoder().decode(unzipped));
    } catch (e) {
      throw new StackAssertionError("Failed to decode session replay chunk JSON", { cause: e });
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new StackAssertionError("Decoded session replay chunk is not an object");
    }
    if (parsed.session_replay_id !== sessionReplayId) {
      throw new StackAssertionError("Decoded session replay chunk session_replay_id mismatch", {
        expected: sessionReplayId,
        actual: parsed.session_replay_id,
      });
    }
    if (!Array.isArray(parsed.events)) {
      throw new StackAssertionError("Decoded session replay chunk events is not an array");
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        events: parsed.events,
      },
    };
  },
});
