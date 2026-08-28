// ==> input.js
var binaryLocations = [
  '../' + nodbUtil.RELEASE_DIR + '/' + nodbUtil.BINARY_FILE,  // pre-built binary
  '../' + nodbUtil.RELEASE_DIR + '/' + 'oracledb.node',       // binary built from source
  '../build/Debug/oracledb.node'                              // debug binary
];

for (var i = 0; i < binaryLocations.length; i++) {
  try {
    oracledbCLib = require('./oracledb.js');
    break;
  } catch(err) {
    if (err.code !== 'MODULE_NOT_FOUND' || i == binaryLocations.length - 1) {
      var nodeInfo;
      if (err.code === 'MODULE_NOT_FOUND') {
        // none of the three binaries could be found
        nodeInfo = `\n  Looked for ${binaryLocations.map(x => __rolldown_asset_base__ + "oracledb/" + x).join(', ')}\n  ${nodbUtil.getInstallURL()}\n`;
      } else {
        nodeInfo = `\n  Node.js require('oracledb') error was:\n  ${err.message}\n  ${nodbUtil.getInstallHelp()}\n`;
      }
      throw new Error(nodbUtil.getErrorMessage('NJS-045', nodeInfo));
    }
  }
}

// ==> oracledb.js (unchanged)
module.exports = 'oracledb';
