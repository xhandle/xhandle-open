// Validate the streamed grammar without building strings, binary values or run objects.
// Only container state, short root-property names and identity offsets are retained.
export function createHazardTokenValidator(expected) {
  const stack=[],identities=new Set();let complete=false;
  const bad=()=>{throw new Error('Invalid streamed hazard record or mismatched hazard identity.');};
  const identityKeys=['id','projectId','repoId'];
  const accept=(type,value)=>{
    if(!stack.length){if(complete || type!=='object')bad();complete=true;return;}
    const parent=stack[stack.length-1];
    if(['string','binary'].includes(parent.type))bad();
    if(['object','map'].includes(parent.type)){
      if(!parent.hasKey){if(parent.type==='object' && type!=='string')bad();parent.key=value;parent.hasKey=true;}
      else {
        if(stack.length===1 && parent.type==='object' && identityKeys.includes(parent.key)){
          if(identities.has(parent.key))bad();identities.add(parent.key);
          if(type==='checkedIdentity'){if(value!==parent.key)bad();}
          else if(!['value','undefined'].includes(type) || !Object.is(value,expected[parent.key]))bad();
        }
        parent.hasKey=false;parent.key=undefined;
      }
    }
  };
  return {
    add(token){
      if(complete || !Array.isArray(token) || typeof token[0]!=='string')bad();
      const [type,value,mime]=token,top=stack[stack.length-1];
      if(type==='text'){
        if(top?.type!=='string' || typeof value!=='string')bad();
        if(top.identity){if(typeof expected[top.identity]!=='string' || expected[top.identity].slice(top.offset,top.offset+value.length)!==value)bad();top.offset+=value.length;}
        if(top.key!==undefined)top.key=(top.key+value).slice(0,32);
        return;
      }
      if(type==='bytes'){
        if(top?.type!=='binary' || !Array.isArray(value) || value.some(v=>!Number.isInteger(v)||v<0||v>255))bad();
        top.bytes+=value.length;return;
      }
      if(type==='end'){
        if(!top || top.hasKey)bad();stack.pop();
        if(top.type==='string'){
          if(top.identity){if(top.offset!==expected[top.identity]?.length)bad();accept('checkedIdentity',top.identity);}
          else accept('string',top.key);
        }else if(top.type==='binary'){
          if(top.bytes%top.width)bad();accept('binary');
        }else accept(top.type);
        return;
      }
      if(['array','object','map','set','string','binary'].includes(type)){
        if(top && ['string','binary'].includes(top.type))bad();
        const frame={type,hasKey:false};
        if(type==='string'){
          if(stack.length===1 && top.type==='object'){
            if(!top.hasKey)frame.key='';
            else if(identityKeys.includes(top.key)){frame.identity=top.key;frame.offset=0;}
          }
        }
        if(type==='binary'){
          const widths={Blob:1,ArrayBuffer:1,DataView:1,Uint8Array:1,Uint8ClampedArray:1,Int8Array:1,Uint16Array:2,Int16Array:2,Uint32Array:4,Int32Array:4,Float32Array:4,Float64Array:8};
          if(!Object.hasOwn(widths,value) || typeof mime!=='string')bad();frame.width=widths[value];frame.bytes=0;
        }
        stack.push(frame);return;
      }
      if(type==='value'){if(value!==null && typeof value!=='boolean' && !(typeof value==='number'&&Number.isFinite(value)))bad();accept(type,value);}
      else if(type==='undefined')accept(type,undefined);
      else if(type==='bigint'){if(typeof value!=='string'||! /^-?\d+$/.test(value))bad();accept(type);}
      else if(type==='date'){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))bad();accept(type);}
      else if(type==='number' && ['NaN','Infinity','-Infinity'].includes(value))accept(type);
      else bad();
    },
    finish(){
      if(!complete || stack.length || identityKeys.some(key=>expected[key]!==undefined && !identities.has(key)))bad();
    },
  };
}
