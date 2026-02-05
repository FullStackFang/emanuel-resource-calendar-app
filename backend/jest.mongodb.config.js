/**
 * MongoDB Memory Server configuration
 *
 * This file configures mongodb-memory-server for cross-platform compatibility.
 * Windows ARM64 doesn't have native MongoDB binaries, so we use x64 with emulation.
 */

module.exports = {
  mongodbMemoryServerOptions: {
    binary: {
      // Use a version that has x64 Windows binaries
      version: '6.0.14',
      // Force x64 architecture for Windows ARM64 compatibility
      arch: 'x64',
      // Skip MD5 check for faster startup
      skipMD5: true,
    },
    instance: {
      dbName: 'testdb',
    },
    autoStart: false,
  },
};
