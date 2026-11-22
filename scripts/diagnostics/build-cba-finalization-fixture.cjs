// Bundle production data modules for the isolated Electron memory diagnostic.
const fs = require('node:fs'), path = require('node:path'), webpack = require('webpack');
const root = path.resolve(__dirname, '../..');
async function build(output) {
  fs.mkdirSync(output,{recursive:true});
  const modulePath = file => JSON.stringify(path.join(root,'src',file));
  fs.writeFileSync(path.join(output,'entry.js'), `
import * as storage from ${modulePath('features/code-architecture-assurance/codeArchitectureStorage.js')};
import * as chunks from ${modulePath('features/code-architecture-storage/chunkedRecord.js')};
import {enrichCodeEvidenceRows} from ${modulePath('features/code-architecture-context/codeEvidenceEnrichment.js')};
import {readAnalysisSourceRecord} from ${modulePath('features/code-architecture-context/analysisSourceStorage.js')};
import {codeSourceIndexKey,codeSourceProvenance} from ${modulePath('features/code-architecture-context/codeSourceIdentity.js')};
import {collectFunctionalSourceFunctions} from ${modulePath('features/code-architecture-context/functionalModel.js')};
window.cbaMemoryAPI={...storage,...chunks,enrichCodeEvidenceRows,readAnalysisSourceRecord,codeSourceIndexKey,codeSourceProvenance,collectFunctionalSourceFunctions};
`);
  const compiler = webpack({mode:'production', entry:path.join(output,'entry.js'),
    output:{path:output, filename:'cba-finalization.seed.js',publicPath:'xhandle://app/',chunkFilename:'[contenthash].worker.js'},
    optimization:{minimize:false},devtool:false,
    plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'production',PUBLIC_URL:''})})],
    resolve:{modules:[path.join(root,'node_modules'),'node_modules'],extensions:['.js','.jsx']},
  });
  await new Promise((resolve,reject) => compiler.run((error,stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({all:false,errors:true}))) : resolve())));
  return path.join(output,'cba-finalization.seed.js');
}
module.exports = {build};
if (require.main === module) build(path.resolve(process.argv[2])).then(console.log).catch(error=>{console.error(error);process.exitCode=1;});
