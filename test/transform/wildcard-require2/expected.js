// ==> input.js
function __ncc_wildcard$0 (arg) {
  if (arg === "path1") return require("./modules/path1/index.js");
  else if (arg === "path2") return require("./modules/path2/index.js");
  else if (arg === "path3") return require("./modules/path3/index.js");
}
const num = Math.ceil(Math.random() * 3, 0);

const path = `path${num}`;
const m = __ncc_wildcard$0(path);
console.log(m);

// ==> modules/path1/index.js (unchanged)
module.exports = 'module1';

// ==> modules/path2/index.js (unchanged)
module.exports = 'module2';

// ==> modules/path3/index.js (unchanged)
module.exports = 'module3';
