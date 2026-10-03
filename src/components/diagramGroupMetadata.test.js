import { preserveGroupMetadata } from './diagramGroupMetadata';

test('layout preserves saved descriptions (including empty ones), flags and color without reverting geometry', () => {
  const old = [{id:'g:one',label:'One',description:'Saved',descriptionUserEdited:true,descriptionSource:'user',brandColor:'red',manualMembership:true,position:{x:9,y:9}},
    {id:'g:two',label:'Two',description:'',descriptionUserEdited:true}];
  const next = [{id:'g:one',label:'One',description:'Automatic',position:{x:100,y:200},width:800},
    {id:'g:two',label:'Two',description:'Automatic'}];
  expect(preserveGroupMetadata(next,old)).toEqual([
    {...next[0],description:'Saved',descriptionUserEdited:true,descriptionSource:'user',brandColor:'red',manualMembership:true},
    {...next[1],description:'',descriptionUserEdited:true},
  ]);
});

test('unmodified descriptions follow new category metadata; identity fallback requires an unambiguous compatible group', () => {
  const next = [{id:'new',label:'Planning',description:'New summary'}];
  expect(preserveGroupMetadata(next,[{id:'old',label:'Planning',description:'Old summary'}])).toEqual(next);
  const saved={id:'old',label:'Planning',description:'Saved',descriptionUserEdited:true};
  expect(preserveGroupMetadata(next,[saved])[0].description).toBe('Saved');
  expect(preserveGroupMetadata(next,[saved,{...saved,id:'other'}])).toEqual(next);
  expect(preserveGroupMetadata(next,[{...saved,elementType:'system'}])).toEqual(next);
  const duplicateTargets=[next[0],{...next[0],id:'new-duplicate'}];
  expect(preserveGroupMetadata(duplicateTargets,[saved])).toEqual(duplicateTargets);
});
