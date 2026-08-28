// ==> input.js
const fs = require('fs');
const { join } = require('path');

console.log(fs.readFileSync(__rolldown_asset_base__ + "asset.txt", 'utf8'));

(function () {
  var join = () => 'nope';
  console.log(fs.readFileSync(join(__rolldown_asset_base__ + "asset-fs-inline-path-shadow", 'asset.txt'), 'utf8'));
})();
