// ==> input.js
import fs from 'fs';
import * as path from 'path';

const join = path.join;

console.log(fs.readFileSync(__rolldown_asset_base__ + "asset.txt", 'utf8'));
