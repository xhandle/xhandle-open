import {TextEncoder, TextDecoder} from 'util';
import {Headers,Request} from 'node-fetch';
import {installAIRequestAuthShim} from './installAIRequestAuthShim';
import {clearOrganizationPromptCache,setOrganizationPromptScopeResolver} from '../features/organization-profile/organizationPromptContext';
import {ORGANIZATION_CONTEXT_HEADER} from './organizationPromptPolicy';
jest.mock('./aiProviderConfig',()=>({getStoredActiveAIProvider:()=> 'claude',getStoredAIProviderApiKey:()=> 'synthetic-test-key',getStoredAIProviderModelPreference:()=> 'test-model',supportsAIProviderEffort:()=>false}));
let native,previous,release;
beforeAll(()=>{global.Headers=Headers;global.Request=Request;global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;});
beforeEach(()=>{
 previous=window.fetch;native=jest.fn(async()=>({ok:true}));window.fetch=native;delete window.__xhandleAIRequestAuthShimInstalled;delete window.__BACKEND_URL;
 localStorage.clear();clearOrganizationPromptCache();
 localStorage.setItem('xhandle.organizationProfile',JSON.stringify({enabled:true,markdown:'---\norganization: Shim fixture\nprofile_version: 1.0\nstatus: approved\n---\n# Engineering Rules\nSHARED-POLICY: use source evidence.\n'}));
 installAIRequestAuthShim();
});
afterEach(()=>{release?.();window.fetch=previous;delete window.__xhandleAIRequestAuthShimInstalled;delete window.__BACKEND_URL;});
test.each(['/api/chat','/api/chatgpt','/chat','/api/rt/session','http://127.0.0.1:5001/api/chat'])('every local AI route carries the context header: %s',async url=>{
 const body='{"messages":[{"role":"user","content":"Question"}]}';await window.fetch(url,{method:'POST',body});
 const options=native.mock.calls[0][1];expect(options.body).toBe(body);expect(options.headers.get(ORGANIZATION_CONTEXT_HEADER)).toBeTruthy();expect(options.headers.get('x-ai-provider')).toBe('claude');
});
test('external endpoints and unrelated local APIs receive neither context nor provider secrets',async()=>{
 for(const url of ['https://external.example/api/chat','/api/github/repo-files','/api/rt/session/other'])await window.fetch(url,{method:'POST',body:'{}'});
 for(const [,options] of native.mock.calls){expect(options.headers).toBeUndefined();}
});
test('configured backend receives context, and an explicit scoped opt-out is preserved',async()=>{
 window.__BACKEND_URL='https://backend.example';await window.fetch('https://backend.example/api/chat',{method:'POST',headers:{[ORGANIZATION_CONTEXT_HEADER]:''},body:'{}'});
 expect(native.mock.calls[0][1].headers.has(ORGANIZATION_CONTEXT_HEADER)).toBe(true);expect(native.mock.calls[0][1].headers.get(ORGANIZATION_CONTEXT_HEADER)).toBe('');
});
test('registered Electron schemes work without treating unrelated null-origin URLs as trusted',async()=>{
 window.__BACKEND_URL='xhandle://app';
 await window.fetch(new URL('xhandle://app/api/chat'),{method:'POST',body:'{}'});
 expect(native.mock.calls[0][1].headers.get(ORGANIZATION_CONTEXT_HEADER)).toBeTruthy();
 await window.fetch('file:///api/chat',{method:'POST',body:'{}'});
 expect(native.mock.calls[1][1].headers).toBeUndefined();
});
test('Request bodies, custom headers and cancellation survive enrichment',async()=>{
 const controller=new AbortController(),request=new Request('http://localhost/api/chat',{method:'POST',headers:{'content-type':'application/json','x-custom':'retained'},body:'{"prompt":"question"}',signal:controller.signal});
 await window.fetch(request);const enriched=native.mock.calls[0][0];
 expect(enriched.headers.get(ORGANIZATION_CONTEXT_HEADER)).toBeTruthy();expect(enriched.headers.get('x-custom')).toBe('retained');expect(await enriched.text()).toBe('{"prompt":"question"}');
 controller.abort();expect(enriched.signal.aborted).toBe(true);
});
test('large prompt bodies are forwarded untouched without JSON parsing',async()=>{
 const body=JSON.stringify({messages:[{role:'user',content:'x'.repeat(2000000)}]});
 const original=JSON.parse,spy=jest.spyOn(JSON,'parse').mockImplementation(value=>{if(value===body)throw Error('Large request body was reparsed');return original(value);});
 try{await window.fetch('/api/chat',{method:'POST',body});expect(native.mock.calls[0][1].body).toBe(body);expect(native.mock.calls[0][1].headers.get(ORGANIZATION_CONTEXT_HEADER)).toBeTruthy();}finally{spy.mockRestore();}
});
