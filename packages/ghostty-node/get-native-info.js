'use strict'

module.exports = function getNativeInfo() {
  return {
    platform: process.platform,
    arch: process.arch
  }
}
