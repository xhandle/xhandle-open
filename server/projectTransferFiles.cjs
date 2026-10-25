// Private, ephemeral, local-only spool files. No workspace payload is retained in a server buffer.
const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const MAX_CHUNK = 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
function createProjectTransferRouter({ directory, ttl = TTL, now = Date.now } = {}) {
  const router = express.Router(), sessions = new Map();
  let root, creating = 0;
  const cleanStale = async () => {
    const parent=directory || os.tmpdir();
    for(const item of await fs.readdir(parent,{withFileTypes:true})){
      if(!item.isDirectory() || !/^xhandle-transfer-[a-zA-Z0-9]+$/.test(item.name))continue;
      const candidate=path.join(parent,item.name);
      const stat=await fs.stat(candidate).catch(()=>null);
      if(stat && now()-stat.mtimeMs>ttl)await fs.rm(candidate,{recursive:true,force:true}).catch(()=>{});
    }
  };
  const storage = async () => root || (root = cleanStale().then(()=>fs.mkdtemp(path.join(directory || os.tmpdir(), 'xhandle-transfer-'))).then(async p => { await fs.chmod(p, 0o700); return p; }));
  const discard = async entry => { sessions.delete(entry.id); await entry.file?.close().catch(() => {}); await fs.rm(entry.path, {force:true}).catch(() => {}); };
  const sweep = async () => { if(root){const dir=await root;const date=new Date(now());await fs.utimes(dir,date,date).catch(()=>{});} for (const entry of sessions.values()) if (!entry.busy && now()-entry.touched>ttl) await discard(entry); };
  const timer = setInterval(() => sweep().catch(() => {}), Math.min(ttl, 60000)); timer.unref?.();
  const fail = (status, message) => Object.assign(new Error(message), {status});
  const route = handler => async (req,res) => { try { await handler(req,res); } catch(error) { if (!res.headersSent) res.status(error.status || 500).json({error:error.status ? error.message : 'Project file could not be written. Check free disk space and retry.'}); else res.destroy(); } };
  router.use((req,res,next) => {
    const address = req.socket.remoteAddress || '';
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)) return res.sendStatus(403);
    // Prevent another website from creating local files. Desktop's proxy already authenticates requests.
    const origin = req.get('origin');
    if (origin && origin !== 'xhandle://app' && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return res.sendStatus(403);
    res.set('Cache-Control','no-store');next();
  });
  router.post('/', express.json({limit:'4kb'}), route(async (req,res) => {
    await sweep(); if(sessions.size+creating>=8)throw fail(429,'Too many pending exports. Save or cancel another export first.');
    creating++;
    try {
    const dir=await storage(),id=randomBytes(32).toString('hex'),temporary=path.join(dir,id+'.partial');
    const file=await fs.open(temporary,'wx',0o600);
    const name=String(req.body?.name || 'project').replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,100).replace(/\.xhproject$/i,'')+'.xhproject';
    sessions.set(id,{id,file,path:temporary,name,bytes:0,next:0,hash:createHash('sha256'),touched:now(),busy:false,ready:false});
    res.status(201).json({id,maxChunkBytes:MAX_CHUNK});
    } finally { creating--; }
  }));
  const use = handler => route(async(req,res) => {
    const entry=sessions.get(req.params.id);
    if(entry && !entry.busy && now()-entry.touched>ttl){await discard(entry);throw fail(404,'Export file expired. Export again.');}
    if(!entry)throw fail(404,'Export file expired or is unavailable. Export again.');
    if(entry.busy)throw fail(409,'An export write is already in progress.');
    entry.busy=true;entry.touched=now();
    try{await handler(req,res,entry);}finally{entry.busy=false;entry.touched=now();}
  });
  router.put('/:id/chunks/:sequence', express.raw({type:'application/octet-stream',limit:MAX_CHUNK}), use(async(req,res,e)=>{
    if(e.ready || !/^\d+$/.test(req.params.sequence) || Number(req.params.sequence)!==e.next)throw fail(409,'Export chunks arrived out of order.');
    if(!Buffer.isBuffer(req.body) || !req.body.length)throw fail(400,'Empty export chunk.');
    try{
      // A partial write is never retried as another append: discard the entire incomplete file.
      let offset=0;while(offset<req.body.length){const r=await e.file.write(req.body,offset,req.body.length-offset);if(!r.bytesWritten)throw Error('Short disk write');offset+=r.bytesWritten;}
      e.hash.update(req.body);e.bytes+=req.body.length;e.next++;res.json({next:e.next,bytes:e.bytes});
    }catch(error){await discard(e);throw error;}
  }));
  router.post('/:id/finish',express.json({limit:'4kb'}),use(async(req,res,e)=>{
    if(e.ready)throw fail(409,'Export already finalized.');
    if(req.body?.bytes!==e.bytes || req.body?.chunks!==e.next || req.body?.digest!==e.hash.copy().digest('hex')){await discard(e);throw fail(400,'Export file integrity check failed.');}
    try{await e.file.sync();await e.file.close();e.file=null;const ready=e.path.replace(/\.partial$/,'.xhproject');await fs.rename(e.path,ready);e.path=ready;e.ready=true;res.json({name:e.name,bytes:e.bytes});}
    catch(error){await discard(e);throw error;}
  }));
  router.get('/:id/download',use(async(req,res,e)=>{
    if(!e.ready)throw fail(404,'Export is not ready or has expired.');
    e.touched=now(); // sendFile streams from disk, including native/browser downloads and Range requests.
    res.set('X-Content-Type-Options','nosniff');
    await new Promise(resolve=>{res.once('close',resolve);res.download(e.path,e.name,error=>{if(error && !res.headersSent)res.sendStatus(500);resolve();});});
  }));
  router.delete('/:id',use(async(req,res,e)=>{await discard(e);res.sendStatus(204);}));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status || 500).json({error:error.type==='entity.too.large'?'Export chunk exceeds the supported request size.':'Invalid export request.'});});
  router.dispose=async()=>{clearInterval(timer);for(const e of sessions.values())await discard(e);if(root)await fs.rm(await root,{recursive:true,force:true});};
  router.sweep=sweep;
  return router;
}
module.exports={createProjectTransferRouter,MAX_CHUNK};
