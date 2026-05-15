#!/usr/bin/env node
import { execFileSync } from "child_process";
import { chmodSync, cpSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const qemuSrc = resolve(packageRoot, "../../docker/local-emulator/qemu");
const envGenScript = resolve(packageRoot, "../../docker/local-emulator/generate-env-development.mjs");
const envSrc = resolve(packageRoot, "../../docker/local-emulator/.env.development");
const distDir = join(packageRoot, "dist");
const emulatorDist = join(distDir, "emulator");

execFileSync(process.execPath, [envGenScript], { stdio: "inherit" });

mkdirSync(emulatorDist, { recursive: true });

for (const name of ["run-emulator.sh", "common.sh", "cloud-init"]) {
  cpSync(join(qemuSrc, name), join(emulatorDist, name), { recursive: true });
}

chmodSync(join(emulatorDist, "run-emulator.sh"), 0o755);

cpSync(envSrc, join(distDir, ".env.development"));

console.log(`Copied emulator assets into ${emulatorDist} (+ .env.development into ${distDir}).`);
