// Builds seeders only; the application measured by the GUI harness is unmodified.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const webpack = require('webpack');
const root = path.resolve(__dirname, '../..');
if (!process.argv[2]) throw new Error('Usage: node scripts/diagnostics/build-desktop-gui-audit-fixtures.cjs /tmp/fixtures');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, 'build-desktop-performance-fixture.cjs'), path.join(output, 'cba')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PERF_SOURCE_ROOT: root },
});
const compiler = webpack({
  mode: 'production',
  entry: path.join(__dirname, 'fixtures/desktop-gui-responsiveness.js'),
  output: { publicPath: "xhandle://app/", chunkFilename: "[contenthash].worker.js", path: output, filename: 'extra.seed.js' },
  devtool: false,
  optimization: { minimize: false },
  module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: {
    loader: require.resolve('babel-loader'), options: { presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]] },
  } }] },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'production', PUBLIC_URL: '' }) })],
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'], extensions: ['.js', '.jsx', '.ts', '.tsx'] },
});
compiler.run((error, stats) => compiler.close(() => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; }
  else console.log(path.join(output, 'extra.seed.js'));
}));
