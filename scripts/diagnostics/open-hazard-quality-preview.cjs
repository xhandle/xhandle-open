#!/usr/bin/env node
// Local observer only: no credential read and no external AI request.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {launchQualityPreview}=require('./hazard-quality/electron-preview.cjs');
const root=path.resolve(__dirname,'../..');
const value=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-quality-preview-only-'));
  fs.writeFileSync(path.join(directory,'runner.pid'),String(process.pid));
  const preview=await launchQualityPreview({root,directory,
    desktop:value('--desktop') || path.resolve(root,'../xhandle-desktop'),
    electron:value('--electron') || path.resolve(root,'../xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    playwright:value('--playwright') || require.resolve('playwright-core'),
    fixture:JSON.parse(fs.readFileSync(path.join(__dirname,'hazard-quality/haulage-project.json'),'utf8'))});
  await preview.update({phase:'Ready · awaiting provider approval',message:'Local preview is open. Real AI calls have not started.',cap:25,spent:0,rowKind:'steps',
    rows:[{id:'1',title:'Functional abstraction',text:'Fresh production abstraction and hierarchy prompts'},
      {id:'2',title:'STPA analysis',text:'Real applicability and hazard-generation prompts'},
      {id:'3',title:'Quality review',text:'Source-grounded scoring, target ≥9/10; no critical contradictions'},
      {id:'4',title:'Regression checks',text:'Offline test gate, trace coverage and saved-result comparison'}]});
  await preview.screenshot(path.join(directory,'preview.png'));
  console.log(JSON.stringify({preview:directory,externalRequests:0,credentialRead:false}));
  process.once('SIGTERM',()=>preview.close());process.once('SIGINT',()=>preview.close());
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
