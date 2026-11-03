// Re-analyze existing measurements. No Electron processes or provider calls.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {summarizeComparison}=require('./comparisonSummary.cjs');
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('Usage: node recalculate-desktop-diagnostics.cjs CASE_DIRECTORY OUTPUT_JSON');
const originalPath=path.resolve(directory,'summary.json'),casesPath=path.resolve(directory,'cases.json');
if([originalPath,casesPath].includes(path.resolve(output)))throw Error('Preserve original evidence; choose a new output file');
const originalBytes=fs.readFileSync(originalPath),caseBytes=fs.readFileSync(casesPath),original=JSON.parse(originalBytes);
const summary=summarizeComparison(JSON.parse(caseBytes));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
summary.recalculation={method:'Conventional median: mean of the two middle observations for even groups',originalCasesSha256:hash(caseBytes),originalSummarySha256:hash(originalBytes),originalCollectionSourceUnchanged:original.sourceUnchanged,collectedNewMeasurements:false,note:'Original source fingerprints remain in the original summary. These cases predate the latest diagnostic fixes.'};
fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({output,medians:summary.medians,gates:summary.gates}));
