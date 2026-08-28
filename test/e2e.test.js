const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Rolldown is ESM-only and this runner is CJS, so each build runs in a child
// process via test/e2e-build.mjs, which reports back through __build.json.
const BUILD_SCRIPT = path.join(__dirname, "e2e-build.mjs");

jest.setTimeout(60000);

const fixturesDir = path.join(__dirname, "e2e");
const tmpDirs = [];

function outDir () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-relocator-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    catch (e) {}
  }
});

async function build (fixture, {
  format = "cjs",
  entryFileNames = "index.js",
  outputAssetBase = "assets",
  preset = undefined,
  bundler = "rolldown"
} = {}) {
  const dir = outDir();
  const config = {
    input: path.join(fixturesDir, fixture, "input.js"),
    dir,
    format,
    entryFileNames,
    outputAssetBase,
    preset,
    bundler
  };
  execFileSync(process.execPath, [BUILD_SCRIPT, JSON.stringify(config)], {
    encoding: "utf8",
    stdio: "pipe"
  });
  const report = JSON.parse(fs.readFileSync(path.join(dir, "__build.json"), "utf8"));
  return {
    dir,
    report,
    entry: path.join(dir, entryFileNames),
    code: fs.readFileSync(path.join(dir, entryFileNames), "utf8")
  };
}

function run (entry, env) {
  return execFileSync(process.execPath, [entry], {
    encoding: "utf8",
    env: Object.assign({}, process.env, env)
  }).trim();
}

// `esm` output needs an extension Node will treat as a module; the fixtures have
// no package.json of their own in the output directory.
const FORMATS = [
  { format: "cjs", entryFileNames: "index.js" },
  { format: "esm", entryFileNames: "index.mjs" }
];

describe.each(FORMATS)("$format output", ({ format, entryFileNames }) => {
  it("relocates a statically resolvable asset and reads it back", async () => {
    const built = await build("asset-basic", { format, entryFileNames });
    expect(fs.existsSync(path.join(built.dir, "assets", "asset.txt"))).toBe(true);
    expect(run(built.entry)).toBe("hello from the relocated asset");
  });

  it("keeps the entry's require.main check true", async () => {
    const built = await build("require-main", { format, entryFileNames });
    expect(run(built.entry)).toBe("entry");
  });

  // `import.meta.url` resolves symlinks; `process.argv[1]` does not. A bundle
  // launched through a symlinked path — the macOS tmpdir under /var, a symlinked
  // deploy directory — must still recognise itself as the entry point.
  (process.platform === "win32" ? it.skip : it)(
    "keeps require.main true when launched through a symlinked path",
    async () => {
      const built = await build("require-main", { format, entryFileNames });
      const link = built.dir + "-link";
      fs.symlinkSync(built.dir, link);
      tmpDirs.push(link);
      expect(run(path.join(link, entryFileNames))).toBe("entry");
    }
  );

  it("emits every candidate of a wildcard path and reads the selected one", async () => {
    const built = await build("wildcard-assets", { format, entryFileNames });
    expect(fs.existsSync(path.join(built.dir, "assets", "data", "one.txt"))).toBe(true);
    expect(fs.existsSync(path.join(built.dir, "assets", "data", "two.txt"))).toBe(true);
    expect(run(built.entry, { WHICH: "one" })).toBe("payload one");
    expect(run(built.entry, { WHICH: "two" })).toBe("payload two");
  });

  it("resolves the asset base from a chunk in a subdirectory", async () => {
    const nested = "nested/" + entryFileNames;
    const built = await build("asset-basic", { format, entryFileNames: nested });
    expect(fs.existsSync(path.join(built.dir, "assets", "asset.txt"))).toBe(true);
    expect(run(built.entry)).toBe("hello from the relocated asset");
  });

  // `null` rather than `undefined`: a destructuring default would otherwise
  // put "assets" back and the test would silently assert nothing.
  it("emits assets to the output root when no outputAssetBase is set", async () => {
    const built = await build("asset-basic", { format, entryFileNames, outputAssetBase: null });
    expect(fs.existsSync(path.join(built.dir, "asset.txt"))).toBe(true);
    expect(run(built.entry)).toBe("hello from the relocated asset");
  });

  it("emits a .node binary with its permissions preserved", async () => {
    const built = await build("native-addon", { format, entryFileNames });
    const addon = path.join(built.dir, "assets", "addon.node");
    expect(fs.existsSync(addon)).toBe(true);

    // The fixture binary is not a loadable addon, so the require stays behind a
    // function that is never called. What matters is that it was rewritten to
    // the escape-hatch require against the relocated path, and that the file
    // came out executable.
    expect(built.code).toContain("__rolldown_native_require__");
    expect(built.code).toContain("__rolldown_asset_base__");
    expect(run(built.entry)).toBe("addon loader ready: function");

    if (process.platform !== "win32") {
      const mode = fs.statSync(addon).mode & 0o777;
      const sourceMode = fs.statSync(
        path.join(fixturesDir, "native-addon", "build", "Release", "addon.node")
      ).mode & 0o777;
      expect(mode).toBe(sourceMode);
      expect(mode & 0o111).toBeGreaterThan(0);
    }
  });

  it("fails the build on a file that does not parse", async () => {
    await expect(build("syntax-err", { format, entryFileNames })).rejects.toBeDefined();
  });
});

