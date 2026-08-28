// ==> input.js
const fs = require('fs');

fs.readFile('./asset1.txt')

fs.readFile(__rolldown_asset_base__ + "asset2.txt")

const _basePath = __rolldown_asset_base__ + "fs-emission";
const asset3 = 'asset3.txt';
fs.readFileSync(__rolldown_asset_base__ + "asset3.txt", 'utf8');
