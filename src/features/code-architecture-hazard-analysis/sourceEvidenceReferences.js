// Reference only byte-identical code already supplied in full. Preserve clipped,
// unmatched and different-revision evidence without alteration.
export function sourceEvidenceReferences(sources,sharedSource=[]) {
  const files=new Map(sharedSource.map(file=>[file.filePath,file.content]));
  return sources.map(source=>{
    const code=source.evidence?.code;
    if(!code || typeof code!=='object' || Array.isArray(code))return source;
    return {...source,evidence:{...source.evidence,code:{...code,
      files:code.files?.map(file=>{
        if(!file || typeof file.content!=='string' || files.get(file.filePath)!==file.content)return file;
        const {content,...location}=file;
        return {...location,contentRef:'Shared unmodified source corpus: '+file.filePath};
      })}}};
  });
}
