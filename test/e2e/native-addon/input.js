function loadAddon() {
  return require('./build/Release/addon.node');
}
console.log('addon loader ready:', typeof loadAddon);
