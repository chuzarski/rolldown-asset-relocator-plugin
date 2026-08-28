// Transformed modules reference three identifiers that have no meaning until a
// chunk exists to define them: where the emitted assets landed, a `require`
// that escapes the bundler, and whether this chunk is the process entry point.
// The plugin injects a prelude defining them into any chunk that uses them.
const ASSET_BASE = '__rolldown_asset_base__';
const NATIVE_REQUIRE = '__rolldown_native_require__';
const IS_MAIN = '__rolldown_is_main__';

// Carried over verbatim from the loader: `new URL(...).pathname` is
// percent-encoded, so an output directory containing a space, a `~`, or a
// non-ASCII character would otherwise produce an asset base that does not
// exist on disk. The slice drops the leading `/` of a Windows drive path.
const ESM_DIRNAME =
  "decodeURIComponent(new URL('.', import.meta.url).pathname)" +
  ".slice(import.meta.url.match(/^file:\\/\\/\\/\\w:/) ? 1 : 0, -1)";

// `relBase` walks from the chunk's own directory back up to the output root,
// so a chunk emitted at `nested/index.js` reaches assets at `../assets/`.
function relativeBase (chunkFileName) {
  const dir = require('path').dirname(chunkFileName);
  if (dir === '.' || dir === '')
    return '';
  return require('path').relative(dir, '.').replace(/\\/g, '/') + '/';
}

function isEsm (format) {
  return format === 'es' || format === 'esm' || format === 'module';
}

// Builds the prelude for a single chunk. Only the identifiers the chunk
// actually references get defined, so an untouched chunk stays untouched.
function buildPrelude ({ format, chunkFileName, outputAssetBase, needs }) {
  if (!needs.assetBase && !needs.nativeRequire && !needs.isMain)
    return '';

  const base = relativeBase(chunkFileName) + assetBaseDir(outputAssetBase);
  const lines = [];

  if (isEsm(format)) {
    if (needs.nativeRequire)
      lines.push(`import { createRequire as __rolldown_create_require__ } from "node:module";`);
    if (needs.isMain) {
      lines.push(`import { realpathSync as __rolldown_realpath__ } from "node:fs";`);
      lines.push(`import { fileURLToPath as __rolldown_file_url_to_path__ } from "node:url";`);
    }
    if (needs.nativeRequire)
      lines.push(`const ${NATIVE_REQUIRE} = __rolldown_create_require__(import.meta.url);`);
    if (needs.assetBase)
      lines.push(`const ${ASSET_BASE} = ${ESM_DIRNAME} + ${JSON.stringify('/' + base)};`);
    if (needs.isMain)
      // `import.meta.url` is always the resolved real path, while `process.argv[1]`
      // is whatever the caller typed. Launch an ESM bundle through a symlink — the
      // macOS tmpdir under /var, a symlinked deploy directory — and comparing them
      // directly reports "not main". Resolve both sides before comparing.
      lines.push(
        `const ${IS_MAIN} = (() => { try { return !!process.argv[1] && ` +
        `__rolldown_realpath__(__rolldown_file_url_to_path__(import.meta.url)) === ` +
        `__rolldown_realpath__(process.argv[1]); } catch { return false; } })();`
      );
  }
  else {
    // Direct eval resolves in module scope, where `require` is bound; an
    // indirect `(0, eval)` would resolve in global scope, where it is not.
    if (needs.nativeRequire || needs.isMain)
      lines.push(`const ${NATIVE_REQUIRE} = eval("require");`);
    if (needs.assetBase)
      lines.push(`const ${ASSET_BASE} = __dirname + ${JSON.stringify('/' + base)};`);
    if (needs.isMain)
      lines.push(`const ${IS_MAIN} = ${NATIVE_REQUIRE}.main === module;`);
  }

  return lines.join('\n') + '\n';
}

// Mirrors `assetBase()` in analyze.js — normalises the option to a trailing
// slash, or the empty string when assets go to the output root.
function assetBaseDir (outputAssetBase) {
  if (!outputAssetBase)
    return '';
  if (outputAssetBase.endsWith('/') || outputAssetBase.endsWith('\\'))
    return outputAssetBase;
  return outputAssetBase + '/';
}

function detectNeeds (code) {
  return {
    assetBase: code.includes(ASSET_BASE),
    nativeRequire: code.includes(NATIVE_REQUIRE),
    isMain: code.includes(IS_MAIN)
  };
}

module.exports = {
  ASSET_BASE,
  NATIVE_REQUIRE,
  IS_MAIN,
  assetBaseDir,
  relativeBase,
  isEsm,
  buildPrelude,
  detectNeeds
};
