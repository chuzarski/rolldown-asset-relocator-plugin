// ==> dep.js (unchanged)
module.exports = 'dep';

// ==> input.js
(function (factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
     var v = factory(__rolldown_native_require__, exports);
     if (v !== undefined) module.exports = v;
 }
 else if (typeof define === "function" && define.amd) {
     define(["require", "exports", "./impl/format", "./impl/edit", "./impl/scanner", "./impl/parser"], factory);
 }
})(function () {
  require('./dep.js');
});
