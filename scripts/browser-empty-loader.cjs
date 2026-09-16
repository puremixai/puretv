// Keep CommonJS semantics for the lazy require() calls in the storage facade.
module.exports = function browserEmptyLoader() {
  return 'module.exports = {};';
};
