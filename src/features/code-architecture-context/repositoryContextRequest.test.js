import { repositoryContextRequestIsCurrent as current } from './repositoryContextRequest';
const start={open:true, draft:{owner:'A',analysisContextText:''},project:'p1',repo:'r1'};
it('allows only the original unchanged open draft',()=>expect(current(start,start,1,1)).toBe(true));
it.each([
 {...start,open:false},
 {...start,draft:{...start.draft,owner:'B'}},
 {...start,draft:{...start.draft,analysisContextText:'User edit'}},
 {...start,project:'p2'},
 {...start,repo:'r2'},
])('rejects a stale or edited draft %#',next=>expect(current(start,next,1,1)).toBe(false));
it('rejects a closed/reopened request and a superseded request even with the same draft',()=>expect(current(start,start,1,2)).toBe(false));
