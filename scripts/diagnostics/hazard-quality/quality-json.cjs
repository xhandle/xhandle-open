// Recover a single structured value from harmless response framing. Never
// choose between two possible answers or alter the returned judgment.
function parseQualityJson(value) {
  const text=String(value).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(text);}catch{}
  const candidates=[];
  for(let start=0;start<text.length;start++) {
    if(!'[{'.includes(text[start]))continue;
    const stack=[];let quoted=false,escaped=false,end=start;
    for(;end<text.length;end++) {
      const char=text[end];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(char==='[' || char==='{')stack.push(char);
      else if(char===']' || char==='}') {
        if(stack.pop()!==(char===']'?'[':'{'))break;
        if(!stack.length) {try{candidates.push(JSON.parse(text.slice(start,end+1)));}catch{}break;}
      }
    }
    if(stack.length)throw new SyntaxError('Truncated structured response.');
    start=end;
  }
  if(candidates.length!==1)throw new SyntaxError('Expected exactly one unambiguous JSON object or array; received '+candidates.length+'.');
  return candidates[0];
}
module.exports={parseQualityJson};
