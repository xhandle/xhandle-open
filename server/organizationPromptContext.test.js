const test=require('node:test'),assert=require('node:assert/strict');
const {decodeOrganizationContext,withOrganizationPromptContext}=require('./organizationPromptContext');
const {ORGANIZATION_CONTEXT_VERSION,ORGANIZATION_CONTEXT_GUIDANCE}=require('../src/lib/organizationPromptPolicy');
const header=context=>Buffer.from(`${ORGANIZATION_CONTEXT_VERSION}\norg-v1:test\n${context}`).toString('base64');
test('profile guidance precedes task instructions and preserves multimodal messages',()=>{
 const context=ORGANIZATION_CONTEXT_GUIDANCE+'\nUse customer terminology.',image={role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}},{type:'text',text:'Describe this'}]},schema={role:'system',content:'Return JSON only.'};
 const messages=withOrganizationPromptContext([schema,image],header(context));
 assert.equal(messages[0].content,context);assert.equal(messages[1],schema);assert.equal(messages[2],image);
 assert.equal(withOrganizationPromptContext(messages,header(context)),messages);
});
test('malformed, oversized and unsupported context headers add no prompt content',()=>{
 for(const value of ['',null,'@@@','e30=','a'.repeat(7000),header(ORGANIZATION_CONTEXT_GUIDANCE+'x'.repeat(5000)),Buffer.from('future-version\nidentity\n'+ORGANIZATION_CONTEXT_GUIDANCE).toString('base64')])assert.equal(decodeOrganizationContext(value),'');
});
test('an existing full governed profile is not duplicated',()=>{
 const messages=[{role:'user',content:'# xHandle Organization Calibration Context\nApply this profile as governed contextual guidance.\nFull workflow profile'}];
 assert.equal(withOrganizationPromptContext(messages,header(ORGANIZATION_CONTEXT_GUIDANCE)),messages);
});
