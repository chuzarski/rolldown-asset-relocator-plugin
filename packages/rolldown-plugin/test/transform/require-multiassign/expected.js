// ==> a.js (unchanged)
module.exports = 'a';

// ==> b.js (unchanged)
module.exports = 'b';

// ==> input.js
var m = './a.js';

if (global.something)
  m = './b.js';

module.exports = require("./b.js");
