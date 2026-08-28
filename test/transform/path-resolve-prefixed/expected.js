// ==> input.js
const path = require("node:path");
const { resolve } = require("node:path");

fs.createReadStream(__rolldown_asset_base__ + "asset1.txt");
fs.readFileSync(__rolldown_asset_base__ + "asset2.txt");

fs.createReadStream(__rolldown_asset_base__ + "asset1.txt");
fs.readFileSync(__rolldown_asset_base__ + "asset2.txt");
