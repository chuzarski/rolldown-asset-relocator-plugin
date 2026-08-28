// ==> input.js
let toolPath;

if (process.env.RELOCATOR_TOOL_PATH) {
  toolPath = process.env.RELOCATOR_TOOL_PATH;
} else {
  toolPath = __rolldown_asset_base__ + "tool.js";
}

const conditionalToolPath = isHarmony ? __rolldown_asset_base__ + "tool.js" : __rolldown_asset_base__ + "other-tool.js";

module.exports = {
  name: "demo",
  toolPath: __rolldown_asset_base__ + "tool.js",
  conditionalToolPath,
};

// ==> other-tool.js (unchanged)
module.exports = "other tool";

// ==> tool.js (unchanged)
module.exports = "tool";
