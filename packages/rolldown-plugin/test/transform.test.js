const fs = require("fs");
const path = require("path");

// special-cases.js keys some of its library detection off this flag so the
// fixtures don't have to ship real copies of google-gax, socket.io, oracledb.
global._unit = true;

const { analyze, createState } = require("../src/analyze");

const fixturesDir = path.join(__dirname, "transform");
const UPDATE = process.env.UPDATE_FIXTURES === "1";

// Mirrors the option set the webpack unit harness uses, so a fixture behaves
// the same under both. The two are independent copies by design.
function optionsFor (name) {
  return {
    existingAssetNames: ["existing.txt"],
    filterAssetBase: path.resolve(__dirname),
    customEmit: name.startsWith("custom-emit")
      ? assetPath => {
          if (assetPath === "./b.js") return '"./a.js"';
          if (assetPath === "./test.json") return '"./test.js"';
          if (assetPath.indexOf("custom-emit") !== -1) return '"./custom-path.txt"';
        }
      : null,
    emitDirnameAll: true,
    emitFilterAssetBaseAll: true,
    wrapperCompatibility: true,
    debugLog: false,
    production: true
  };
}

// Fixture directories move between machines, so any absolute path that survives
// into the output is rewritten to a stable token before comparison.
function normalize (text, dir) {
  return text
    .split(dir).join("<fixture>")
    .split(dir.replace(/\\/g, "/")).join("<fixture>")
    .replace(/\r/g, "")
    .trim();
}

const SKIP_FILES = new Set(["expected.js", "output.js", "output-coverage.js", "actual.js"]);

// Several fixtures do their real work in a dependency rather than the entry —
// `node-gyp-build-resolve`, the wrapper fixtures, the `require-*` set — so
// every JS file in the fixture is analyzed, not just `input.js`.
function sourceFiles (dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules")
          walk(full);
        continue;
      }
      if (!/\.(m|c)?js$/.test(entry.name) || SKIP_FILES.has(entry.name))
        continue;
      found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

async function runFixture (name) {
  const dir = path.join(fixturesDir, name);
  const entryFile = fs.readdirSync(dir).find(file => file.startsWith("input"));
  const entryId = entryFile ? path.join(dir, entryFile) : undefined;
  const options = optionsFor(name);
  const state = createState(options, entryId ? [entryId] : undefined);

  const emitted = new Set();
  const host = {
    emitAsset (assetName) {
      emitted.add(assetName);
    },
    addDependency () {}
  };

  const sections = [];
  for (const id of sourceFiles(dir)) {
    const code = fs.readFileSync(id, "utf8");
    const result = await analyze({ id, code, map: undefined, options, state, host });
    const rel = path.relative(dir, id).split(path.sep).join("/");
    // A null result means "no rewrite needed"; record that explicitly rather
    // than echoing the input, so a fixture losing its transform is visible.
    sections.push(
      `// ==> ${rel}` + (result ? "" : " (unchanged)") + "\n" +
      (result ? result.code.trim() : code.trim())
    );
  }

  return {
    dir,
    code: sections.join("\n\n"),
    assets: [...emitted].map(a => a.split(path.sep).join("/")).sort(),
    symlinks: Object.keys(state.assetSymlinks).sort()
  };
}

// `-err` fixtures hold code that does not parse. The analysis deliberately
// skips those rather than throwing — it is the bundler that reports the syntax
// error, which is what test/e2e.test.js asserts.
for (const name of fs.readdirSync(fixturesDir)) {
  it(`should transform ${name}`, async () => {
    const dir = path.join(fixturesDir, name);
    const run = await runFixture(name);
    const actual = normalize(run.code, dir);
    const actualMeta = { assets: run.assets, symlinks: run.symlinks };

    const expectedPath = path.join(dir, "expected.js");
    const expectedMetaPath = path.join(dir, "expected.json");

    if (UPDATE) {
      fs.writeFileSync(expectedPath, actual + "\n");
      fs.writeFileSync(expectedMetaPath, JSON.stringify(actualMeta, null, 2) + "\n");
      return;
    }

    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(actual).toBe(normalize(fs.readFileSync(expectedPath, "utf8"), dir));
    expect(actualMeta).toEqual(JSON.parse(fs.readFileSync(expectedMetaPath, "utf8")));
  });
}
