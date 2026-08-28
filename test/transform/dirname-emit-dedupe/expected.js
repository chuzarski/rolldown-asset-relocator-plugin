// ==> input.js
const fs = require('fs');
console.log(fs.readFileSync(__rolldown_asset_base__ + "asset1.txt"));
console.log(fs.readFileSync(getDirAsset('asset2.txt')));
console.log(fs.readdirSync(__rolldown_asset_base__ + "dir"));

function getDirAsset (name) {
    return __rolldown_asset_base__ + "dir/" + name;
}
