'use strict'

const addon = require('node-gyp-build')(__dirname)

const terminals = new WeakSet()

function isWasmNatural(self) {
  return terminals.has(self)
}

module.exports.isWasmNatural = isWasmNatural
module.exports.createTerminal = function createTerminal(opts) {
  const term = addon.createTerminal(opts || {})
  return term
}
module.exports.getNativeInfo = require('./get-native-info')
