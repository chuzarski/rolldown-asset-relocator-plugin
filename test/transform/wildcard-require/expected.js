// ==> input.js
function __ncc_wildcard$0 (arg) {
  if (arg === "1.js" || arg === "1") return require("./modules/module1.js");
  else if (arg === "2.js" || arg === "2") return require("./modules/module2.js");
  else if (arg === "3.js" || arg === "3") return require("./modules/module3.js");
}
const num = Math.ceil(Math.random() * 3, 0);

const m = __ncc_wildcard$0(num);
console.log(m);

// ==> modules/module1.js (unchanged)
module.exports = 'module1';

// ==> modules/module2.js (unchanged)
module.exports = 'module2';

// ==> modules/module3.js (unchanged)
module.exports = 'module3';
