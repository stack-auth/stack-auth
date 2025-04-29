import { validateRedirectUrl } from "@/lib/redirect-urls";
import { getSoleTenancyFromProjectBranch, Tenancy } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { Prisma, VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { DeepPartial } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";
import { SmartRequest } from "./smart-request";
import { SmartResponse } from "./smart-response";
import { createSmartRouteHandler, SmartRouteHandler, SmartRouteHandlerOverloadMetadata } from "./smart-route-handler";

const MAX_ATTEMPTS_PER_CODE = 20;

type CreateCodeOptions<Data, Method extends {}, CallbackUrl extends string | URL | undefined, AlreadyParsed extends boolean = true> = ProjectBranchCombo<AlreadyParsed> & {
  method: Method,
  expiresInMs?: number,
  data: Data,
  callbackUrl: CallbackUrl,
};

type ListCodesOptions<Data, AlreadyParsed extends boolean = true> = ProjectBranchCombo<AlreadyParsed> & {
  dataFilter?: Prisma.JsonFilter<"VerificationCode"> | undefined,
}

type RevokeCodeOptions<AlreadyParsed extends boolean = true> = ProjectBranchCombo<AlreadyParsed> & {
  id: string,
}

type CodeObject<Data, Method extends {}, CallbackUrl extends string | URL | undefined> = {
  id: string,
  data: Data,
  method: Method,
  code: string,
  link: CallbackUrl extends string | URL ? URL : undefined,
  expiresAt: Date,
};

type VerificationCodeHandler<Data, SendCodeExtraOptions extends {}, SendCodeReturnType, HasDetails extends boolean, Method extends {}> = {
  createCode<CallbackUrl extends string | URL | undefined>(options: CreateCodeOptions<Data, Method, CallbackUrl, false>): Promise<CodeObject<Data, Method, CallbackUrl>>,
  sendCode(options: CreateCodeOptions<Data, Method, string | URL, false>, sendOptions: SendCodeExtraOptions): Promise<SendCodeReturnType>,
  listCodes(options: ListCodesOptions<Data, false>): Promise<CodeObject<Data, Method, string | URL>[]>,
  revokeCode(options: RevokeCodeOptions<false>): Promise<void>,
  postHandler: SmartRouteHandler<any, any, any>,
  checkHandler: SmartRouteHandler<any, any, any>,
  detailsHandler: HasDetails extends true ? SmartRouteHandler<any, any, any> : undefined,
};

type ProjectBranchCombo<AlreadyParsed extends boolean> = (
  | { project: Omit<ProjectsCrud["Admin"]["Read"], "config">, branchId: string, tenancy?: undefined }
  | (AlreadyParsed extends true ? never : { tenancy: Tenancy, project?: undefined, branchId?: undefined })
);

function parseProjectBranchCombo<T extends ProjectBranchCombo<boolean>>(obj: T): T & ProjectBranchCombo<true> {
  return {
    ...obj,
    project: obj.project ?? obj.tenancy.project,
    branchId: obj.branchId ?? obj.tenancy.branchId,
  };
}

/**
 * Make sure to always check that the method is the same as the one in the data.
 */
export function createVerificationCodeHandler<
  Data,
  RequestBody extends {} & DeepPartial<SmartRequest["body"]>,
  Response extends SmartResponse,
  DetailsResponse extends SmartResponse | undefined,
  SendCodeExtraOptions extends {},
  Method extends {},
  SendCodeReturnType,
>(options: {
  metadata?: {
    post?: SmartRouteHandlerOverloadMetadata,
    check?: SmartRouteHandlerOverloadMetadata,
    details?: SmartRouteHandlerOverloadMetadata,
    codeDescription?: string,
  },
  type: VerificationCodeType,
  data: yup.Schema<Data>,
  method: yup.Schema<Method>,
  requestBody?: yup.ObjectSchema<RequestBody>,
  detailsResponse?: yup.Schema<DetailsResponse>,
  response: yup.Schema<Response>,
  send?(
    codeObject: CodeObject<Data, Method, string | URL>,
    createOptions: CreateCodeOptions<Data, Method, string | URL>,
    sendOptions: SendCodeExtraOptions,
  ): Promise<SendCodeReturnType>,
  validate?(
    tenancy: Tenancy,
    method: Method,
    data: Data,
    body: RequestBody,
    user: UsersCrud["Admin"]["Read"] | undefined
  ): Promise<void>,
  handler(
    tenancy: Tenancy,
    method: Method,
    data: Data,
    body: RequestBody,
    user: UsersCrud["Admin"]["Read"] | undefined,
  ): Promise<Response>,
  details?: DetailsResponse extends SmartResponse ? ((
    tenancy: Tenancy,
    method: Method,
    data: Data,
    body: RequestBody,
    user: UsersCrud["Admin"]["Read"] | undefined
  ) => Promise<DetailsResponse>) : undefined,
}): VerificationCodeHandler<Data, SendCodeExtraOptions, SendCodeReturnType, DetailsResponse extends SmartResponse ? true : false, Method> {
  const createHandler = (handlerType: 'post' | 'check' | 'details') => createSmartRouteHandler({
    metadata: options.metadata?.[handlerType],
    request: yupObject({
      auth: yupObject({
        tenancy: adaptSchema.defined(),
        project: adaptSchema.defined(),
        branchId: adaptSchema.defined(),
        user: adaptSchema,
      }).defined(),
      body: yupObject({
        code: yupString().length(45).defined().meta({ openapiField: { description: options.metadata?.codeDescription || "A 45 character code", exampleValue: "u3h6gn4w24pqc8ya679inrhjwh1rybth6a7thurqhnpf2" } }),
      // we cast to undefined as a typehack because the types are a bit icky
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      }).concat((handlerType === 'post' ? options.requestBody : undefined) as undefined ?? yupObject({})).defined(),
    }),
    response: handlerType === 'check' ?
      yupObject({
        statusCode: yupNumber().oneOf([200]).defined(),
        bodyType: yupString().oneOf(["json"]).defined(),
        body: yupObject({
          "is_code_valid": yupBoolean().oneOf([true]).defined(),
        }).defined(),
      }).defined() as yup.ObjectSchema<any> :
      handlerType === 'details' ?
        options.detailsResponse || throwErr('detailsResponse is required') :
        options.response,
    async handler({ body: { code: codeRaw, ...requestBody }, auth }) {
      // Codes generated by createCode are always lowercase, but the code sent in the e-mail is uppercase
      // To not confuse the developers, we always convert the code to lowercase
      const code = codeRaw.toLowerCase();

      const verificationCode = await prismaClient.verificationCode.findUnique({
        where: {
          projectId_branchId_code: {
            projectId: auth.project.id,
            branchId: auth.branchId,
            code,
          },
          type: options.type,
        },
      });

      // Increment the attempt count for all codes that match except for the first 6 characters
      await prismaClient.verificationCode.updateMany({
        where: {
          projectId: auth.project.id,
          branchId: auth.branchId,
          code: {
            endsWith: code.slice(6),
          }
        },
        data: {
          attemptCount: { increment: 1 },
        },
      });

      if (!verificationCode) throw new KnownErrors.VerificationCodeNotFound();
      if (verificationCode.expiresAt < new Date()) throw new KnownErrors.VerificationCodeExpired();
      if (verificationCode.usedAt) throw new KnownErrors.VerificationCodeAlreadyUsed();
      if (verificationCode.attemptCount >= MAX_ATTEMPTS_PER_CODE) throw new KnownErrors.VerificationCodeMaxAttemptsReached;

      const validatedMethod = await options.method.validate(verificationCode.method, {
        strict: true,
      });
      const validatedData = await options.data.validate(verificationCode.data, {
        strict: true,
      });

      if (options.validate) {
        await options.validate(auth.tenancy, validatedMethod, validatedData, requestBody as any, auth.user as any);
      }

      switch (handlerType) {
        case 'post': {
          await prismaClient.verificationCode.update({
            where: {
              projectId_branchId_code: {
                projectId: auth.project.id,
                branchId: auth.tenancy.branchId,
                code,
              },
              type: options.type,
            },
            data: {
              usedAt: new Date(),
            },
          });

          return await options.handler(auth.tenancy, validatedMethod, validatedData, requestBody as any, auth.user);
        }
        case 'check': {
          return {
            statusCode: 200,
            bodyType: "json",
            body: {
              is_code_valid: true,
            },
          };
        }
        case 'details': {
          return await options.details?.(auth.tenancy, validatedMethod, validatedData, requestBody as any, auth.user as any) as any;
        }
      }
    },
  });

  return {
    async createCode({ method, data, callbackUrl, expiresInMs, ...params }) {
      const { project, branchId } = parseProjectBranchCombo(params);
      const validatedData = await options.data.validate(data, {
        strict: true,
      });
      const tenancy = await getSoleTenancyFromProjectBranch(project.id, branchId);

      if (callbackUrl !== undefined && !validateRedirectUrl(
        callbackUrl,
        tenancy.config.domains,
        tenancy.config.allow_localhost,
      )) {
        throw new KnownErrors.RedirectUrlNotWhitelisted();
      }

      const verificationCodePrisma = await prismaClient.verificationCode.create({
        data: {
          projectId: project.id,
          branchId,
          type: options.type,
          code: generateSecureRandomString(),
          redirectUrl: callbackUrl?.toString(),
          expiresAt: new Date(Date.now() + (expiresInMs ?? 1000 * 60 * 60 * 24 * 7)),  // default: expire after 7 days
          data: validatedData as any,
          method: method,
        }
      });

      return createCodeObjectFromPrismaCode(verificationCodePrisma);
    },
    async sendCode(createOptions, sendOptions) {
      const codeObj = await this.createCode(createOptions);
      if (!options.send) {
        throw new StackAssertionError("Cannot use sendCode on this verification code handler because it doesn't have a send function");
      }
      return await options.send(codeObj, parseProjectBranchCombo(createOptions), sendOptions);
    },
    async listCodes(listOptions) {
      const { project, branchId } = parseProjectBranchCombo(listOptions);
      const codes = await prismaClient.verificationCode.findMany({
        where: {
          projectId: project.id,
          branchId,
          type: options.type,
          data: listOptions.dataFilter,
          expiresAt: {
            gt: new Date(),
          },
          usedAt: null,
        },
      });
      return codes.map(code => createCodeObjectFromPrismaCode(code));
    },
    async revokeCode(options) {
      const { project, branchId } = parseProjectBranchCombo(options);
      await prismaClient.verificationCode.delete({
        where: {
          projectId_branchId_id: {
            projectId: project.id,
            branchId,
            id: options.id,
          },
        },
      });
    },
    postHandler: createHandler('post'),
    checkHandler: createHandler('check'),
    detailsHandler: (options.detailsResponse ? createHandler('details') : undefined) as any,
  };
}


function createCodeObjectFromPrismaCode<Data, Method extends {}, CallbackUrl extends string | URL | undefined>(code: Prisma.VerificationCodeGetPayload<{}>): CodeObject<Data, Method, CallbackUrl> {
  let link: URL | undefined;
  if (code.redirectUrl !== null) {
    link = new URL(code.redirectUrl);
    link.searchParams.set('code', code.code);
  }

  return {
    id: code.id,
    data: code.data as Data,
    method: code.method as Method,
    code: code.code,
    link: link as any,
    expiresAt: code.expiresAt,
  };
}
