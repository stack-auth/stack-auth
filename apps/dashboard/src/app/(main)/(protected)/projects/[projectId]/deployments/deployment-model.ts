import type { Edge, Node } from "@xyflow/react";

export type ServiceKind =
  | "serverless"
  | "server"
  | "postgres"
  | "convex"
  | "redis"
  | "worker"
  | "public-internet"
  | "hexclave";

export type DeploymentField = {
  id: string,
  label: string,
  value: string,
  secret?: boolean,
};

export type DeploymentNodeData = {
  kind: ServiceKind,
  title: string,
  immutable: boolean,
  inputs: DeploymentField[],
  outputs: DeploymentField[],
};

export type DeploymentNode = Node<DeploymentNodeData, "deployment">;
export type DeploymentEdge = Edge;

type ServiceTemplate = {
  title: string,
  inputs: readonly string[],
  outputs: readonly string[],
};

export const ADDABLE_SERVICE_KINDS = [
  "serverless",
  "server",
  "postgres",
  "convex",
  "redis",
  "worker",
] as const satisfies readonly ServiceKind[];

const SERVICE_TEMPLATES = new Map<ServiceKind, ServiceTemplate>([
  ["serverless", {
    title: "Serverless",
    inputs: ["DATABASE_URL", "HEXCLAVE_PROJECT_ID"],
    outputs: ["Deployment URL"],
  }],
  ["server", {
    title: "Server",
    inputs: ["DATABASE_URL", "HEXCLAVE_SECRET_SERVER_KEY"],
    outputs: ["Deployment URL", "Private address"],
  }],
  ["postgres", {
    title: "Postgres",
    inputs: [],
    outputs: ["Connection string", "Host"],
  }],
  ["convex", {
    title: "Convex",
    inputs: ["HEXCLAVE_PROJECT_ID"],
    outputs: ["Deployment URL"],
  }],
  ["redis", {
    title: "Redis",
    inputs: [],
    outputs: ["Connection string"],
  }],
  ["worker", {
    title: "Worker",
    inputs: ["QUEUE_URL", "HEXCLAVE_SECRET_SERVER_KEY"],
    outputs: [],
  }],
]);

function field(id: string, label: string, value = ""): DeploymentField {
  return { id, label, value };
}

function templateFor(kind: ServiceKind): ServiceTemplate {
  const template = SERVICE_TEMPLATES.get(kind);
  if (template == null) {
    throw new Error(`Service kind "${kind}" cannot be added from the service menu.`);
  }
  return template;
}

export function createServiceNode(kind: ServiceKind, index: number): DeploymentNode {
  const template = templateFor(kind);
  const nodeId = crypto.randomUUID();

  return {
    id: nodeId,
    type: "deployment",
    position: {
      x: 360 + (index % 3) * 80,
      y: 100 + (index % 5) * 70,
    },
    data: {
      kind,
      title: `${template.title} ${index + 1}`,
      immutable: false,
      inputs: template.inputs.map((label, fieldIndex) => field(`${nodeId}-input-${fieldIndex}`, label)),
      outputs: template.outputs.map((label, fieldIndex) => field(`${nodeId}-output-${fieldIndex}`, label)),
    },
  };
}

export function createInitialDeploymentGraph(projectId: string): {
  nodes: DeploymentNode[],
  edges: DeploymentEdge[],
} {
  const hexclaveProjectIdHandle = "hexclave-project-id";
  const hexclaveSecretKeyHandle = "hexclave-secret-server-key";
  const postgresConnectionHandle = "postgres-connection-string";
  const serverlessProjectInput = "serverless-project-id";
  const serverlessDatabaseInput = "serverless-database-url";
  const serverlessUrlHandle = "serverless-deployment-url";
  const publicDomainHandle = "public-domain-app";

  return {
    nodes: [
      {
        id: "public-internet",
        type: "deployment",
        position: { x: 1050, y: 80 },
        deletable: false,
        data: {
          kind: "public-internet",
          title: "Public internet",
          immutable: true,
          inputs: [
            field(publicDomainHandle, "Domain", "app.example.com"),
            field("public-domain-api", "Domain", "api.example.com"),
          ],
          outputs: [],
        },
      },
      {
        id: "hexclave",
        type: "deployment",
        position: { x: 0, y: 120 },
        deletable: false,
        data: {
          kind: "hexclave",
          title: "Hexclave",
          immutable: true,
          inputs: [],
          outputs: [
            field(hexclaveProjectIdHandle, "Project ID", projectId),
            { ...field(hexclaveSecretKeyHandle, "Secret server key", "••••••••••••"), secret: true },
            field("hexclave-publishable-key", "Publishable client key", "pck_••••••••"),
          ],
        },
      },
      {
        id: "postgres-main",
        type: "deployment",
        position: { x: 40, y: 500 },
        data: {
          kind: "postgres",
          title: "Primary database",
          immutable: false,
          inputs: [],
          outputs: [
            field(postgresConnectionHandle, "Connection string", "postgresql://••••••••"),
            field("postgres-host", "Host", "db.internal"),
          ],
        },
      },
      {
        id: "serverless-web",
        type: "deployment",
        position: { x: 540, y: 220 },
        data: {
          kind: "serverless",
          title: "Web application",
          immutable: false,
          inputs: [
            field(serverlessProjectInput, "HEXCLAVE_PROJECT_ID"),
            field(serverlessDatabaseInput, "DATABASE_URL"),
            field("serverless-api-key", "THIRD_PARTY_API_KEY", "sk_live_••••"),
          ],
          outputs: [
            field(serverlessUrlHandle, "Deployment URL", "https://web.example.dev"),
          ],
        },
      },
    ],
    edges: [
      {
        id: "hexclave-project-to-web",
        source: "hexclave",
        sourceHandle: hexclaveProjectIdHandle,
        target: "serverless-web",
        targetHandle: serverlessProjectInput,
        type: "smoothstep",
        animated: true,
      },
      {
        id: "postgres-to-web",
        source: "postgres-main",
        sourceHandle: postgresConnectionHandle,
        target: "serverless-web",
        targetHandle: serverlessDatabaseInput,
        type: "smoothstep",
        animated: true,
      },
      {
        id: "web-to-public-domain",
        source: "serverless-web",
        sourceHandle: serverlessUrlHandle,
        target: "public-internet",
        targetHandle: publicDomainHandle,
        type: "smoothstep",
        animated: true,
      },
    ],
  };
}
