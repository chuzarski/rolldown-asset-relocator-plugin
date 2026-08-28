# Rolldown Asset Relocator Plugin — Design

Date: 2026-08-28
Status: Approved (unattended execution authorized by the user)

## Goal

Port `@vercel/webpack-asset-relocator-loader` to a Rolldown plugin so that Node.js
builds bundled with Rolldown — and with tsdown, which consumes Rolldown plugins
directly — can relocate assets and native (`.node`) addons the same way `ncc`
does under webpack.

Non-goal: changing the existing webpack loader. It stays exactly as it is.

## Decisions

These were settled with the user before implementation:

1. **Vendored copy.** The new plugin lives in `packages/rolldown-plugin/` with its
   own `package.json` and its own copy of the analysis code. The root webpack
   package is untouched — same `main`, same `files`, same publish flow, same
   `yarn.lock`. The two copies will diverge; that is the accepted cost of not
   destabilising a package that is already published and consumed.
2. **The plugin writes assets itself.** Emitted assets do not go through
   Rolldown's `emitFile`. The plugin copies them in `writeBundle`, applying the
   recorded file mode and recreating symlinks. Native addons therefore come out
   executable with no consumer wiring, and `.so`/`.dylib` symlink chains survive.
3. **Hybrid tests.** Per-module transform snapshots over the existing fixture
   inputs, plus a small set of end-to-end tests that bundle with Rolldown and run
   the output under Node.
4. **Both output formats.** `cjs` and `esm` are both supported; the runtime
   prelude is chosen per chunk from the resolved output format.

## Layout

```
packages/rolldown-plugin/
  package.json
  readme.md
  src/
    index.js            plugin factory + Rolldown hooks
    analyze.js          vendored analysis engine (from src/asset-relocator.js)
    runtime.js          prelude generation, runtime identifier names
    host.js             the interface analyze.js talks to
    utils/              vendored: static-eval, wrappers, special-cases,
                        binary-locators, sharedlib-emit, dedupe-names,
                        get-package-base, get-package-scope, merge-source-maps
  test/
    transform.test.js   per-module snapshots
    e2e.test.js         bundle + run under node
    transform/<name>/   input.js + expected.js
    e2e/<name>/
```

`packages/rolldown-plugin` is a standalone package, **not** a yarn workspace of
the root. Adding `workspaces` to the root `package.json` would change how the
existing package installs and publishes, which decision 1 rules out. It gets its
own install step and its own CI job.

## The host interface

The vendored analysis engine is 1400 lines that currently reach into the webpack
loader context in five places. Rather than thread a loader-shaped object through,
`analyze.js` exports a single function that takes a host:

```js
analyze({ id, code, map, options, state, host }) -> { code, map } | null
```

| Host member | Webpack original | Rolldown implementation |
| --- | --- | --- |
| `host.emitAsset(name, source)` | `this.emitFile` | record in `state.assetMeta`, written in `writeBundle` |
| `host.addDependency(path)` | `this.addDependency` | `this.addWatchFile(path)` |
| return value | `this.callback(null, code, map)` | returned object from `transform` |
| `state` | keyed off `compilation` in a module-level `Map` | one object per plugin instance, reset in `buildStart` |
| `state.entryIds` | `compilation.options.entry` | resolved from `inputOptions.input` in the `options` hook |

`options` keeps the loader's option names verbatim — `outputAssetBase`,
`filterAssetBase`, `emitDirnameAll`, `emitFilterAssetBaseAll`, `customEmit`,
`existingAssetNames`, `wrapperCompatibility`, `production`, `cwd`, `debugLog` —
so the readme and existing user knowledge carry over. Two are added:
`include`/`exclude`, defaulting to `/\.(m?js|cjs|node)$/` and `undefined`, which
replace the webpack `module.rules.test` that used to select which files the
loader saw.

## Runtime contract

The webpack loader emits two magic identifiers into transformed code:
`__webpack_require__.ab` (the absolute path of the emitted asset base) and
`__non_webpack_require__` (a `require` that escapes the bundler). Neither exists
in Rolldown. The plugin substitutes its own, defined in `runtime.js`:

```
__webpack_require__.ab   ->  __rolldown_asset_base__
__non_webpack_require__  ->  __rolldown_native_require__
```

