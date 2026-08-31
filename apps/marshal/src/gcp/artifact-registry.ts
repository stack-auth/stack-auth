import { GcpClient, type GcpOperation } from "./client.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperation(value: unknown): GcpOperation {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("Artifact Registry returned an invalid operation");
  return { name: value.name, ...(typeof value.done === "boolean" ? { done: value.done } : {}) };
}

export class ArtifactRegistryClient {
  constructor(
    private readonly client: GcpClient,
    private readonly projectId: string,
    private readonly region: string,
    private readonly repository = "marshal",
  ) {}

  get registryHost(): string {
    return `${this.region}-docker.pkg.dev`;
  }

  imageRepository(serviceName: string): string {
    return `${this.registryHost}/${this.projectId}/${this.repository}/${serviceName}`;
  }

  async ensureRepository(): Promise<void> {
    const name = `projects/${this.projectId}/locations/${this.region}/repositories/${this.repository}`;
    const url = `https://artifactregistry.googleapis.com/v1/${name}`;
    if (await this.client.request(url, { allow404: true }) !== null) return;
    const operation = await this.client.request(`https://artifactregistry.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/repositories?repositoryId=${encodeURIComponent(this.repository)}`, {
      method: "POST",
      body: {
        name,
        format: "DOCKER",
        description: "Tenant container images built by Hexclave Marshal",
        labels: { "hexclave-managed": "true" },
        dockerConfig: { immutableTags: false },
      },
    });
    await this.client.waitForOperation(parseOperation(operation), { apiBaseUrl: "https://artifactregistry.googleapis.com/v1/", timeoutMillis: 10 * 60 * 1000 });
  }
}
