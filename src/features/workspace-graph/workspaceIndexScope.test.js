import {workspaceIndexScope,scopeWorkspaceIndex,requestedWorkspaceIndexScope} from './workspaceIndexScope';
beforeEach(()=>{localStorage.clear();localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'p',name:'Vehicle'}]));});
test('focused deterministic queries prepare only their authoritative domains',()=>{
 expect(workspaceIndexScope('How many software requirements are there for Vehicle?')).toEqual({steps:['projects','codeArchitectureAssurance'],types:['code_architecture_software_requirement']});
 expect(workspaceIndexScope('Show all system requirements')).toMatchObject({steps:['projects','codeArchitectureAssurance']});
 expect(workspaceIndexScope('Show all reports')).toEqual({steps:['projects','generatedReports','durableProjectAnalysis'],types:['generated_report','safety_issue_report']});
 expect(workspaceIndexScope('Read src/controller.cpp')).toEqual({steps:['projects','codeIndex'],types:['source_file']});
 expect(workspaceIndexScope('List projects')).toEqual({steps:['projects'],types:['project']});
});
test('ambiguous, filtered and cross-domain queries retain full retrieval and user scope',()=>{
 for(const query of ['Review our project','Which requirements have no linked hazards?','Show all software requirements with missing hazards','Compare software requirements and system requirements','How many hazards are there?','Show the selected row'])expect(workspaceIndexScope(query)).toBeNull();
 expect(workspaceIndexScope('Show all software requirements',['risk'])).toBeNull();
 expect(workspaceIndexScope('Read src/controller.cpp',['requirements'])).toBeNull();
 expect(workspaceIndexScope('List projects',['requirements'])).toBeNull();
 localStorage.setItem('xhandle.projects','broken');expect(workspaceIndexScope('List projects')).toBeNull();
});

test('named regular projects exclude CBA stores, while CBA and mixed scopes retain them',()=>{
 localStorage.setItem('xhandle.projects',JSON.stringify([{id:'small',name:'Human percep'}]));
 const areas=['projects','functional','requirements'];const scope=requestedWorkspaceIndexScope(areas);
 const regular=scopeWorkspaceIndex(scope,{query:'summarize the human percep project',projectId:'p',areas});
 expect(regular.projectIds).toEqual(['small']);expect(regular.indexScope.steps).not.toContain('codeArchitecture');expect(regular.indexScope.steps).not.toContain('codeArchitectureAssurance');
 expect(regular.indexScope.types).toContain('functional_decomposition_row');
 const cba=scopeWorkspaceIndex(scope,{query:'summarize Vehicle',projectId:'small',areas});
 expect(cba.projectIds).toEqual(['p']);expect(cba.indexScope.steps).toContain('codeArchitecture');
 const all=scopeWorkspaceIndex(scope,{query:'summarize all projects',projectId:'small',areas});
 expect(all.projectIds).toEqual(expect.arrayContaining(['p','small']));expect(all.indexScope.steps).toContain('codeArchitecture');
});
