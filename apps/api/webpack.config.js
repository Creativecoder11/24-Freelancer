/**
 * Nest CLI webpack config.
 *
 * The workspace packages (@24f/shared, @24f/db) ship TypeScript sources, so they are
 * bundled into dist/main.js. Every other dependency listed in apps/api/node_modules stays
 * external and is required at runtime (Prisma engines, argon2, sharp are native).
 */
const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = (options) => ({
  ...options,
  devtool: 'source-map',
  externals: [
    nodeExternals({
      modulesDir: path.resolve(__dirname, 'node_modules'),
      allowlist: [/^@24f\//],
    }),
  ],
  output: {
    ...options.output,
    devtoolModuleFilenameTemplate: '[absolute-resource-path]',
  },
});
