'use strict';
/**
 * Loads the raw N-API binding (see src/addon.c for the full surface).
 * Most consumers want index.js (GhosttyTerminal); this low-level entry
 * exists for tests and embedders that manage the loop themselves.
 * Loading is lazy so requiring the package on an unsupported platform
 * doesn't throw until the addon is actually needed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADDON_PATH = path.join(
  __dirname, 'build', 'Release', 'ghostty_renderer.node');
const SELECTION_PATH = path.join(
  __dirname, 'build', 'Release', 'ghostty_selection.node');

let addon = null;

function load() {
  if (!addon) {
    if (process.platform !== 'darwin') {
      throw new Error(
        'electron-ghostty: headless rendering is macOS-only for now ' +
        '(Metal + IOSurface); Linux needs the EGL/GBM presenter');
    }
    const mod = { exports: {} };
    const flags = os.constants.dlopen.RTLD_NOW | os.constants.dlopen.RTLD_GLOBAL;
    process.dlopen(mod, ADDON_PATH, flags);
    if (typeof mod.exports.readSelection !== 'function') {
      if (!fs.existsSync(SELECTION_PATH)) {
        throw new Error('electron-ghostty: readSelection is not linked');
      }
      const selection = { exports: {} };
      process.dlopen(selection, SELECTION_PATH, os.constants.dlopen.RTLD_NOW);
      mod.exports.readSelection = selection.exports.readSelection;
    }
    addon = mod.exports;
  }
  return addon;
}

function available() {
  return process.platform === 'darwin' && require('fs').existsSync(ADDON_PATH);
}

module.exports = { load, available, ADDON_PATH };
