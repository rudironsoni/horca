'use strict'

// Why lazy: Linux/Windows CI never ships libghostty, and macOS installs may
// skip the addon until Electron rebuild. Requiring at load would fail tests.
let addon = null
let loadAttempted = false

function getAddon() {
  if (loadAttempted) {
    return addon
  }
  loadAttempted = true
  try {
    addon = require('./build/Release/orca_ghostty_surface.node')
  } catch {
    addon = null
  }
  return addon
}

function isAvailable() {
  const loaded = getAddon()
  return loaded?.isAvailable?.() === true
}

function requireAddon() {
  const loaded = getAddon()
  if (!loaded) {
    throw new Error('native Ghostty GPU surface addon is not built')
  }
  return loaded
}

function create(nativeWindowHandle, bounds) {
  return requireAddon().create(nativeWindowHandle, bounds)
}

function destroy(surface) {
  getAddon()?.destroy?.(surface)
}

function setBounds(surface, bounds) {
  requireAddon().setBounds(surface, bounds)
}

function setOcclusion(surface, occluded) {
  requireAddon().setOcclusion(surface, occluded)
}

function setVisible(surface, visible) {
  requireAddon().setVisible(surface, visible)
}

function write(surface, data) {
  requireAddon().write(surface, data)
}

function resize(surface, cols, rows) {
  requireAddon().resize(surface, cols, rows)
}

module.exports = {
  isAvailable,
  create,
  destroy,
  setBounds,
  setOcclusion,
  setVisible,
  write,
  resize
}
