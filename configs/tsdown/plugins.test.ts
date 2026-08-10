import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBasePlugin } from './plugins.ts';

describe('tsdown base plugin', () => {
  it('uses the package owning the transformed module for the client version label', async () => {
    const plugin = createBasePlugin({});
    if (typeof plugin.transform !== 'function') {
      throw new Error('Expected the tsdown base plugin to define a transform hook.');
    }

    const moduleId = fileURLToPath(new URL(
      '../../packages/js/src/lib/hexclave-app/apps/implementations/common.ts',
      import.meta.url,
    ));
    const packageJson: { name: string; version: string } = JSON.parse(fs.readFileSync(
      fileURLToPath(new URL('../../packages/js/package.json', import.meta.url)),
      'utf-8',
    ));
    const result = await Reflect.apply(plugin.transform, undefined, [
      'const clientVersion = "STACK_COMPILE_TIME_CLIENT_PACKAGE_VERSION_SENTINEL";',
      moduleId,
      {},
    ]);

    expect(result).not.toBeNull();
    expect(typeof result === 'string' ? result : result?.code).toContain(
      `js ${packageJson.name}@${packageJson.version}`,
    );
    expect(typeof result === 'string' ? result : result?.code).not.toContain('@hexclave/monorepo@0.0.0');
  });
});
