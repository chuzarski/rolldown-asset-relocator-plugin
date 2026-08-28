# Asset Relocator Plugin for Rolldown

Asset relocation plugin for [Rolldown](https://rolldown.rs) and
[tsdown](https://tsdown.dev), for performing Node.js builds while emitting and
relocating any asset references — including native `.node` addons and the shared
libraries they link against.

This is a port of `@vercel/webpack-asset-relocator-loader`. The analysis engine
is a vendored copy of that loader's, taken at commit `b70a874`; the two are
maintained separately from that point on.

## Installation

```bash
npm i -D @vercel/rolldown-plugin-asset-relocator
```

## Usage

### Rolldown

```js
import { defineConfig } from 'rolldown';
import assetRelocator from '@vercel/rolldown-plugin-asset-relocator';

export default defineConfig({
  input: 'src/index.js',
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'cjs'
  },
  plugins: [
    assetRelocator({
      // optional, base folder for asset emission (eg assets/name.ext)
      outputAssetBase: 'assets',
      // optional, restrict asset emissions to only the given folder
      filterAssetBase: process.cwd(),
      // optional, permit entire __dirname emission
      // eg `const nonAnalyzable = __dirname` can emit everything in the folder
      emitDirnameAll: false,
      // optional, permit entire filterAssetBase emission
      emitFilterAssetBaseAll: false,
      // optional, custom functional asset emitter
      // takes an asset path and returns the replacement
      // or returns false to skip emission
      customEmit: (path, { id, isRequire }) => false | '"./custom-replacement"',
      // optional, a list of asset names already emitted or
      // defined that should not be emitted
      existingAssetNames: [],
      wrapperCompatibility: false, // optional, default
      // build for process.env.NODE_ENV = 'production'
      production: true, // optional, default is undefined
      cwd: process.cwd(), // optional, default
      debugLog: false, // optional, default

      // which modules the analysis runs over. Replaces the webpack loader's
      // `module.rules.test`. Accepts a RegExp, a substring, or an array of
      // either. `.node` files are always handled regardless of these.
      include: /\.(m|c)?js$/, // optional, default
      exclude: undefined // optional, default
    })
  ]
});
```

### tsdown

tsdown consumes Rolldown plugins directly, so there is nothing extra to wire up:

```js
import { defineConfig } from 'tsdown';
import assetRelocator from '@vercel/rolldown-plugin-asset-relocator';

export default defineConfig({
  entry: ['src/index.js'],
  platform: 'node',
  plugins: [assetRelocator({ outputAssetBase: 'assets' })]
});
```

## Output formats

Both `cjs` and `esm` output are supported. The plugin reads the format from the
output options and injects the matching runtime prelude per chunk.

## Asset permissions and symlinks

Unlike the webpack loader, this plugin writes emitted assets itself, in
`writeBundle`. File modes are preserved and symlinks are recreated as links
rather than copied, so a `.node` addon comes out executable and a
`.so`/`.dylib` chain keeps its shape — no post-build `chmod` step needed.

Two consequences follow from that:

- Emitted assets do not appear in Rolldown's bundle object, so other plugins
  cannot see or rewrite them.
- `rolldown.generate()` never reaches `writeBundle`, so an in-memory build emits
  no asset files. Call `plugin.writeAssetsTo(dir)` yourself in that case.

The recorded metadata is available on the plugin object:

```js
const plugin = assetRelocator({ outputAssetBase: 'assets' });

// after the build
plugin.getAssetMeta();                  // { 'assets/foo.node': { path, permissions }, ... }
plugin.getAssetMeta('assets/foo.node'); // { path, permissions }
plugin.getSymlinks();                   // { 'assets/libfoo.so': 'libfoo.so.1', ... }
plugin.getEmittedAssets();              // Map<name, Buffer>
```

## How it works

### Asset relocation

Assets are detected by static analysis of the code, using specific triggers
designed for common Node.js workflows.

- `process.cwd()`, `__filename`, `__dirname`, `path.*()` and `require.resolve`
  are statically analyzed where possible.
- Exact asset paths are emitted as files.
- Exact directory paths are emitted whole.
- Variable path expressions are emitted as wildcards, with the dynamic parts of
  the expression kept intact.

When an asset is emitted, the expression referencing its path is rewritten to
point at the relocated copy.

### Binary relocation

Node binary loading conventions covered:

- `require('bindings')(...)`
- `nbind.init(...)`
- `node-pre-gyp` include patterns
- `node-gyp-build`, including the `prebuilds` directory

Shared libraries loaded by those binaries are emitted too.

### Runtime contract

The webpack loader emits two magic identifiers, `__webpack_require__.ab` and
`__non_webpack_require__`. Neither exists under Rolldown, so this plugin emits
its own and defines them in a per-chunk prelude:

| Identifier | Meaning |
| --- | --- |
| `__rolldown_asset_base__` | absolute path of the emitted asset directory, relative to where the chunk landed |
| `__rolldown_native_require__` | a `require` that escapes the bundler (`eval("require")` under CJS, `createRequire(import.meta.url)` under ESM) |
| `__rolldown_is_main__` | whether this chunk is the process entry point, for `require.main === module` checks |

A chunk only gets the definitions it actually references.

### Node.js compatibility features

- `require.main === module` is kept meaningful for the entry point and folded to
  `false` elsewhere.
- `wrapperCompatibility` handles common AMD / Browserify wrappers. See
  `src/utils/wrappers.js` for the exact transformations.
- `require.resolve` works in the target environment while still emitting in the
  build environment.
- Dynamic `require` calls are resolved to exact paths where possible, and turned
  into runtime dynamic requires where not.

## Differences from the webpack loader

- **Assets are written by the plugin**, not the bundler, so modes and symlinks
  survive. See above for what that costs.
- **The magic identifiers are renamed.** `__webpack_require__.ab` and
  `__non_webpack_require__` become `__rolldown_asset_base__` and
  `__rolldown_native_require__`. Source that already spells
  `__non_webpack_require__` by hand is still recognised and rewritten.
- **`require.main === module` compiles to `__rolldown_is_main__`** rather than
  the loader's `cache[eval('__filename')]` indirection, which only worked under
  CJS.
- **`include`/`exclude` replace `module.rules.test`.** A loader was pointed at
  files by the webpack config; a plugin sees everything and has to filter.
- **`initAssetCache` is gone.** It existed to thread asset permissions through
  webpack 5's build cache. Rolldown has no equivalent hook, and the plugin's
  state lives on the plugin instance for the life of the build.
- **`getAssetMeta` keys are consistent.** The loader recorded `.node` binaries
  and shared libraries under an unprefixed key while emitting them under
  `outputAssetBase`; here every key matches the name the asset is written to,
  which is what makes permission lookup at write time work.
- **`merge-source-maps` is not vendored.** It was an unused import in the loader;
  dropping it also drops the `sourcemap-codec` and `resolve-from` dependencies.

## Tests

```bash
npm test
```

Two suites:

- `test/transform.test.js` drives the analysis engine directly over the fixtures
  in `test/transform/` and snapshots the per-module rewrite. No bundler is
  involved, so a Rolldown release cannot churn these.
- `test/e2e.test.js` bundles the fixtures in `test/e2e/` with Rolldown and with
  tsdown, in both output formats, runs the result under Node, and checks the
  emitted files and their permissions.

To re-record the transform fixtures after an intentional change:

```bash
UPDATE_FIXTURES=1 npm test
```
