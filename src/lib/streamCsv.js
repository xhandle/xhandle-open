// Decode bounded Blob slices and retain only the current record. Quoted fields
// may cross slices, contain newlines, and escape quotes as doubled quotes.
export async function* streamCsv(file, {signal, onProgress=()=>{}, chunkSize=65536, maxRowChars=4*1024*1024}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('CSV import canceled.','AbortError');};
  const decoder=new TextDecoder();
  let parts=[],length=0,row=[],rowLength=0,quoted=false,afterQuote=false,skipLF=false,first=true;
  const append=value=>{length+=value.length;rowLength+=value.length;if(rowLength>maxRowChars)throw Error('A CSV row exceeds the safe 8 MiB decoded-row limit. Existing results were not changed.');parts.push(value);if(parts.length>1024)parts=[parts.join('')];};
  const field=()=>{row.push(parts.join(''));parts=[];length=0;if(row.length>2048)throw Error('The CSV has too many columns.');};
  const finish=()=>{field();const result=row;row=[];rowLength=0;return result;};
  for(let offset=0;offset<file.size;offset+=chunkSize){
    check();let text=decoder.decode(await file.slice(offset,offset+chunkSize).arrayBuffer(),{stream:offset+chunkSize<file.size});
    if(first){text=text.replace(/^\uFEFF/,'');first=false;}
    let start=0;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(skipLF){skipLF=false;if(c==='\n'){start=i+1;continue;}}
      if(quoted){
        if(c==='"'){append(text.slice(start,i));quoted=false;afterQuote=true;start=i+1;}
        continue;
      }
      if(afterQuote){
        if(c==='"'){append('"');quoted=true;afterQuote=false;start=i+1;continue;}
        if(c!==',' && c!=='\r' && c!=='\n')throw Error('Invalid CSV: unexpected text after a closing quote.');
        afterQuote=false;
      }else if(c==='"'){
        if(length || i>start)throw Error('Invalid CSV: a quote must start a field.');
        quoted=true;start=i+1;continue;
      }
      if(c===',' || c==='\r' || c==='\n'){
        append(text.slice(start,i));start=i+1;
        if(c===',')field();else{yield finish();if(c==='\r')skipLF=true;}
      }
    }
    append(text.slice(start));check();onProgress({completed:Math.min(offset+chunkSize,file.size),total:file.size});
  }
  check();if(quoted)throw Error('Invalid CSV: an unfinished quoted field.');
  if((parts.length && length) || row.length || afterQuote)yield finish();
}
