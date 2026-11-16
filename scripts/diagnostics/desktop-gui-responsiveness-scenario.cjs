// Broad live-GUI scenario; every mutation is confined to synthetic disposable storage.
module.exports=async({page,cdp,result,measure,scroll,frame,save,gesture})=>{
 page.setDefaultTimeout(20000);
 const test=async(name,action,ready)=>{try{return await measure(name,action,ready,true)}catch(e){result.phases.push({label:'coverage failure '+name,error:e.message,body:(await page.locator('body').innerText()).slice(0,1600)});save();return null}};
 const area=async name=>{await page.getByRole('button',{name,exact:true}).first().click();await frame()};
 await test('Functional project open',()=>page.getByRole('button',{name:'Functional performance fixture',exact:true}).first().click(),()=>page.locator('.react-flow__node').first().waitFor());
 await test('Functional hazard analysis',()=>page.getByRole('tab',{name:'Hazard Analysis',exact:true}).click(),()=>page.locator('tbody td').first().waitFor());
 await scroll('Functional hazard analysis').catch(e=>result.phases.push({label:'scroll unavailable',error:e.message}));
 await test('Functional safety issues',()=>page.getByRole('tab',{name:'Safety Issues & Risk Assessment',exact:true}).click(),()=>page.getByText('Consolidated Safety Issues',{exact:true}).waitFor());
 await area('Design Management');
 await test('Design folder contents',()=>page.getByRole('button',{name:'Performance Designs',exact:true}).first().click(),()=>page.getByRole('button',{name:'Open Audit Safety Requirements',exact:true}).first().waitFor());
 await test('Design requirements open',()=>page.locator('[data-library-id="audit-req"] button').first().click(),()=>page.locator('.requirements-native-views').waitFor());
 for(const [name,selector]of [['Table','.requirements-table-scroll tbody tr'],['Outline','.requirements-outline-scroll'],['Document','.artifact-document-reader']]){
 await test('Design '+name,()=>page.getByRole('button',{name:name+' view',exact:true}).click(),()=>page.locator(selector).first().waitFor());if(name==='Table')await scroll('Design requirements table').catch(()=>{});
 }
 await test('Engineering project overview',()=>page.locator('[data-library-id="audit-engineering"] button').filter({hasText:'Audit Engineering Project'}).first().click(),()=>page.getByRole('button',{name:'Documents',exact:true}).waitFor());
 await test('Design HTL open',()=>page.locator('[data-library-id="audit-htl"] button').first().click(),()=>page.getByRole('table',{name:'Hazard tracking assessments',exact:true}).waitFor());
 await test('HTL hazard filter open',()=>page.getByRole('button',{name:'Filter Hazard',exact:true}).click(),()=>page.getByRole('dialog').waitFor());
 await page.keyboard.press('Escape');
 await test('HTL assessment expansion',()=>page.getByRole('button',{name:/^Expand .*assessments\)$/}).first().click(),()=>page.getByText(/Original assessments 1/).waitFor());
 const sep=page.getByRole('separator',{name:'Resize Hazard column',exact:true});const b=await sep.boundingBox();if(b)await test('HTL resize column',async()=>{await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();for(let i=0;i<20;i++){await page.mouse.move(b.x+3*i,b.y+10);await page.waitForTimeout(16)}await page.mouse.up()},()=>frame());
 await test('Design search open',()=>page.getByRole('button',{name:'Quick search',exact:true}).click(),()=>page.getByRole('combobox',{name:'Search Design Management',exact:true}).waitFor());
 await test('Design search last requirement',()=>page.getByRole('combobox',{name:'Search Design Management',exact:true}).fill('command 1999'),()=>page.getByRole('option').filter({hasText:'Audit Safety Requirements'}).first().waitFor());
 await page.keyboard.press('Escape');
 await area('Reports');result.phases.push({label:'Reports populated body',text:(await page.locator('body').innerText()).slice(0,8000)});save();
 const report=page.getByText('Audit report 0',{exact:true});if(await report.count())await test('Saved report open',()=>report.first().click(),()=>page.getByText('Recorded safety concern 149',{exact:true}).waitFor());
 await area('Safety Case');await page.locator('.react-flow__node').first().waitFor();result.phases.push({label:'Safety Case populated body',text:(await page.locator('body').innerText()).slice(0,8000)});save();
 const safety=page.getByText('Audit Safety Case',{exact:true});if(await safety.count())await test('Safety Case open',()=>safety.first().click(),()=>page.locator('.react-flow__node').first().waitFor());
 if(gesture){await gesture('Safety Case pan','pan').catch(e=>result.phases.push({label:'Safety Case pan unavailable',error:e.message}));}
 await test('System Test document open',()=>area('System Test'),()=>page.getByRole('heading',{name:'Generated Test Cases',exact:true}).waitFor());
 await test('System Test filter last row',()=>page.getByPlaceholder('ID',{exact:true}).fill('TC-999'),()=>page.getByText('Reject stale command 999',{exact:true}).waitFor());
 await page.getByPlaceholder('ID',{exact:true}).fill('');
 await scroll('System Test').catch(()=>{});result.phases.push({label:'System Test body',text:(await page.locator('body').innerText()).slice(0,8000)});save();
 await test('Collaborator large thread open',()=>area('Collaborator'),()=>page.getByText('Recorded safety discussion 79',{exact:false}).first().waitFor());
 const input=page.getByPlaceholder('Ask Collaborator');if(await input.count())await test('Collaborator typing',()=>input.fill('Explain the retained command evidence.'),()=>frame());result.phases.push({label:'Collaborator body',text:(await page.locator('body').innerText()).slice(0,8000)});save();
 await test('Activities open',()=>page.getByRole('button',{name:/^Activities/}).click(),()=>page.getByText('No active activities.',{exact:true}).waitFor());await page.keyboard.press('Escape');
};
