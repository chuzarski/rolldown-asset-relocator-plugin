// ==> input.js
const path = require("path");
const { resolve } = require("path");

fs.createReadStream(__rolldown_asset_base__ + "asset1.txt");
fs.readFileSync(__rolldown_asset_base__ + "asset2.txt");

fs.createReadStream(__rolldown_asset_base__ + "asset1.txt");
fs.readFileSync(__rolldown_asset_base__ + "asset2.txt");
