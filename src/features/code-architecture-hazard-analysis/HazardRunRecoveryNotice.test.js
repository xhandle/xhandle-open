import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import HazardRunRecoveryNotice from './HazardRunRecoveryNotice';
jest.mock('./CodeArchitectureHazardSummaryTable',()=>()=>null);
const render=run=>renderToStaticMarkup(<HazardRunRecoveryNotice run={{finalSavePending:true,...run}} onRetrySave={()=>{}} />);
test('slow saves do not claim failure and cannot start overlapping retries',()=>{
 const html=render({finalSaveStatus:'slow'});expect(html).toContain('Saving is taking longer');expect(html).not.toContain('Saving failed');expect(html).toContain('disabled');
});
test('initial failure shows underlying reason and offers manual retry',()=>{
 const html=render({finalSaveStatus:'failed',saveFailureMessage:'Browser quota exceeded'});expect(html).toContain('Save error: Browser quota exceeded');expect(html).not.toContain('disabled');
});
test('automatic retry status differs from terminal failure',()=>{
 expect(render({finalSaveStatus:'retrying'})).toContain('Retrying save automatically');
});
