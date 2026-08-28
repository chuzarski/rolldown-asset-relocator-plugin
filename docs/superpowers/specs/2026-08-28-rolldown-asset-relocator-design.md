# Rolldown Asset Relocator Plugin — Design

Date: 2026-08-28
Status: Implemented, then superseded in part — see "Amendment" below.

## Goal

Port `@vercel/webpack-asset-relocator-loader` to a Rolldown plugin so that Node.js
builds bundled with Rolldown — and with tsdown, which consumes Rolldown plugins
directly — can relocate assets and native (`.node`) addons the same way `ncc`
does under webpack.

Non-goal (at the time of writing): changing the existing webpack loader. That
constraint was later dropped — see the amendment.

## Decisions

These were settled with the user before implementation:

1. **Vendored copy.** The new plugin lives in `packages/rolldown-plugin/` with its
   own `package.json` and its own copy of the analysis code. The root webpack
   package is untouched — same `main`, same `files`, same publish flow, same
   `yarn.lock`. The two copies will diverge; that is the accepted cost of not
   destabilising a package that is already published and consumed.
   *(Superseded: the webpack package was removed and the plugin promoted to the
   repository root. There is only one copy again.)*
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

*(As designed. The `packages/rolldown-plugin/` prefix is now the repository
root — see the amendment.)*

```
packages/rolldown-plugin/
  package.json
  readme.md
  src/
    index.js            plugin factory, Rolldown hooks, the host implementation
    analyze.js          vendored analysis engine (from src/asset-relocator.js)
    runtime.js          prelude generation, runtime identifier names
    utils/              vendored: static-eval, wrappers, special-cases,
                        binary-locators, sharedlib-emit, dedupe-names,
                        get-package-base, get-package-scope, merge-source-maps
  test/
    transform.test.js   per-module snapshots
    e2e.test.js         bundle + run under node
    e2e-build.mjs       ESM child process that drives Rolldown/tsdown
    transform/<name>/   sources + expected.js + expected.json
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
`__non_webpack_require__.main == __non_webpack_require__.cache[eval('__filename')]`,
which only means anything under CJS. Rather than carry two rewrites, the plugin
replaces the whole comparison with a third runtime identifier,
`__rolldown_is_main__`, and lets the prelude define it per format:

- CJS: `__rolldown_native_require__.main === module` — in a Rolldown CJS chunk
  `module` *is* the chunk's own module, so the check is exact and needs none of
  webpack's `cache[eval('__filename')]` indirection.
- ESM: `!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`.

Non-entry modules still fold to `false`, as they do under the loader.

## Testing

**Transform snapshots.** Every directory under `test/transform/` is a copy of a
webpack unit fixture with its webpack-specific `output.js` removed. The test
drives `analyze()` directly against a stub host that records emissions, and
compares the returned code against `expected.js`; emitted asset names and
symlinks are asserted separately in `expected.json`. No bundler is involved, so
a Rolldown version bump cannot churn these.

Every JS file in a fixture is analyzed, not only `input.js` — several fixtures
(`node-gyp-build-resolve`, the wrapper set, the `require-*` set) do their real
work in a dependency, and analyzing only the entry would have left them
asserting nothing. `expected.js` holds one `// ==> <relpath>` section per file.
`UPDATE_FIXTURES=1 npm test` re-records them.

**End-to-end.** Fixtures under `test/e2e/` are bundled for real, in both `cjs`
and `esm`, then executed with `node`. The suite asserts stdout, that the asset
files exist on disk, that `.node` files kept their executable bit, that symlinks
came out as links, and that a nested chunk still resolves its asset base. One
case builds through tsdown instead of Rolldown, which is the only guard needed
there — tsdown takes Rolldown plugins as-is.

Rolldown is ESM-only and Jest runs CJS, so each build is driven from
`test/e2e-build.mjs` in a child process; it writes what the plugin recorded to
`__build.json` for the test to read back. Options that cannot survive JSON
(`customEmit`, `exclude`) are named presets in that script.

The package installs with npm and has its own lockfile. It is deliberately not a
yarn workspace of the root, per decision 1.

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

## Amendment — webpack removal and pnpm (2026-08-28, same day)

After the port landed and was verified, the constraint that made decision 1
necessary was dropped: the webpack loader is not being kept. That changes three
things and nothing else.

**The webpack package is gone.** `src/asset-relocator.js`, the loader's `src/utils/`,
the whole webpack test suite (`test/index.test.js`, `test/project.test.js`,
`test/esm-asset-base.test.js`, `test/project-chunking/`, `test/unit/`,
`test/yarn-pnp/`) and the `webpack`, `webpack-cli`, `memory-fs`,
`socket.io-client` and `@vercel/ncc` devDependencies were deleted. The published
name is now `@vercel/rolldown-plugin-asset-relocator`.

**The plugin is the repository.** With one package left, a workspace would be
overhead, so `packages/rolldown-plugin/` was promoted to the root. Decision 1
and its "two copies will diverge" cost no longer apply — there is one copy of
the analysis engine and it is the plugin's.

**pnpm replaces yarn.** `yarn.lock` and the plugin's `package-lock.json` are
replaced by a single `pnpm-lock.yaml`; `packageManager` pins `pnpm@11.1.3`. CI
collapses to one `test` job on the existing OS/Node matrix, installing with
`pnpm/action-setup` and `pnpm install --frozen-lockfile`, and `release` runs
`pnpm semantic-release`.

### What deliberately kept a webpack-shaped name

Three things read as webpack references but are not dependencies on it. They
handle code that *arrives from* the ecosystem, so removing them would be a
functional regression:

- `analyze.js` still recognises a hand-written `__non_webpack_require__` in
  dependency source and rewrites it to `__rolldown_native_require__`. Published
  packages do ship that identifier.
- `wrappers.js` still unwraps webpack-generated bundles found inside
  dependencies, under `wrapperCompatibility`. That is about consuming webpack
  *output* from npm.
- `test/transform/require-check/` is the fixture covering the first of those.

The `repository.url` in `package.json` also still points at
`vercel/webpack-asset-relocator-loader`, because that is the repository's actual
name on GitHub. Renaming the remote is the owner's call, not something to guess
at in a commit.
