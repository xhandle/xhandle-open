// Runs inside the browser. Canvas pixels, images and gradients need visual review.
function auditTheme() {
 const parse=value=>{const n=String(value).match(/[\d.]+/g)?.map(Number);return n?.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0];};
 const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [...a.slice(0,3).map((n,i)=>(n*a[3]+b[i]*b[3]*(1-a[3]))/(alpha||1)),alpha];};
 const luminance=rgb=>rgb.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 const failures=[],brightSurfaces=[],brightAccents=[],accentSamples=[],pairs=new Map(),seen=new Set();let checked=0;
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,el=node.parentElement;
  if(!node.textContent.trim()||!el||seen.has(el)||el.closest('script,style,svg,[aria-hidden=true],[disabled],[aria-disabled=true],.sr-only'))continue;
  if(!/[\p{L}\p{N}]/u.test(node.textContent)&&/\p{Extended_Pictographic}/u.test(node.textContent))continue;
  const style=getComputedStyle(el);if(style.visibility!=='visible'||style.display==='none')continue;
  const range=document.createRange();range.selectNodeContents(node);const rect=range.getBoundingClientRect();
  if(rect.width<2||rect.height<2||rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)continue;
  const x=Math.max(1,Math.min(innerWidth-2,rect.x+rect.width/2)),y=Math.max(1,Math.min(innerHeight-2,rect.y+rect.height/2));
  const top=document.elementFromPoint(x,y);if(top&&!el.contains(top)&&!top.contains(el))continue;
  seen.add(el);const ancestors=[];let opacity=1;
  for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);opacity*=Number(s.opacity);ancestors.unshift(parse(s.backgroundColor));}
  if(opacity<.01)continue;
  let background=[255,255,255,1];for(const color of ancestors)background=over(color,background);
  const foreground=parse(style.color);foreground[3]*=opacity;
  const ratio=contrast(over(foreground,background),background),large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700),minimum=large||!/[\p{L}\p{N}]/u.test(node.textContent)?3:4.5;
  checked++;const sample={text:node.textContent.trim().slice(0,100),tag:el.tagName,classes:String(el.className).slice(0,160),color:style.color,background:background.slice(0,3).map(Math.round),ratio:Math.round(ratio*100)/100,minimum};
  const key=style.color+'|'+sample.background.join(',');pairs.set(key,(pairs.get(key)||0)+1);if(ratio<minimum)failures.push(sample);
 }
 // Inputs and placeholders do not have DOM text nodes, but still need readable text.
 for(const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]):not([type=file]),textarea,select')) {
  if(el.closest('[disabled],[aria-disabled=true]'))continue;
  const r=el.getBoundingClientRect(),style=getComputedStyle(el);if(r.width<2||r.height<2||r.bottom<=0||r.top>=innerHeight||style.visibility!=='visible')continue;
  const top=document.elementFromPoint(Math.max(1,Math.min(innerWidth-2,r.x+r.width/2)),Math.max(1,Math.min(innerHeight-2,r.y+r.height/2)));if(top&&!el.contains(top))continue;
  const text=el.value||el.placeholder;if(!text)continue;const foreground=parse(el.value?style.color:getComputedStyle(el,'::placeholder').color);
  const ancestors=[];let opacity=1;for(let e=el;e;e=e.parentElement){const st=getComputedStyle(e);opacity*=Number(st.opacity);ancestors.unshift(parse(st.backgroundColor));}let background=[255,255,255,1];for(const color of ancestors)background=over(color,background);foreground[3]*=opacity;
  const ratio=contrast(over(foreground,background),background);checked++;if(ratio<4.5)failures.push({text:String(text).slice(0,100),tag:el.tagName,classes:String(el.className).slice(0,160),color:style.color,background:background.slice(0,3).map(Math.round),ratio:Math.round(ratio*100)/100,minimum:4.5,field:true});
 }
 if(document.documentElement.classList.contains('dark'))for(const el of document.body.querySelectorAll('div,section,main,aside,header,nav,table,tr,th,td,textarea,input,select')){
  const r=el.getBoundingClientRect();if(r.width*r.height<12000||r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth||el.closest('[data-theme-preserve-color],svg,.react-flow__node'))continue;
  const s=getComputedStyle(el),bg=parse(s.backgroundColor);if(bg[3]<.9||luminance(bg)<.65||s.visibility!=='visible')continue;
  const x=Math.max(1,Math.min(innerWidth-2,r.x+r.width/2)),y=Math.max(1,Math.min(innerHeight-2,r.y+r.height/2)),top=document.elementFromPoint(x,y);if(top&&!el.contains(top))continue;
  brightSurfaces.push({tag:el.tagName,classes:String(el.className).slice(0,140),background:s.backgroundColor,area:Math.round(r.width*r.height)});
 }
 // Inspect theme-controlled actions only; authored diagram and color-picker paint
 // must retain its meaning. Include hover states when the harness exposes them.
 if(document.documentElement.classList.contains('dark'))for(const el of document.querySelectorAll('button,[role=button],.collaborator-user-bubble')) {
  const classes=String(el.className),inline=el.getAttribute('style')||'';
  if(!el.classList.contains('collaborator-user-bubble')&&!/(?:^|[\s:])bg-(?:blue|sky|cyan|indigo|violet|purple|fuchsia)-(?:500|600|700|800|900|950)(?:\/\d+)?(?:\s|$)/.test(classes)&&!/(?:--action|--brand-purple-action)/.test(inline)&&!el.matches('.artifact-actions .primary,.artifact-form .primary,.trace-editor .primary,.trace-profile-form .primary'))continue;
  const rect=el.getBoundingClientRect(),style=getComputedStyle(el),bg=parse(style.backgroundColor);
  if(rect.width<2||rect.height<2||rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth||style.visibility!=='visible'||bg[3]<.5)continue;
  const top=document.elementFromPoint(Math.max(1,Math.min(innerWidth-2,rect.x+rect.width/2)),Math.max(1,Math.min(innerHeight-2,rect.y+rect.height/2)));
  if(top&&!el.contains(top))continue;
  const chroma=(Math.max(...bg.slice(0,3))-Math.min(...bg.slice(0,3)))/255;
  const sample={text:el.textContent.trim().slice(0,80),classes:classes.slice(0,160),background:style.backgroundColor,chroma:Math.round(chroma*1000)/1000,luminance:Math.round(luminance(bg)*1000)/1000};
  accentSamples.push(sample);if(chroma>.30||(chroma>.08&&luminance(bg)>.16))brightAccents.push(sample);
 }
 return {brightAccents,accentSamples,dark:document.documentElement.classList.contains('dark'),checked,failures,brightSurfaces,pairs:[...pairs],limitations:'Visible HTML text and solid ancestor surfaces; SVG/canvas paint, images, gradients and PDF contents require separate checks.'};
}
module.exports={auditTheme};
