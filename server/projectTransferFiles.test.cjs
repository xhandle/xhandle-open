const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createProjectTransferRouter,MAX_CHUNK}=require('./projectTransferFiles.cjs');
async function setup(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'transfer-test-'));
 const router=createProjectTransferRouter({directory,...options}),app=express();app.use('/transfer',router);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}/transfer`;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await router.dispose();await fs.rm(directory,{recursive:true,force:true});});
 const request=(suffix='',method='GET',body,headers={})=>fetch(base+suffix,{method,body,...{headers}});
 const create=async()=>{const r=await request('','POST',JSON.stringify({name:'../test'}),{'Content-Type':'application/json'});assert.equal(r.status,201);return (await r.json()).id;};
 return {request,create,router,directory};
}
test('disk spool verifies sequence and hash, downloads exact bytes, and deletes',async t=>{
 const {request,create}=await setup(t),id=await create(),data=Buffer.alloc(700000,120);
 assert.equal((await request(`/${id}/download`)).status,404);
 assert.equal((await request(`/${id}/chunks/1`,'PUT',data,{'Content-Type':'application/octet-stream'})).status,409);
 const ack=await request(`/${id}/chunks/0`,'PUT',data,{'Content-Type':'application/octet-stream'});assert.deepEqual(await ack.json(),{next:1,bytes:data.length});
 const final=await request(`/${id}/finish`,'POST',JSON.stringify({bytes:data.length,chunks:1,digest:createHash('sha256').update(data).digest('hex')}),{'Content-Type':'application/json'});assert.equal(final.status,200);
 const download=await request(`/${id}/download`);assert.match(download.headers.get('content-disposition'),/attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),data);
 assert.equal((await request(`/${id}`,'DELETE')).status,204);assert.equal((await request(`/${id}/download`)).status,404);
});
test('oversized requests, foreign origins, corruption and expiration are rejected',async t=>{
 let clock=Date.now();const {request,create,router}=await setup(t,{now:()=>clock,ttl:60000}),id=await create();
 assert.equal((await request('','POST','{}',{'Content-Type':'application/json',Origin:'https://example.com'})).status,403);
 assert.equal((await request(`/${id}/chunks/0`,'PUT',Buffer.alloc(MAX_CHUNK+1),{'Content-Type':'application/octet-stream'})).status,413);
 assert.equal((await request(`/${id}/finish`,'POST','{}',{'Content-Type':'application/json'})).status,400);
 assert.equal((await request(`/${id}`,'DELETE')).status,404);
 const expired=await create();clock+=60001;await router.sweep();assert.equal((await request(`/${expired}`,'DELETE')).status,404);
});
test('concurrent creation respects the eight-file cap',async t=>{
 const {request}=await setup(t);const results=await Promise.all(Array.from({length:20},()=>request('','POST','{}',{'Content-Type':'application/json'})));
 assert.equal(results.filter(r=>r.status===201).length,8);assert.equal(results.filter(r=>r.status===429).length,12);
});
