// Rolldown ships ESM only, and the test runner is CJS, so builds are driven
// from this script in a child process. It takes a JSON config on argv and
// writes what the plugin recorded to `__build.json` in the output directory,
// which the test then reads back.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { rolldown } from 'rolldown';

const require = createRequire(import.meta.url);
const assetRelocator = require('../src/index.js');

// Option values that cannot survive JSON. The test names one of these instead
// of trying to serialise a function.
const PRESETS = {
  'custom-emit-replace': { customEmit: () => '"replaced"' },
  'exclude-fixture': { exclude: /asset-basic/ }
};

const config = JSON.parse(process.argv[2]);
const options = Object.assign(
  { outputAssetBase: config.outputAssetBase || undefined },
  config.preset ? PRESETS[config.preset] : {}
);

const plugin = assetRelocator(options);

if (config.bundler === 'tsdown') {
  // tsdown consumes Rolldown plugins directly, so the same plugin instance
  // drives both. This guards the tsdown path against a plugin-API drift.
  const { build } = await import('tsdown');
  await build({
    entry: [config.input],
    outDir: config.dir,
    format: [config.format],
    platform: 'node',
    dts: false,
    clean: true,
    silent: true,
    plugins: [plugin]
  });
}
else {
  const bundle = await rolldown({
    input: config.input,
    platform: 'node',
    plugins: [plugin]
  });

  try {
    await bundle.write({
      dir: config.dir,
      format: config.format,
      entryFileNames: config.entryFileNames
    });
  }
  finally {
    await bundle.close();
  }
}

fs.writeFileSync(
  path.join(config.dir, '__build.json'),
  JSON.stringify({
    assetMeta: plugin.getAssetMeta(),
    symlinks: plugin.getSymlinks(),
    emitted: [...plugin.getEmittedAssets().keys()].sort()
  }, null, 2)
);
