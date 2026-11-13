import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Evidence from './SafetyCaseAutomaticEvidence';
import {updateSafetyCaseAutomation} from './safetyCaseStore';
jest.mock('./safetyCaseStore',()=>({updateSafetyCaseAutomation:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
beforeEach(()=>{host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const node={id:'n',title:'My argument',linkedArtifactIds:['manual'],metadata:{evidenceRole:'verification'}};
const value={id:'c',projectId:'p',nodes:[node],evidenceAutomation:{projectId:'p',complete:true,artifacts:[{id:'t',projectId:'p',title:'Recorded test',outcome:'passed',revision:'r'}],allocations:[{nodeId:'n',artifactId:'t',state:'changed',revision:'r',rationale:'Explicit requirement link'}]}};

test('shows evidence state, rationale, and manual controls without rewriting authored content',()=>{
 const change=jest.fn();act(()=>root.render(<Evidence safetyCase={value} node={node} onNodeChange={change}/>));
 expect(host.textContent).toContain('Recorded test');expect(host.textContent).toContain('passed · changed');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Exclude automatic link').click());
 expect(change).toHaveBeenCalledWith(expect.objectContaining({title:'My argument',linkedArtifactIds:['manual'],metadata:expect.objectContaining({excludedAutomaticEvidenceIds:['t']})}),{persist:true});
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Acknowledge current revision').click());
 expect(change.mock.calls[1][0].metadata.reviewedAutomaticEvidenceRevisions).toEqual({t:'r'});
});
test('displays source failures and keeps pause persistence errors visible',async()=>{
 updateSafetyCaseAutomation.mockRejectedValueOnce(Error('Unable to commit'));
 act(()=>root.render(<Evidence safetyCase={{...value,evidenceAutomation:{complete:false,errors:['Unreadable requirements']}}}/>));
 expect(host.textContent).toContain('Evidence collection incomplete');expect(host.textContent).toContain('Unreadable requirements');
 await act(async()=>host.querySelector('button').click());expect(host.textContent).toContain('Unable to commit');
});
