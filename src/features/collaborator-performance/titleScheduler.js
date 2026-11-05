export function scheduleIdleTitle({busy,generate,onTitle,delayMs=500}){
 if(busy)return ()=>{};
 const controller=new AbortController();
 const timer=setTimeout(()=>{void (async()=>{try{const title=await generate(controller.signal);if(!controller.signal.aborted)onTitle(title);}catch{/* A canceled title is retried by a later idle render. */}})();},delayMs);
 return ()=>{clearTimeout(timer);controller.abort();};
}
