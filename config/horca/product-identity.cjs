'use strict'

// The single Horca product configuration module.
//
// Callers receive resolved product identity without learning where Electron,
// packaging, protocol registration, CLI naming, or state-path quirks come from.
// `product.json` is the canonical contract; this module is the only reader.
//
// It is deliberately data-only: no environment branching, no heuristics. A
// generated artifact that must carry an identity value must be verified against
// these values (see scripts/verify-product-identity.mjs).

const product = require('../../product.json')

module.exports = Object.freeze({
  name: product.name,
  packageName: product.packageName,
  appId: product.appId,
  protocol: product.protocol,
  cli: product.cli,
  stateDirectory: product.stateDirectory,
  linuxExecutable: product.linuxExecutable,
  windowsExecutable: product.name
})
