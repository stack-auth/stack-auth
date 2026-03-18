import fs from "fs";
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

/**
 * Reads an output file that may be in either format:
 * - Legacy: a single JSON object keyed by endpoint (`OutputData`)
 * - JSONL: one JSON object per line, each `{ endpoint, output }`
 */
export function loadOutputData(filePath: string): OutputData {
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) return {};

  const firstLine = content.split("\n")[0];
  try {
    const parsed = JSON.parse(firstLine);
    if ("endpoint" in parsed && "output" in parsed) {
      const data: OutputData = {};
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const { endpoint, output } = JSON.parse(line);
        if (!(endpoint in data)) data[endpoint] = [];
        data[endpoint].push(output);
      }
      return data;
    }
  } catch {
    // Not JSONL — fall through to legacy parse
  }

  return JSON.parse(content);
}

export function createApiHelpers(options: {
  targetOutputData?: OutputData,
  /**
   * When set, each API response is streamed to this file as JSONL
   * (one `{ endpoint, output }` object per line). This avoids
   * accumulating all responses in memory.
   */
  outputFilePath?: string,
}) {
  const { targetOutputData, outputFilePath } = options;
  const outputCountByEndpoint = new Map<string, number>();

  if (outputFilePath) {
    fs.writeFileSync(outputFilePath, "");
  }

  function appendOutputData(endpoint: string, output: EndpointOutput) {
    const count = (outputCountByEndpoint.get(endpoint) ?? 0) + 1;
    outputCountByEndpoint.set(endpoint, count);

    if (targetOutputData) {
      if (!(endpoint in targetOutputData)) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected ${endpoint} to be in targetOutputData, but it is not.
        `, { endpoint });
      }
      if (targetOutputData[endpoint].length < count) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected ${targetOutputData[endpoint].length} outputs but got at least ${count}.
        `, { endpoint });
      }
      if (!(deepPlainEquals(targetOutputData[endpoint][count - 1], output))) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected output[${JSON.stringify(endpoint)}][${count - 1}] to be:
              ${JSON.stringify(targetOutputData[endpoint][count - 1], null, 2)}
            but got:
              ${JSON.stringify(output, null, 2)}.
        `, { endpoint });
      }
    }

    if (outputFilePath) {
      fs.appendFileSync(outputFilePath, JSON.stringify({ endpoint, output }) + "\n");
    }
  }

  function verifyOutputCompleteness() {
    // targetOutputData is old output file. 
    if (!targetOutputData) return;
    for (const [endpoint, expectedOutputs] of Object.entries(targetOutputData)) {
      const actualCount = outputCountByEndpoint.get(endpoint) ?? 0;
      if (actualCount !== expectedOutputs.length) {
        throw new StackAssertionError(deindent`
          Output data mismatch for endpoint ${endpoint}:
            Expected ${expectedOutputs.length} outputs but got ${actualCount}.
        `, { endpoint, expectedCount: expectedOutputs.length, actualCount });
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
    verifyOutputCompleteness,
  };
}
