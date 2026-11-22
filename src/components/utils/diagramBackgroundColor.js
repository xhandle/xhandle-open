// Raster captures must use the same backdrop as the live graph. Forcing white
// behind dark labels on translucent groups makes exported evidence unreadable.
export function diagramBackgroundColor(element) {
  const colors=[];
  for(let node=element;node;node=node.parentElement){
    const value=node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor;
    const channels=value.match(/[\d.]+/g)?.map(Number);
    if(channels?.length>=3)colors.unshift([...channels.slice(0,3),channels[3]??1]);
  }
  let backdrop=[255,255,255];
  for(const [r,g,b,alpha]of colors)backdrop=[r,g,b].map((channel,index)=>channel*alpha+backdrop[index]*(1-alpha));
  return `rgb(${backdrop.map(Math.round).join(', ')})`;
}
