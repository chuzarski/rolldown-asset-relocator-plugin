// ==> dep.js (unchanged)
module.exports = 'dep';

// ==> input.js
(function (define) {
  'use strict';
  define(function () {
    require('./dep.js');
  });
})
(typeof define === 'function' && define.amd ? define : function (factory) { module.exports = factory(__rolldown_native_require__); })
