# Asset Relocator Plugin for Rolldown

Asset relocation plugin for [Rolldown](https://rolldown.rs) and
[tsdown](https://tsdown.dev), for performing Node.js builds while emitting and
relocating any asset references — including native `.node` addons and the shared
libraries they link against.

## Installation

```bash
pnpm add -D github:chuzarski/rolldown-asset-relocator-plugin
```

## Usage

### Rolldown

```js
import { defineConfig } from 'rolldown';
import assetRelocator from 'rolldown-asset-relocator-plugin';

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
      // optional, unwrap AMD / Browserify / bundler wrappers found in
      // dependencies so their asset references can be analyzed
      wrapperCompatibility: false, // optional, default
      // build for process.env.NODE_ENV = 'production'
      production: true, // optional, default is undefined
      cwd: process.cwd(), // optional, default
      debugLog: false, // optional, default

      // which modules the analysis runs over. Accepts a RegExp, a substring,
      // or an array of either. `.node` files are always handled regardless.
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
import assetRelocator from 'rolldown-asset-relocator-plugin';

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

The plugin writes emitted assets itself, in `writeBundle`. File modes are
preserved and symlinks are recreated as links rather than copied, so a `.node`
addon comes out executable and a `.so`/`.dylib` chain keeps its shape — no
post-build `chmod` step needed.

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

Every key matches the name the asset is written to, including for `.node`
binaries and shared libraries.

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

Transformed modules reference three identifiers, defined by a prelude the plugin
injects into each chunk that uses them:

| Identifier | Meaning |
| --- | --- |
| `__rolldown_asset_base__` | absolute path of the emitted asset directory, relative to where the chunk landed |
| `__rolldown_native_require__` | a `require` that escapes the bundler (`eval("require")` under CJS, `createRequire(import.meta.url)` under ESM) |
| `__rolldown_is_main__` | whether this chunk is the process entry point, for `require.main === module` checks |

A chunk only gets the definitions it actually references.

### Node.js compatibility features

- `require.main === module` is kept meaningful for the entry point and folded to
  `false` elsewhere.
- `wrapperCompatibility` unwraps common AMD / Browserify / bundler wrappers found
  in already-bundled dependencies, so their asset references can still be
  analyzed. See `src/utils/wrappers.js` for the exact transformations.
- `require.resolve` works in the target environment while still emitting in the
  build environment.
- Dynamic `require` calls are resolved to exact paths where possible, and turned
  into runtime dynamic requires where not.
- A dependency that spells `__non_webpack_require__` by hand — a pattern some
  published packages ship — is recognised and rewritten to the escape-hatch
  require.

## Development

```bash
pnpm install
pnpm test
```

Two suites:

- `test/transform.test.js` drives the analysis engine directly over the fixtures
  in `test/transform/` and snapshots the per-module rewrite. No bundler is
  involved, so a Rolldown release cannot churn these.
- `test/e2e.test.js` bundles the fixtures in `test/e2e/` with Rolldown and with
  tsdown, in both output formats, runs the result under Node, and checks the
  emitted files and their permissions. Rolldown is ESM-only and the runner is
  CJS, so each build happens in a child process via `test/e2e-build.mjs`.

To re-record the transform fixtures after an intentional change:

```bash
UPDATE_FIXTURES=1 pnpm test
```

## History and attribution

This plugin began as a port of
[`@vercel/webpack-asset-relocator-loader`](https://github.com/vercel/webpack-asset-relocator-loader),
the loader `ncc` used for the same job under webpack. The webpack loader and its
test suite have been removed; the static-analysis engine that survived — the
asset detection, the static evaluator, the binary locators, the wrapper
handling — is derived from that work and is the substantial majority of what
this package does.

It is MIT-licensed, and remains so. `LICENSE` carries both notices: Vercel's
original, retained verbatim as the licence requires, and one covering the
Rolldown port and everything since.

Parts of the port were written with [Claude](https://claude.com/claude-code)
as a coding assistant; the relevant commits carry `Co-Authored-By` trailers.
That is a contribution credit rather than a copyright claim — under the U.S.
Copyright Office's [2025 guidance](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)
material generated by AI is not itself copyrightable and an AI cannot hold
copyright, so no such notice appears in `LICENSE`.
