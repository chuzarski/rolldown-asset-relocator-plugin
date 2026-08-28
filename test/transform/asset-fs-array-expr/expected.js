// ==> input.js
const { spawn } = require('child_process');
const { join } = require('path');

const child = spawn(gifsicle, ['--colors', '256', __rolldown_asset_base__ + "asset1.txt"]);
