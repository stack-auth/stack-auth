import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

export type EndpointOutput = {
  status: number,
  responseJson: any,
};

export type OutputData = Record<string, EndpointOutput[]>;

export type ExpectStatusCode = <T = any>(
  expectedStatusCode: number,
  endpoint: string,
  request: RequestInit,
) => Promise<T>;

export function createApiHelpers(options: {
  currentOutputData: OutputData,
  targetOutputData?: OutputData,
}) {
  const { currentOutputData, targetOutputData } = options;

  function appendOutputData(endpoint: string, output: EndpointOutput) {
    if (!(endpoint in currentOutputData)) {
      currentOutputData[endpoint] = [];
    }
    const newLength = currentOutputData[endpoint].push(output);
    if (targetOutputData) {
      if (!(endpoint in targetOutputData)) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected ${endpoint} to be in targetOutputData, but it is not.
        `, { endpoint });
      }
      if (targetOutputData[endpoint].length < newLength) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected ${targetOutputData[endpoint].length} outputs but got at least ${newLength}.
        `, { endpoint });
      }
      if (!(deepPlainEquals(targetOutputData[endpoint][newLength - 1], output))) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected output[${JSON.stringify(endpoint)}][${newLength - 1}] to be:
              ${JSON.stringify(targetOutputData[endpoint][newLength - 1], null, 2)}
            but got:
              ${JSON.stringify(output, null, 2)}.
        `, { endpoint });
      }
    }
  }

  const expectStatusCode: ExpectStatusCode = async (expectedStatusCode, endpoint, request) => {
    const apiUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
    const response = await fetch(new URL(endpoint, apiUrl), {
      ...request,
      headers: {
        "x-stack-disable-artificial-development-delay": "yes",
        "x-stack-development-disable-extended-logging": "yes",
        ...filterUndefined(request.headers ?? {}),
      },
    });

    const responseText = await response.text();

    if (response.status !== expectedStatusCode) {
      throw new StackAssertionError(deindent`
        Expected status code ${expectedStatusCode} but got ${response.status} for ${endpoint}:

            ${responseText}
      `, { request, response });
    }

    const responseJson = JSON.parse(responseText);
    const currentOutput: EndpointOutput = {
      status: response.status,
      responseJson,
    };

    appendOutputData(endpoint, currentOutput);

    return responseJson;
  };

  return {
    appendOutputData,
    expectStatusCode,
  };
}

