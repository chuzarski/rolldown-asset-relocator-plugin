// ==> dep.js
// this is a dep main check, so it is known to be false
console.log(false);

// ==> input.js
require('./dep.js');
// this is the entry main check, so it becomes an outer main check
console.log(__rolldown_is_main__);
