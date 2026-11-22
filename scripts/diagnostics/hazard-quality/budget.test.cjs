const test=require('node:test'),assert=require('node:assert/strict');
const {SpendBudget,increaseCampaignCap}=require('./budget.cjs');
const rates={input:2,output:10};
const request={messages:[{role:'user',content:'Synthetic prompt'}],maxTokens:1000,workflow:'test'};
test('reservations include concurrent work and cap dispatch before spending',()=>{
  const budget=new SpendBudget({limitUsd:0.06,rates});
  budget.reserve(request);
  assert.throws(()=>budget.reserve(request),error=>error.code==='QUALITY_SPEND_CAP');
});
test('usage releases conservative reservation; missing usage retains it',()=>{
  const budget=new SpendBudget({limitUsd:25,rates});
  const ticket=budget.reserve(request),reserved=budget.reservedUsd;
  budget.settle(ticket,{input_tokens:10,output_tokens:20});
  assert(budget.spentUsd<reserved);assert.equal(budget.reservedUsd,0);
  const second=budget.reserve(request),next=budget.reservedUsd;
  const before=budget.spentUsd;budget.settle(second);
  assert.equal(budget.spentUsd,before+next);
  assert.throws(()=>budget.settle(second),/already settled/);
});
test('resume cannot reset previously consumed budget',()=>{
  const budget=new SpendBudget({limitUsd:25,rates,spentUsd:24.99});
  assert.throws(()=>budget.reserve(request),error=>error.code==='QUALITY_SPEND_CAP');
});
test('invalid limits and unlimited output are rejected',()=>{
  assert.throws(()=>new SpendBudget({limitUsd:Infinity,rates:{input:0,output:0}}));
  const budget=new SpendBudget({limitUsd:25,rates});
  assert.throws(()=>budget.reserve({...request,maxTokens:Infinity}));
});
test('invalid cache usage cannot erase or poison campaign spending',()=>{
  for(const count of [-1,NaN,'invalid']) {
    const budget=new SpendBudget({limitUsd:25,rates}),ticket=budget.reserve(request),reserved=budget.reservedUsd;
    budget.settle(ticket,{input_tokens:10,output_tokens:20,cache_creation_input_tokens:count});
    assert.equal(budget.spentUsd,reserved);assert.equal(budget.requests[0].measured,false);
  }
});
test('admission waits for concurrent reservations to settle without exceeding the cap',async()=>{
  const budget=new SpendBudget({limitUsd:0.06,rates}),first=budget.reserve(request);
  let admitted=false;const pending=budget.admit(request).then(ticket=>{admitted=true;return ticket;});
  await Promise.resolve();assert.equal(admitted,false);
  budget.settle(first,{input_tokens:10,output_tokens:20});const second=await pending;
  assert(budget.spentUsd+budget.reservedUsd<=budget.limitUsd);budget.settle(second,{input_tokens:10,output_tokens:20});
});
test('missing usage retains the reservation charge and prevents unaffordable queued work',async()=>{
  const budget=new SpendBudget({limitUsd:0.06,rates}),first=budget.reserve(request);
  const pending=budget.admit(request);budget.settle(first);
  await assert.rejects(pending,error=>error.code==='QUALITY_SPEND_CAP');
});
test('an explicit authorized increase preserves spending, reservations and run history',()=>{
  const state={maxSpendUsd:25,spentUsd:18.9,reservedUsd:0.2,iterations:[{number:1,score:8.67}]};
  assert.throws(()=>increaseCampaignCap(state,40));
  assert.throws(()=>increaseCampaignCap(state,25,{authorized:true,reason:'Not an increase'}));
  const next=increaseCampaignCap(state,40,{authorized:true,reason:'User explicitly increased the cap.'});
  assert.equal(next.maxSpendUsd,40);assert.equal(next.spentUsd,state.spentUsd);assert.equal(next.reservedUsd,state.reservedUsd);assert.deepEqual(next.iterations,state.iterations);assert.equal(state.maxSpendUsd,25);assert.equal(next.budgetChanges.length,1);
});
