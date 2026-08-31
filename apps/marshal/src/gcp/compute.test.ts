import { describe, expect, it } from "vitest";
import { builderStartupScript, serviceStartupScript } from "./compute.js";

describe("Compute Engine startup scripts", () => {
  it("quotes tenant values and keeps persistent disks non-auto-deleting", () => {
    const script = serviceStartupScript({
      name: "server",
      image: "docker.io/library/nginx:latest",
      env: { SAFE: "value with spaces", QUOTE: "don't expand $HOME" },
      ports: [8080, 9000],
      revision: "revision-1",
      startCommand: "node server.js",
      volume: { diskName: "hxv-data", path: "/data" },
      serviceKeyHash: "service-key",
    });
    expect(script).toContain("google-hxv-data");
    expect(script).toContain('resize2fs "$DATA_DEVICE"');
    expect(script).toContain("'QUOTE=don'\"'\"'t expand $HOME'");
    expect(script).toContain("'--mount' 'type=bind,src=/mnt/hexclave-data,dst=/data'");
    expect(script).toContain("'--log-driver=gcplogs'");
    expect(script).toContain("MARSHAL_SERVICE_READY $REVISION");
    expect(script).toContain("MARSHAL_IMAGE_REF $RESOLVED_IMAGE");
    expect(script).not.toContain("configure-docker");
  });

  it("configures the credential helper only for Google container registries", () => {
    const script = serviceStartupScript({
      name: "server",
      image: "us-central1-docker.pkg.dev/tenant/marshal/web:latest",
      env: {},
      ports: [8080],
      revision: "revision-1",
      startCommand: null,
      volume: null,
      serviceKeyHash: "service-key",
    });
    expect(script).toContain("docker-credential-gcr configure-docker");
    expect(script).toContain("us-central1-docker.pkg.dev");
  });

  it("obtains short-lived registry credentials from metadata instead of embedding a key", () => {
    const script = builderStartupScript({
      name: "builder",
      image: "moby/buildkit:v0.23.2",
      machineType: "e2-standard-2",
      diskSizeGb: 30,
      files: [{ path: "/marshal-build.sh", contentsBase64: "c2NyaXB0" }],
      env: { REGISTRY_HOST: "us-central1-docker.pkg.dev" },
    });
    expect(script).toContain("metadata.google.internal");
    expect(script).toContain("oauth2accesstoken");
    expect(script).not.toContain("private_key");
    expect(script).not.toContain("instances/$INSTANCE_NAME");
    expect(script).toContain("shutdown -h now");
  });
});
