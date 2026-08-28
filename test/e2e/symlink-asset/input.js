const fs = require('fs');
const path = require('path');

console.log(fs.readFileSync(path.join(__dirname, 'link.txt'), 'utf8').trim());
