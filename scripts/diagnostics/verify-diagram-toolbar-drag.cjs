// Native toolbar drag/drop in isolated storage; never touches user projects.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/verify-diagram-toolbar-drag.cjs
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
(async () => {
  const browser = process.env.VERIFY_BROWSER === 'webkit'
    ? await webkit.launch({headless:true})
    : await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
  try {
    const page = await browser.newPage({viewport:{width:1500,height:1100}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const id='toolbar-drag-fixture', key=`diagram:positions:${id}`;
    await page.addInitScript(({id})=>{
      if(sessionStorage.getItem('toolbar-fixture'))return;
      localStorage.setItem('xhandle.projects',JSON.stringify([{id,name:'Toolbar drag fixture'}]));
      localStorage.setItem('xhandle.sidebarProjectsOpen','true');
      localStorage.setItem('xhandle.projectData',JSON.stringify({[id]:{responseRows:[
        {fromFunction:'A',controlAction:'Command',toFunction:'B',subsystem:''},
      ]}}));
      sessionStorage.setItem('toolbar-fixture','true');
    },{id});
    const settle=()=>page.waitForTimeout(750);
    const open=async()=>{
      await page.getByRole('button',{name:'Toolbar drag fixture',exact:true}).click({timeout:60000});
      await page.waitForFunction(()=>document.querySelector('.react-flow')?.style.visibility==='visible');
      await settle();
    };
    const state=()=>page.evaluate(key=>({
      nodes:[...document.querySelectorAll('.react-flow__node')].map(el=>({id:el.dataset.id,transform:el.style.transform,width:el.style.width,height:el.style.height})),
      positions:JSON.parse(localStorage.getItem(key)||'[]'),
      groups:JSON.parse(localStorage.getItem(key+':groups:v1')||'[]'),
    }),key);
    const placement=(snapshot,id)=>new Map(snapshot.positions).get(id) || snapshot.groups.find(box=>box.id===id);
    const absolute=(snapshot,id)=>{
      const item=placement(snapshot,id); const parent=item.parentId || item.parentNode;
      const origin=parent ? absolute(snapshot,parent) : {x:0,y:0};
      return {x:origin.x+item.position.x,y:origin.y+item.position.y};
    };
    const geometry=snapshot=>snapshot.nodes.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const fit=async()=>{await page.getByTitle('Fit entire diagram to view',{exact:true}).click();await settle();};
    const drop=async(title,point)=>{
      const before=await state();
      const expected=await page.evaluate(point=>{
        const matrix=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
        return {x:(point.x-matrix.e)/matrix.a,y:(point.y-matrix.f)/matrix.d};
      },point);
      await page.getByTitle(title,{exact:true}).dragTo(page.locator('.react-flow'),{targetPosition:point});
      await settle();
      const after=await state();
      const added=after.nodes.filter(node=>!before.nodes.some(old=>old.id===node.id));
      assert.equal(added.length,1,`${title}: expected exactly one new node`);
      const actual=absolute(after,added[0].id);
      assert(Math.abs(actual.x-expected.x)<2 && Math.abs(actual.y-expected.y)<2,`${title}: misplaced drop ${JSON.stringify({actual,expected})}`);
      return added[0].id;
    };
    await page.goto(process.env.XHANDLE_URL||'http://localhost:3000'); await open();
    await page.locator('.react-flow__node[data-id="n:A"]').click();
    const original=await state();
    const addedFunction=await drop('Add node',{x:800,y:110});
    const addedSubsystem=await drop('Group selected nodes',{x:130,y:380});
    const addedSystem=await drop('Add system (group selected functions or subsystems)',{x:650,y:540});
    const addedNote=await drop('Add note',{x:60,y:700});
    let current=await state();
    for(const item of original.nodes)assert.deepEqual(current.nodes.find(node=>node.id===item.id),item,'Previously selected nodes moved');
    for(const id of [addedFunction,addedSubsystem,addedSystem,addedNote])assert(!(placement(current,id).parentId||placement(current,id).parentNode),'Root drop incorrectly adopted previous selection');
    await fit();
    const into=async(id,x,y)=>{
      const canvas=await page.locator('.react-flow').boundingBox();
      const target=await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
      return {x:target.x-canvas.x+x*target.width,y:target.y-canvas.y+y*target.height};
    };
    const nestedSubsystem=await drop('Group selected nodes',await into(addedSystem,.25,.35));
    current=await state();assert.equal(placement(current,nestedSubsystem).parentId || placement(current,nestedSubsystem).parentNode,addedSystem);
    await fit();
    const nestedFunction=await drop('Add node',await into(nestedSubsystem,.2,.35));
    current=await state();assert.equal(placement(current,nestedFunction).parentId,nestedSubsystem);
    const finalGeometry=geometry(current);
    await page.getByTitle('Undo last diagram change',{exact:true}).click();await settle();
    assert(!(await state()).nodes.some(node=>node.id===nestedFunction));
    await page.getByTitle('Redo diagram change',{exact:true}).click();await settle();
    assert.deepEqual(geometry(await state()),finalGeometry);
    // Dropping onto a non-canvas control must not create anything.
    await page.getByTitle('Add node',{exact:true}).dragTo(page.getByRole('button',{name:'README',exact:true}));await settle();
    assert.deepEqual(geometry(await state()),finalGeometry);
    await page.reload();await open();
    assert.deepEqual(geometry(await state()),finalGeometry);
    // Click creation remains usable after both successful and cancelled drags.
    await page.getByTitle('Add node',{exact:true}).click();await settle();
    assert.equal((await state()).nodes.length,current.nodes.length+1);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({browser:process.env.VERIFY_BROWSER||'chromium',nativeDrops:true,projectedPlacement:true,nestedContainers:true,selectionPreserved:true,undoRedo:true,cancelledDrop:true,reload:true,clickCreation:true,errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