Both are plain identifiers, so they survive Rolldown's module analysis untouched.
A `renderChunk` hook scans each chunk for either identifier and, when present,
prepends a prelude defining them. The prelude is chunk-relative: `relBase` is
computed from the chunk's own `fileName` back to the output root, the same
calculation `injectPathHook` does today from `chunk.name`.

CJS prelude:

```js
const __rolldown_native_require__ = eval("require");
const __rolldown_asset_base__ = __dirname + "<relBase>/<assetBase>";
```

`eval("require")` is direct eval in module scope, which is how the webpack loader
already reaches the real `require`; an indirect `(0,eval)` would resolve in global
scope where `require` is not bound.

ESM prelude:

```js
import { createRequire as __rolldown_create_require__ } from "node:module";
const __rolldown_native_require__ = __rolldown_create_require__(import.meta.url);
const __rolldown_asset_base__ = decodeURIComponent(new URL(".", import.meta.url).pathname)
  .slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "<relBase>/<assetBase>";
```

The `decodeURIComponent` / Windows-drive-letter slice is carried over verbatim
from commit b9e42cd — it is the fix for output directories containing a space,
a `~`, or a non-ASCII character, and the same bug applies here. The injected
`import` is hoisted by JS semantics regardless of its position in the chunk, so
prepending it in `renderChunk` is valid.

Prepending is done with `MagicString` so the chunk's sourcemap stays correct.

## `.node` handling

Rolldown will not resolve or parse `.node` files on its own, so the plugin owns
both ends:

- `resolveId` resolves specifiers ending in `.node` (and, via the vendored
  `binary-locators`, the `bindings`/`node-pre-gyp`/`node-gyp-build`/`nbind`
  patterns) to an absolute path and marks them handled.
- `load` reads the binary, records its mode, runs `sharedlibEmit` to pick up the
  shared libraries it links against, and returns JS source:

  ```js
  module.exports = __rolldown_native_require__(__rolldown_asset_base__ + "<name>");
  ```

Returning JS from `load` is what keeps Rolldown from attempting to parse the
binary. The directory depth of the emitted name is preserved relative to the
package base so that `rpath` lookups still resolve.

## Asset writing

`state` accumulates two maps during the build:

- `assetMeta[outName] = { path, permissions }`
- `assetSymlinks[outName] = relativeTarget`

`writeBundle(outputOptions)` resolves `outputOptions.dir`, then for each entry
copies the source file and `chmod`s it to the recorded mode, and for each symlink
creates the link. Directories are created as needed. Symlink creation on Windows
falls back to a file copy when the process lacks the privilege, matching what
`ncc` does.

`getAssetMeta()` and `getSymlinks()` are still exposed on the returned plugin
object, for parity with the loader's API and for consumers who want to inspect
what was relocated.

## `require.main === module`

The loader rewrites this to
`__non_webpack_require__.main == __non_webpack_require__.cache[eval('__filename')]`.
The CJS equivalent carries over directly with the renamed identifier. For ESM
output the construct has no meaning; the plugin rewrites it to a comparison of
`import.meta.url` against `process.argv[1]`, which is the closest faithful
translation of "am I the entry point".

## Testing

**Transform snapshots.** Every directory under `test/transform/` holds an
`input.js` and an `expected.js`. The test drives `analyze()` directly against a
stub host that records emissions, and compares the returned code. This is the
same set of inputs the webpack fixtures use, but the expectation is the
module-level rewrite only — no bundler codegen, so a Rolldown version bump cannot
churn it. Emitted asset names are asserted alongside the code.

**End-to-end.** A handful of fixtures under `test/e2e/` are bundled with Rolldown
for real, in both `cjs` and `esm`, then executed with `node`. The test asserts a
zero exit, expected stdout, that the asset files exist on disk, and that `.node`
files came out with their executable bit. This is the layer that proves the
runtime prelude, the asset writing, and the mode preservation actually work.

Both suites run under the existing Jest setup, scoped to the package.

## CI

A new job in `.github/workflows/ci.yml` installs and tests
`packages/rolldown-plugin` across the existing OS and Node matrix. It does not
gate the existing `release` job, which continues to publish the root package
only.

## Risks

- **Divergence.** The vendored analysis code will drift from the root copy. The
  readme records where it came from and at which commit.
- **Rolldown API churn.** Rolldown's plugin API is Rollup-compatible but young.
  The transform snapshots are insulated from it; the e2e tests are not, by design.
- **`require.main` under ESM.** The translation is a best-effort approximation of
  a CJS-only construct.
