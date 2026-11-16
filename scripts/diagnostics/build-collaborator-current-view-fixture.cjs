const fs = require('node:fs'), path = require('node:path'), webpack = require('webpack');
process.env.BABEL_ENV ||= 'production';
if (!process.argv[2]) throw Error('Provide an output directory for the synthetic fixture bundle.');
const root = path.resolve(__dirname, '../..'), output = path.resolve(process.argv[2]); fs.mkdirSync(output, { recursive: true });
const compiler = webpack({ mode: 'production', entry: path.join(__dirname, 'fixtures/collaborator-current-view.js'),
  output: { publicPath: "xhandle://app/", chunkFilename: "[contenthash].worker.js", path: output, filename: 'current-view.seed.js' }, devtool: false, optimization: { minimize: false },
  module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [[require.resolve('babel-preset-react-app'), { runtime: 'automatic' }]] } } }] },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'production', PUBLIC_URL: '' }) })],
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'], extensions: ['.js', '.jsx', '.ts', '.tsx'] } });
compiler.run((error, stats) => compiler.close(() => { if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; } else console.log(path.join(output, 'current-view.seed.js')); }));
