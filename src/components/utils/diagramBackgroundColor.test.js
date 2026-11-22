import {diagramBackgroundColor} from './diagramBackgroundColor';
import {captureFullDiagram} from './captureFullDiagram';
import {toPng} from 'html-to-image';
jest.mock('html-to-image',()=>({toPng:jest.fn(async()=> 'data:image/png;fixture')}));
test('capture inherits the actual dark backdrop and composites translucent group paint',()=>{
 const parent=document.createElement('div'),child=document.createElement('div');parent.style.backgroundColor='#0d1420';child.style.backgroundColor='rgba(100, 120, 140, 0.5)';parent.append(child);document.body.append(parent);
 expect(diagramBackgroundColor(child)).toBe('rgb(57, 70, 86)');expect(parent.style.backgroundColor).toBe('rgb(13, 20, 32)');parent.remove();
});
test('full scene raster uses the dark canvas without changing document-export themes or live paint',async()=>{
 const flow=document.createElement('div');flow.style.backgroundColor='#0d1420';flow.innerHTML='<div class="react-flow__viewport"><div class="react-flow__node">Evidence</div></div>';document.body.append(flow);
 for(const el of flow.querySelectorAll('*'))el.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,width:100,height:40,right:100,bottom:40});const before=flow.outerHTML;
 await captureFullDiagram(flow,1);expect(toPng.mock.calls[0][1].backgroundColor).toBe('rgb(13, 20, 32)');expect(flow.outerHTML).toBe(before);flow.remove();
});
test('unpainted light scenes keep an opaque white backdrop',()=>expect(diagramBackgroundColor(document.createElement('div'))).toBe('rgb(255, 255, 255)'));
