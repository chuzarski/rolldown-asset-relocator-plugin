// ==> input.js
const fs = require('fs');
const { join } = require('path');
console.log(fs.readFileSync(__rolldown_asset_base__ + "asset.txt", 'utf8'));
