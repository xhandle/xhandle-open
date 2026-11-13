import {recommendEvidenceLinksForNode as recommend} from './safetyCaseEvidenceRecommendations';
jest.mock('../../components/backendConfig',()=>({backendURL:'',buildAIAuthOpts:()=>({})}));
afterEach(()=>jest.restoreAllMocks());
test('AI can recommend only IDs actually submitted, not an undisclosed ID from the wider catalog',async()=>{
 const artifacts=Array.from({length:55},(_,i)=>({id:'a'+i,title:'Artifact '+i,category:'Other'}));
 const previous=global.fetch;
 const fetch=global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({answer:JSON.stringify({recommendations:[{id:'a54',reason:'Invented match'},{id:'a1',reason:'Known candidate'}]})})});
 const result=await recommend({node:{type:'claim',title:'Safe operation'},safetyCase:{projectId:'p'},groups:[{category:'Other',artifacts}]});
 const sent=JSON.parse(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content).candidates;
 expect(sent).toHaveLength(40);expect(sent.some(a=>a.id==='a54')).toBe(false);
 expect(result.recommendations.map(a=>a.id)).toEqual(['a1']);
 global.fetch=previous;
});
