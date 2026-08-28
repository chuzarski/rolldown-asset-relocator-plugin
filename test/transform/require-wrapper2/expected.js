// ==> dep.js (unchanged)
module.exports = 'dep';

// ==> input.js
function reaction (name) {
	const res = __rolldown_native_require__(name);
	res.name = name.split('/').pop();
	return res;
};function reaction$$mod (nres, name) {
	
	res.name = name.split('/').pop();
	return res;
};

const reactions = {
	repository: {
		publicized: reaction$$mod(require('./dep'), './dep')
	}
};
