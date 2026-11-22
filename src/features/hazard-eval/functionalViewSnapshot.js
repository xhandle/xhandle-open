import {parseCodeArchitectureCsv} from '../code-architecture-context/codeArchitectureCsvImport';
import {restoreFunctionalCsvSnapshot,functionalModelIsReady} from '../code-architecture-context/functionalModel';
import {toCsvText} from '../../lib/csv';

// Accept a rendered Functional export without losing its stable identifiers.
export function functionalViewCsv(value) {
  const text=String(value || '').trim();
  if(!text.startsWith('|'))return text;
  const split=line=>{
    const cells=[];let cell='',slashes=0;
    for(const character of line.trim().replace(/^\|/,'').replace(/\|$/,'')) {
      if(character==='|' && slashes%2===0){cells.push(cell.trim());cell='';slashes=0;continue;}
      cell+=character;slashes=character==='\\'?slashes+1:0;
    }
    cells.push(cell.trim());
    return cells.map(value=>value.replace(/\\+(?=[_[\]*`|])/g,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
  };
  const lines=text.split(/\r?\n/).filter(line=>line.trim().startsWith('|'));
  const grid=lines.map(split).filter(cells=>!cells.every(cell=>/^:?-{3,}:?$/.test(cell)));
  if(grid.length<2 || grid.some(cells=>cells.length!==grid[0].length))throw Error('Functional-view table is incomplete or has inconsistent columns.');
  return toCsvText(grid);
}

export function hydrateFunctionalViewSnapshot({text,rawRows}) {
  const imported=parseCodeArchitectureCsv(functionalViewCsv(text));
  const raw=new Map(rawRows.map(row=>[row.traceId,row]));
  const joined=imported.map((row,index)=>{
    if(!row.functionalCsvSnapshot || !row.traceId)throw Error('Use a Functional export with interaction IDs and supporting source trace IDs.');
    const support=row.functionalCsvSnapshot.sourceTraceIds;
    if(!support.length || support.some(id=>!raw.has(id)))throw Error(`Functional interaction ${row.traceId} references missing source evidence.`);
    const evidence=support.map(id=>raw.get(id));
    return {...evidence[0],...row,
      from:row.fromFunction,action:row.controlAction,to:row.toFunction,
      fromDetails:row.fromDetails || row['Function (From) Details'],
      controlActionDetails:row.controlDetails || row['Control Action Details'],
      toDetails:row.toDetails || row['Function (To) Details'],
      fromFile:evidence[0].fromFile,toFile:evidence[0].toFile,rowRef:index+1,
      codeEvidence:{files:evidence.flatMap(value=>value.codeEvidence?.files || []),sourceFunctions:evidence.flatMap(value=>value.codeEvidence?.sourceFunctions || []),rowRefs:evidence.map(value=>value.rowRef)},
      sourceEvidence:{functions:evidence.flatMap(value=>value.sourceEvidence?.functions || []),sourceTraceIds:support},
    };
  });
  const modeled=restoreFunctionalCsvSnapshot(joined);
  if(!functionalModelIsReady(modeled))throw Error('Imported Functional snapshot is not ready.');
  return modeled;
}
