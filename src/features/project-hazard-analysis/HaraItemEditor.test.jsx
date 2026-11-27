global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const Editor=require('./HaraItemEditor').default;
const {createProjectHaraItem}=require('./projectHaraItem');
test('the inferred shared boundary can be edited, saved and returned to automatic inference',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),onSave=jest.fn(),onReset=jest.fn();
 const item=createProjectHaraItem({name:'Vehicle motion item',definition:'Vehicle motion functions and their external interfaces.'},'scope');
 try{
  act(()=>root.render(<Editor item={item} onSave={onSave} onReset={onReset}/>));
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Edit Item').click());
  const input=host.querySelector('input');
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Automated motion item');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Save Item').click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({name:'Automated motion item',origin:'user',id:item.id}));
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Use AI on next run').click());
  expect(onReset).toHaveBeenCalledTimes(1);
 }finally{act(()=>root.unmount());host.remove();}
});
