// ==> dep.js (unchanged)
module.exports = 'dep';

// ==> input.js
// analyzable:
require('./dep');

// non-analyzable:
var s = {
  __rolldown_native_require__
};
s.require('escaped');
__rolldown_native_require__(escaped);
