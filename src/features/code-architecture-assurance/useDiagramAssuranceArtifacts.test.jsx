import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import useDiagramAssuranceArtifacts from './useDiagramAssuranceArtifacts';
import {loadArtifactRowsAsync} from './artifactUtils';
jest.mock('./artifactUtils',()=>({loadArtifactRowsAsync:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,host;
function Fixture({projectId,repoId}) { const rows=useDiagramAssuranceArtifacts(projectId,repoId);return <div>{JSON.stringify(rows)}</div>; }
beforeEach(()=>{jest.clearAllMocks();host=document.createElement('div');root=createRoot(host);});
afterEach(()=>act(()=>root.unmount()));
test('loads durable artifacts and refreshes after scoped updates',async()=>{
 loadArtifactRowsAsync.mockImplementation(async(kind)=>[{id:kind+'-saved'}]);
 await act(async()=>root.render(<Fixture projectId="p" repoId="r"/>));
 expect(host.textContent).toContain('software-requirements-saved');expect(loadArtifactRowsAsync).toHaveBeenCalledTimes(4);
 await act(async()=>window.dispatchEvent(new CustomEvent('xhandle:code-architecture-assurance:changed',{detail:{projectId:'other'}})));
 expect(loadArtifactRowsAsync).toHaveBeenCalledTimes(4);
 loadArtifactRowsAsync.mockResolvedValue([{id:'updated'}]);
 await act(async()=>window.dispatchEvent(new CustomEvent('xhandle:code-architecture-assurance:changed',{detail:{projectId:'p',repoId:'r'}})));
 expect(host.textContent).toContain('updated');
});
test('late previous-project reads cannot leak into the active project',async()=>{
 const releases=[];
 loadArtifactRowsAsync.mockImplementation((kind,p)=>p==='old'?new Promise(resolve=>releases.push(resolve)):Promise.resolve([{id:'current'}]));
 await act(async()=>root.render(<Fixture projectId="old" repoId="r"/>));
 await act(async()=>root.render(<Fixture projectId="new" repoId="r"/>));
 await act(async()=>releases.forEach(resolve=>resolve([{id:'wrong project'}])));
 expect(host.textContent).toContain('current');expect(host.textContent).not.toContain('wrong project');
});
