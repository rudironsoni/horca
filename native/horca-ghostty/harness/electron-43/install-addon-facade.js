'use strict';
/**
 * TEST-ONLY. Returns a plain JS object that delegates to the real N-API
 * addon. Wraps machChannelReceiveSurface and surfaceRelease so tests can
 * count native receive/release without Proxy or production changes.
 */
const addonApi = require('../../adopted/electron-ghostty/addon');
const native = addonApi.load();

const stats = {
  machReceives: [],
  receiveSeqs: [],
  machReleases: 0,
};

const facade = Object.create(null);
for (const key of Object.getOwnPropertyNames(native)) {
  const val = native[key];
  if (typeof val === 'function') facade[key] = val.bind(native);
  else facade[key] = val;
}

facade.machChannelReceiveSurface = function machChannelReceiveSurfaceWrapped(...args) {
  const r = native.machChannelReceiveSurface(...args);
  stats.machReceives.push(r ? { seq: r.seq } : null);
  if (r && typeof r.seq === 'number') stats.receiveSeqs.push(r.seq);
  return r;
};

facade.surfaceRelease = function surfaceReleaseWrapped(handle) {
  stats.machReleases += 1;
  return native.surfaceRelease(handle);
};

addonApi.load = function loadFacade() {
  return facade;
};

function reset() {
  stats.machReceives.length = 0;
  stats.receiveSeqs.length = 0;
  stats.machReleases = 0;
}

module.exports = { stats, facade, native, reset };