// Symlinks are recorded separately from regular assets and recreated as links
// rather than copies, so a shared-library chain keeps its shape.
(process.platform === "win32" ? describe.skip : describe)("symlinked assets", () => {
  const fixture = path.join(fixturesDir, "symlink-asset");
  const link = path.join(fixture, "link.txt");

  beforeAll(() => {
    try {
      fs.unlinkSync(link);
    }
    catch (e) {}
    fs.symlinkSync("real.txt", link);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(link);
    }
    catch (e) {}
  });

  it("recreates the symlink in the output", async () => {
    const built = await build("symlink-asset");
    const emitted = path.join(built.dir, "assets", "link.txt");
    expect(fs.lstatSync(emitted).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(emitted)).toBe("real.txt");
    expect(built.report.symlinks["assets/link.txt"]).toBe("real.txt");
  });
});

describe("plugin API", () => {
  it("exposes asset metadata for the emitted assets", async () => {
    const built = await build("native-addon");
    const meta = built.report.assetMeta["assets/addon.node"];
    expect(meta).toBeDefined();
    expect(typeof meta.path).toBe("string");
    expect(meta.permissions).toBeGreaterThan(0);
  });

  it("honours a customEmit that replaces the asset reference", async () => {
    const built = await build("asset-basic", {
      preset: "custom-emit-replace"
    });
    expect(built.code).toContain('"replaced"');
    expect(fs.existsSync(path.join(built.dir, "assets", "asset.txt"))).toBe(false);
  });

  it("skips files excluded by the exclude option", async () => {
    const built = await build("asset-basic", {
      preset: "exclude-fixture"
    });
    expect(built.code).not.toContain("__rolldown_asset_base__");
    expect(fs.existsSync(path.join(built.dir, "assets", "asset.txt"))).toBe(false);
  });
});

// tsdown builds on Rolldown and takes Rolldown plugins as-is, so the plugin
// needs no tsdown-specific code — only proof that the contract holds.
describe("tsdown", () => {
  it("relocates assets through a tsdown build", async () => {
    const built = await build("asset-basic", {
      bundler: "tsdown",
      format: "cjs",
      entryFileNames: "input.cjs"
    });
    expect(fs.existsSync(path.join(built.dir, "assets", "asset.txt"))).toBe(true);
    expect(built.code).toContain("__rolldown_asset_base__");
    expect(run(built.entry)).toBe("hello from the relocated asset");
  });
});
