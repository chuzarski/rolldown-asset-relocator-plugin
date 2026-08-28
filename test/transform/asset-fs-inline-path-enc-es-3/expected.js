// ==> input.js
import fs from 'fs';
import { join } from 'path';

console.log(fs.readFileSync(__rolldown_asset_base__ + "asset.txt", 'utf8'));
