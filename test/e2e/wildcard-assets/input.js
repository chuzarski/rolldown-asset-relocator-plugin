const fs = require('fs');
const path = require('path');

const which = process.env.WHICH || 'one';
console.log(fs.readFileSync(path.join(__dirname, 'data', which + '.txt'), 'utf8').trim());
