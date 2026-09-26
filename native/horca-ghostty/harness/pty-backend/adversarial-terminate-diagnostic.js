'use strict';

const Module = require('module');
const path = require('path');

const diag = process.env.HORCA_TERMINATE_DIAG;
if (!diag) {
  process.stderr.write('HORCA_TERMINATE_DIAG is unset\n');
  process.exit(2);
}

const addon = new Module(diag);
addon.filename = diag;
addon.paths = Module._nodeModulePaths(path.dirname(diag));
process.dlopen(addon, diag);
require('./production-shutdown.js');
