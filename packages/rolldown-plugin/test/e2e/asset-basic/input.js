const fs = require('fs');
const path = require('path');

const assetPath = path.join(__dirname, 'asset.txt');
console.log(fs.readFileSync(assetPath, 'utf8').trim());
