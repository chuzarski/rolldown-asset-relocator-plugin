// ==> dir/connection.js (unchanged)
module.exports = 'connection';

// ==> input.js
const driver = global.MONGOOSE_DRIVER_PATH || './dir';

const Connection = require("./dir/connection");
