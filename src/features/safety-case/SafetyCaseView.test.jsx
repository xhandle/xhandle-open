import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import View from './SafetyCaseView';
import * as store from './safetyCaseStore';
import {generateLifecycleSafetyCase} from './safetyCaseProjectContext';
let mockInspectorProps;
jest.mock("lucide-react",()=>{const Icon=()=>null;return new Proxy({},{get:()=>Icon});});
jest.mock('./SafetyCaseDiagram',()=>({__esModule:true,default:()=>null,layoutSafetyCase:async value=>value}));
jest.mock('./SafetyCaseInspector',()=>({__esModule:true,default:props=>{mockInspectorProps=props;return null;}}));
jest.mock('./SafetyCaseToolbar',()=>({__esModule:true,default:props=><button onClick={props.onSave}>Save test case</button>}));
jest.mock('./safetyCaseStore',()=>({loadSafetyCases:jest.fn(),loadSafetyCase:jest.fn(),loadSafetyCaseFolders:jest.fn(),getActiveSafetyCaseId:jest.fn(),removeLegacyUnfiledSafetyCaseFolders:jest.fn(),saveSafetyCase:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,host;
beforeEach(()=>{
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 const value={id:'c',projectId:'p',sourceProjectId:'p',name:'Original',nodes:[{id:'n',type:'claim',title:'Original claim',metadata:{}}],edges:[]};
 store.loadSafetyCases.mockResolvedValue([value]);store.loadSafetyCaseFolders.mockReturnValue([]);store.getActiveSafetyCaseId.mockReturnValue(null);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
test('background evidence events update the snapshot while preserving unsaved editor changes',async()=>{
 await act(async()=>root.render(<View activeProjectId="p"/>));
 act(()=>mockInspectorProps.onCaseChange({...mockInspectorProps.safetyCase,name:'Unsaved user name',nodes:[{...mockInspectorProps.safetyCase.nodes[0],title:'Unsaved user claim'}]}));
 const automatic={projectId:'p',complete:true,artifacts:[],allocations:[]};
 act(()=>window.dispatchEvent(new CustomEvent('xhandle:safety-case-updated',{detail:{id:'c',name:'Old saved name',evidenceAutomation:automatic}})));
 expect(mockInspectorProps.safetyCase.name).toBe('Unsaved user name');
 expect(mockInspectorProps.safetyCase.nodes[0].title).toBe('Unsaved user claim');
 expect(mockInspectorProps.safetyCase.evidenceAutomation).toEqual(automatic);
});
test('save failures are shown and the editor draft remains available',async()=>{
 store.saveSafetyCase.mockRejectedValueOnce(Error('Storage quota exceeded'));
 await act(async()=>root.render(<View activeProjectId="p"/>));
 act(()=>mockInspectorProps.onCaseChange({...mockInspectorProps.safetyCase,name:'Keep draft'}));
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Save test case').click());
 expect(host.textContent).toContain('Storage quota exceeded');expect(mockInspectorProps.safetyCase.name).toBe('Keep draft');
});
test('generated arguments have stable evidence roles while empty sources remain unsupported',()=>{
 const generated=generateLifecycleSafetyCase({},'root');
 expect(generated.nodes.find(n=>n.key==='design')).toMatchObject({status:'unsupported',metadata:{evidenceRole:'design'}});
 expect(generated.nodes.find(n=>n.key==='verification')).toMatchObject({status:'unsupported',metadata:{evidenceRole:'verification'}});
});
