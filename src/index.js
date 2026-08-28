const path = require('path');
const fs = require('graceful-fs');
const MagicString = require('magic-string');
const resolve = require('resolve');

const { analyze, relocateNodeBinary, createState, assetBase } = require('./analyze');
const { buildPrelude, detectNeeds } = require('./runtime');

const extensions = ['.js', '.json', '.node'];
const DEFAULT_INCLUDE = /\.(m|c)?js$/;

function toRegExpTest (filter) {
  if (!filter)
    return null;
  const list = Array.isArray(filter) ? filter : [filter];
  return (id) => list.some(entry =>
    entry instanceof RegExp ? entry.test(id) : id.includes(entry)
  );
}

function resolveEntry (entry, basedir) {
  const candidate = path.isAbsolute(entry) ? entry : path.resolve(basedir, entry);
  try {
    return resolve.sync(candidate, { extensions });
  }
  catch (e) {}
  try {
    return resolve.sync(entry, { basedir, extensions });
  }
  catch (e) {}
}

// Rolldown's `input` is a string, an array, or a name -> path record. The
// loader read the same shape off `compilation.options.entry`; entry ids are
// what decide whether a `require.main === module` check is kept or folded away.
function getEntryIds (input, basedir) {
  if (!input)
    return;
  let entries;
  if (typeof input === 'string')
    entries = [input];
  else if (Array.isArray(input))
    entries = input;
  else if (typeof input === 'object')
    entries = Object.values(input);
  else
    return;
  const ids = entries
    .filter(entry => typeof entry === 'string')
    .map(entry => resolveEntry(entry, basedir))
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

function outputDir (outputOptions) {
  if (outputOptions.dir)
    return path.resolve(outputOptions.dir);
  if (outputOptions.file)
    return path.resolve(path.dirname(outputOptions.file));
  return process.cwd();
}

function assetRelocatorPlugin (options = {}) {
  const cwd = typeof options.cwd === 'string' ? path.resolve(options.cwd) : process.cwd();
  const includes = toRegExpTest(options.include) || ((id) => DEFAULT_INCLUDE.test(id));
  const excludes = toRegExpTest(options.exclude);

  // One state object per plugin instance, reset at the start of every build.
  // A plugin instance already has exactly the right lifetime for this, so the
  // state needs no keying of its own.
  let state = createState(options, undefined);
  let emitted = new Map();

  const reset = (entryIds) => {
    state = createState(options, entryIds);
    emitted = new Map();
  };

  const makeHost = (ctx) => ({
    emitAsset (name, source) {
      emitted.set(name, source);
    },
    addDependency (file) {
      if (ctx && typeof ctx.addWatchFile === 'function') {
        try {
          ctx.addWatchFile(file);
        }
        catch (e) {}
      }
    }
  });

  const writeAssets = (dir) => {
    for (const [name, source] of emitted) {
      const dest = path.resolve(dir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, source);
      const meta = state.assetMeta[name];
      if (meta && typeof meta.permissions === 'number') {
        try {
          fs.chmodSync(dest, meta.permissions);
        }
        catch (e) {}
      }
    }
    for (const name of Object.keys(state.assetSymlinks)) {
      const target = state.assetSymlinks[name];
      const dest = path.resolve(dir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.unlinkSync(dest);
      }
      catch (e) {}
      try {
        fs.symlinkSync(target, dest);
      }
      catch (e) {
        // Windows without the symlink privilege: fall back to a plain copy so
        // the build still produces something that loads.
        const resolved = path.resolve(path.dirname(dest), target);
        if (fs.existsSync(resolved))
          fs.copyFileSync(resolved, dest);
        else
          throw e;
      }
    }
  };

  const plugin = {
    name: 'asset-relocator',

    options (inputOptions) {
      reset(getEntryIds(inputOptions && inputOptions.input, cwd));
      return null;
    },

    buildStart (inputOptions) {
      if (!state.entryIds)
        reset(getEntryIds(inputOptions && inputOptions.input, cwd));
    },

    // Rolldown will not resolve a `.node` specifier on its own.
    resolveId (source, importer) {
      if (typeof source !== 'string' || !source.endsWith('.node'))
        return null;
      const basedir = importer ? path.dirname(importer) : cwd;
      const candidate = path.isAbsolute(source) ? source : path.resolve(basedir, source);
      if (fs.existsSync(candidate))
        return candidate;
      try {
        return resolve.sync(source, { basedir, extensions: ['.node'] });
      }
      catch (e) {
        return null;
      }
    },

    async load (id) {
      if (typeof id !== 'string' || !id.endsWith('.node') || id.startsWith('\0'))
        return null;
      const source = fs.readFileSync(id);
      const host = makeHost(this);
      host.addDependency(id);
      const code = await relocateNodeBinary({ id, source, options, state, host });
      return { code, map: null, moduleType: 'js' };
    },

    async transform (code, id) {
      if (typeof id !== 'string' || id.startsWith('\0'))
        return null;
      if (id.endsWith('.node'))
        return null;
      if (!includes(id) || (excludes && excludes(id)))
        return null;

      const host = makeHost(this);
      const result = await analyze({ id, code, map: undefined, options, state, host });
      if (!result)
        return null;
      return { code: result.code, map: result.map };
    },

    // The transformed modules reference `__rolldown_asset_base__`,
    // `__rolldown_native_require__` and `__rolldown_is_main__`. Define whichever
    // of them survived into this chunk, relative to where the chunk landed.
    renderChunk (code, chunk, outputOptions) {
      const needs = detectNeeds(code);
      if (!needs.assetBase && !needs.nativeRequire && !needs.isMain)
        return null;
      const prelude = buildPrelude({
        format: outputOptions && outputOptions.format,
        chunkFileName: chunk.fileName,
        outputAssetBase: options.outputAssetBase,
        needs
      });
      if (!prelude)
        return null;
      const magicString = new MagicString(code);
      magicString.prepend(prelude);
      return {
        code: magicString.toString(),
        map: outputOptions && outputOptions.sourcemap ? magicString.generateMap({ hires: true }) : null
      };
    },

    writeBundle (outputOptions) {
      writeAssets(outputDir(outputOptions));
    },

    getAssetMeta (assetName) {
      return assetName === undefined ? state.assetMeta : state.assetMeta[assetName];
    },

    getSymlinks () {
      return state.assetSymlinks;
    },

    // Assets are written in `writeBundle`, which `rolldown.generate()` never
    // reaches. Consumers doing an in-memory build can call this themselves.
    writeAssetsTo (dir) {
      writeAssets(path.resolve(dir));
    },

    getEmittedAssets () {
      return emitted;
    }
  };

  return plugin;
}

module.exports = assetRelocatorPlugin;
module.exports.assetRelocatorPlugin = assetRelocatorPlugin;
module.exports.default = assetRelocatorPlugin;
module.exports.assetBase = assetBase;
