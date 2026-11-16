import {TextEncoder, TextDecoder} from 'util';
import {clearOrganizationPromptCache, getOrganizationPromptContext, organizationPromptHeaders, setOrganizationPromptScopeResolver} from './organizationPromptContext';
import {ORGANIZATION_CONTEXT_MAX_BYTES, ORGANIZATION_HEADER_MAX_CHARS, ORGANIZATION_CONTEXT_HEADER} from '../../lib/organizationPromptPolicy';
const {decodeOrganizationContext, withOrganizationPromptContext}=require('../../../server/organizationPromptContext');
const markdown='---\norganization: Example Robotics\nprofile_version: 1.0\nstatus: approved\n---\n# Organization and Products\nBuild inspection robots.\n# Engineering Rules\nUse observable acceptance criteria.\n# Custom Hazard Policy\nUse the supplied fleet-frequency records.\n# Glossary\nA stop command requests standstill.\n';
const save=(overrides={})=>localStorage.setItem('xhandle.organizationProfile',JSON.stringify({enabled:true,markdown,...overrides}));
let release;
beforeAll(()=>{global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;});
beforeEach(()=>{localStorage.clear();clearOrganizationPromptCache();});
afterEach(()=>release?.());
test('enabled context includes custom sections, governance and project override',()=>{
 save();release=setOrganizationPromptScopeResolver(()=>({projectId:'p',projectProfile:{mode:'inherit',overrideMarkdown:'Use the customer crossing frequency.'}}));
 const context=getOrganizationPromptContext({hint:'hazard analysis'});
 expect(context.context).toContain('constructive bias');expect(context.context).toContain('Custom Hazard Policy');expect(context.context).toContain('customer crossing frequency');
 expect(decodeOrganizationContext(context.header)).toBe(context.context);
 expect(withOrganizationPromptContext([{role:'user',content:'Analyze braking'}],context.header)[0].content).toBe(context.context);
});
test('disabled profiles perform no project lookup and add no context',()=>{
 save({enabled:false});const resolve=jest.fn();release=setOrganizationPromptScopeResolver(resolve);
 expect(organizationPromptHeaders()).toEqual({});expect(resolve).not.toHaveBeenCalled();
});
test('project opt-out is preserved as an explicit empty transport context',()=>{
 save();release=setOrganizationPromptScopeResolver(()=>({projectId:'p',projectProfile:{mode:'disabled'}}));
 expect(organizationPromptHeaders({projectId:'p'})).toEqual({[ORGANIZATION_CONTEXT_HEADER]:''});
});
test('explicit background project scope wins and warm contexts reuse the same compiled result',()=>{
 save();const resolve=jest.fn(({projectId})=>({projectId:projectId??'active',projectProfile:{mode:'inherit',overrideMarkdown:projectId==='background'?'BACKGROUND-POLICY':'ACTIVE-POLICY'}}));release=setOrganizationPromptScopeResolver(resolve);
 const background=getOrganizationPromptContext({projectId:'background'});
 expect(background.context).toContain('BACKGROUND-POLICY');expect(background.context).not.toContain('ACTIVE-POLICY');
 for(let i=0;i<500;i++)expect(getOrganizationPromptContext({projectId:'background'})).toBe(background);
 expect(getOrganizationPromptContext().identity).not.toBe(background.identity);
});
test('toggle, profile content and override changes invalidate cached context without stale bias',()=>{
 save();let override='First policy';release=setOrganizationPromptScopeResolver(()=>({projectId:'p',projectProfile:{overrideMarkdown:override}}));
 const first=getOrganizationPromptContext();override='Second policy';const second=getOrganizationPromptContext();
 expect(second.identity).not.toBe(first.identity);expect(second.context).not.toContain('First policy');
 save({markdown:markdown.replace('inspection robots','vehicle controllers')});expect(getOrganizationPromptContext().identity).not.toBe(second.identity);
 save({enabled:false});expect(getOrganizationPromptContext().context).toBe('');save();expect(getOrganizationPromptContext().context).toContain('inspection robots');
});
test.each(['Critical policy. '.repeat(3000),'危険を評価する。'.repeat(4000),'"quoted policy" '.repeat(3000)])('large profiles stay within byte/header bounds, including Unicode and quotes',body=>{
 save({markdown:markdown+'\n# Hazard calibration\n'+body});
 release=setOrganizationPromptScopeResolver(()=>({projectId:'p',projectProfile:{overrideMarkdown:'KEEP-PROJECT-OVERRIDE: preserve the supplied safe state.'}}));
 const context=getOrganizationPromptContext({hint:'hazard calibration'});
 expect(context.header).toBeTruthy();expect(new TextEncoder().encode(context.context).length).toBeLessThanOrEqual(ORGANIZATION_CONTEXT_MAX_BYTES);
 expect(context.header.length).toBeLessThanOrEqual(ORGANIZATION_HEADER_MAX_CHARS);expect(context.context).toContain('KEEP-PROJECT-OVERRIDE');
 expect(decodeOrganizationContext(context.header)).toBe(context.context);
});
test('malformed or invalid enabled profiles fail closed without breaking AI requests',()=>{
 localStorage.setItem('xhandle.organizationProfile','{');expect(organizationPromptHeaders()).toEqual({});
 save({markdown:'# No required metadata'});expect(organizationPromptHeaders()).toEqual({});
});
test('source context deduplication leaves existing governed workflow messages unchanged',()=>{
 save();const snapshot=getOrganizationPromptContext();
 const messages=[{role:'system',content:'Task schema: return JSON only.'},{role:'user',content:'# xHandle Organization Calibration Context\nApply this profile as governed contextual guidance.\nExisting full profile'}];
 expect(withOrganizationPromptContext(messages,snapshot.header)).toBe(messages);
 expect(withOrganizationPromptContext(withOrganizationPromptContext([{role:'user',content:'Question'}],snapshot.header),snapshot.header)).toHaveLength(2);
});
