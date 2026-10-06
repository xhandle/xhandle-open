import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ArchitectureRunRecovery from './ArchitectureRunRecovery';
import {readLatestArchitectureCheckpoint} from './codeArchitectureStorage';
jest.mock('./codeArchitectureStorage', () => ({readLatestArchitectureCheckpoint:jest.fn(),readArchitectureCheckpoint:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {host=document.createElement('div');root=createRoot(host);readLatestArchitectureCheckpoint.mockReset();});
afterEach(() => {act(()=>root.unmount());});
const checkpoint = {key:'fixture',completed:2,total:3,failedFiles:[{path:'broken.py',message:'Output limit'}],rowCount:1,rows:[{from:'caller',action:'Check',to:'validator'}]};
test('shows saved progress without publishing or automatically retrying and keeps retry errors visible', async () => {
 readLatestArchitectureCheckpoint.mockResolvedValue(checkpoint);
 const resume=jest.fn().mockRejectedValue(new Error('Reconnect the local folder.'));
 await act(async()=>root.render(<ArchitectureRunRecovery scope="cba:test" onResume={resume}/>));
 expect(host.textContent).toContain('2 of 3 files completed');
 expect(host.textContent).toContain('No completed architecture has been published');
 expect(host.textContent).toContain('broken.py: Output limit');
 expect(host.textContent).toContain('caller');
 expect(resume).not.toHaveBeenCalled();
 expect([...host.querySelectorAll('details')].every(element=>!element.open)).toBe(true);
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry incomplete analysis').click());
 expect(resume).toHaveBeenCalledTimes(1);
 expect(host.querySelector('[role="alert"]').textContent).toContain('Reconnect');
});
test('retains the completed architecture message and hides obsolete progress after successful retry', async () => {
 readLatestArchitectureCheckpoint.mockResolvedValueOnce(checkpoint).mockResolvedValue(null);
 await act(async()=>root.render(<ArchitectureRunRecovery scope="cba:test" hasPublishedRows onResume={async()=>{}}/>));
 expect(host.textContent).toContain('last completed architecture remains available');
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry incomplete analysis').click());
 expect(host.textContent).toBe('');
});
test('does not read recovery data during a running analysis', async () => {
 await act(async()=>root.render(<ArchitectureRunRecovery scope="cba:test" loading/>));
 expect(readLatestArchitectureCheckpoint).not.toHaveBeenCalled();
 expect(host.textContent).toBe('');
});

test('offers save-only recovery and identifies memory-only results', async () => {
 readLatestArchitectureCheckpoint.mockResolvedValue({...checkpoint,publicationReady:true,durable:false,failedFiles:[]});
 const resume=jest.fn();
 await act(async()=>root.render(<ArchitectureRunRecovery scope="cba:test" onResume={resume}/>));
 expect(host.textContent).toContain('Analysis complete — save pending');
 expect(host.textContent).toContain('only in memory');
 expect(host.textContent).not.toContain('File failure details');
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry save').click());
 expect(resume).toHaveBeenCalledWith(expect.objectContaining({publicationReady:true,key:'fixture'}));
});
