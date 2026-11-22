// Reserve worst-case input and allowed output before dispatch, including all
// concurrent requests. Missing usage retains the reservation as charged.
class SpendBudget {
  constructor({limitUsd,rates,spentUsd=0}) {
    if (!Number.isFinite(limitUsd) || !(limitUsd>0) || !Number.isFinite(rates?.input) || !(rates?.input>0) || !Number.isFinite(rates?.output) || !(rates?.output>0) || !Number.isFinite(spentUsd) || spentUsd<0) throw Error('Explicit finite positive spend cap and pricing required.');
    this.limitUsd=limitUsd; this.rates=rates; this.spentUsd=spentUsd; this.reservedUsd=0; this.requests=[];this.waiters=new Set();
  }
  reserve({messages,maxTokens,workflow}) {
    if (!Number.isInteger(maxTokens) || maxTokens<1) throw Error('A finite output token limit is required.');
    const bytes=Buffer.byteLength(JSON.stringify(messages),'utf8')+8192;
    // Charge cache creation at the most expensive 1h-write rate; 10% headroom
    // covers geography pricing. No tools/images are admitted by this harness.
    const reserved=1.1*(bytes*this.rates.input*2+maxTokens*this.rates.output)/1e6;
    if(this.spentUsd+this.reservedUsd+reserved>this.limitUsd) throw Object.assign(Error('Live quality campaign spend cap reached before request dispatch.'),{code:'QUALITY_SPEND_CAP',requestedUsd:reserved});
    const ticket={workflow,reserved,settled:false}; this.reservedUsd+=reserved; return ticket;
  }
  async admit(request,{signal}={}) {
    for(;;) {
      if(signal?.aborted)throw signal.reason || Object.assign(Error('Campaign cancelled'),{name:'AbortError'});
      try{return this.reserve(request);}
      catch(error) {
        if(error.code!=='QUALITY_SPEND_CAP' || !this.reservedUsd || this.spentUsd+error.requestedUsd>this.limitUsd)throw error;
        // Existing usage can release reservation headroom. Wait before deciding
        // that a concurrent request is unaffordable; never dispatch over cap.
        await new Promise((resolve,reject)=>{
          const done=()=>{this.waiters.delete(done);signal?.removeEventListener('abort',abort);resolve();};
          const abort=()=>{this.waiters.delete(done);reject(signal.reason || Object.assign(Error('Campaign cancelled'),{name:'AbortError'}));};
          this.waiters.add(done);signal?.addEventListener('abort',abort,{once:true});
        });
      }
    }
  }
  settle(ticket,usage=null) {
    if(ticket.settled)throw Error('Request budget already settled.');
    ticket.settled=true;
    const input=usage?.input_tokens ?? usage?.prompt_tokens;
    const output=usage?.output_tokens ?? usage?.completion_tokens;
    let billed=ticket.reserved, measured=false;
    const cache=usage?.cache_creation_input_tokens ?? 0, read=usage?.cache_read_input_tokens ?? 0;
    if([input,output,cache,read].every(value=>Number.isFinite(value) && value>=0)) {
      billed=1.1*(input*this.rates.input+output*this.rates.output+cache*this.rates.input*2+read*this.rates.input)/1e6;
      measured=true;
    }
    this.reservedUsd=Math.max(0,this.reservedUsd-ticket.reserved);this.spentUsd+=billed;
    this.requests.push({workflow:ticket.workflow,chargedUsd:billed,measured,usage});
    for(const resolve of [...this.waiters])resolve();
    if(this.spentUsd+this.reservedUsd>this.limitUsd+1e-9)throw Object.assign(Error('Provider usage exceeded the reserved estimate; campaign halted.'),{code:'QUALITY_SPEND_CAP'});
    return billed;
  }
}
function increaseCampaignCap(state,nextCap,{authorized=false,reason=''}={}) {
  if(!authorized || !String(reason).trim())throw Error('An explicit authorized cap increase and reason are required.');
  if(!Number.isFinite(nextCap) || nextCap<=state.maxSpendUsd)throw Error('The new cap must be finite and higher than the existing cap.');
  return {...state,maxSpendUsd:nextCap,budgetChanges:[...(state.budgetChanges || []),{previousCapUsd:state.maxSpendUsd,newCapUsd:nextCap,reason,at:new Date().toISOString()}]};
}
module.exports={SpendBudget,increaseCampaignCap};
