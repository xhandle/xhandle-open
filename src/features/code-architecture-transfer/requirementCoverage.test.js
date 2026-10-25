import { hasCompleteRequirementCoverage as complete } from './requirementCoverage';

test.each([
  ['candidateSystemRequirements','parentSwRequirement','requirements'],
  ['candidateSubsystemRequirements','parentSystemRequirement','requirements'],
  ['candidateDesignElements','parentRequirement','designElements'],
  ['draftCategories','parentSwRequirement','categories'],
])('%s consolidation permits fewer outputs only with complete parent coverage', (key,field,responseKey)=>{
  const payload={schema:{[responseKey]:[{[field]:''}]},[key]:[{[field]:'A, B'},{[field]:'C'}]};
  expect(complete(payload,[{[field]:'A, B, C'}],responseKey)).toBe(true);
  expect(complete(payload,[{[field]:'A, B'}],responseKey)).toBe(false);
});

test.each([
  ['softwareRequirementCategories','parentSwRequirement'],
  ['systemRequirementCategories','parentSystemRequirement'],
  ['subsystemRequirementCategories','parentRequirement'],
])('%s requires ordered coverage for positional callers', (key,field)=>{
  const payload={schema:{requirements:[{[field]:''}]},[key]:[{[field]:'A'},{[field]:'B'}]};
  expect(complete(payload,[{[field]:'A'},{[field]:'B'}])).toBe(true);
  expect(complete(payload,[{[field]:'B'},{[field]:'A'}])).toBe(false);
  expect(complete(payload,[{[field]:'A, B'}])).toBe(false);
});

test('source categorization checks all source ids rather than output count',()=>{
  const payload={schema:{categories:[{parentSwRequirement:''}]},sourceRequirements:[{id:'A'},{id:'B'}]};
  expect(complete(payload,[{parentSwRequirement:'A, B'}],'categories')).toBe(true);
  expect(complete(payload,[{parentSwRequirement:'A'},{parentSwRequirement:'A'}],'categories')).toBe(false);
});

test('unknown task contracts cannot silently mark work complete',()=>{
  expect(complete({task:'unknown'},[{requirementText:'Some text'}])).toBe(false);
});


test.each([', ', '; ', '\n', '\r', '\r\n', ' and ', ' AND '])('separator %j does not relax complete coverage', separator=>{
  const payload={schema:{categories:[{parentSwRequirement:''}]},sourceRequirements:[{id:'A'},{id:'B'},{id:'C'}]};
  expect(complete(payload,[{parentSwRequirement:['A','B','C'].join(separator)}],'categories')).toBe(true);
  expect(complete(payload,[{parentSwRequirement:['A','B'].join(separator)}],'categories')).toBe(false);
});

test('array parent fields use the same canonical separators as strings',()=>{
  const payload={schema:{requirements:[{parentSwRequirement:''}]},candidateSystemRequirements:[{parentSwRequirement:['A and B','C']} ]};
  expect(complete(payload,[{parentSwRequirement:'A, B, C'}])).toBe(true);
  expect(complete(payload,[{parentSwRequirement:'A, C'}])).toBe(false);
});
