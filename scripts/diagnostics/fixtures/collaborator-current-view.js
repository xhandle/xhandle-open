// Synthetic fixture for a disposable profile only. No model requests or writes
// to a real workspace are performed by this seeder.
import { saveSafetyCase } from '../../../src/features/safety-case/safetyCaseStore';
import { createBlankSafetyCase, createSafetyCaseNode, createSafetyCaseEdge } from '../../../src/features/safety-case/safetyCaseTypes';
import { saveGeneratedReport } from '../../../src/features/project-hazard-analysis/generatedReportStorage';

window.seedCollaboratorCurrentView = async () => {
  const id = 'view-project', now = new Date().toISOString();
  const rows = [
    { fromFunction: 'Acquire Inertial Measurement', fromDetails: 'Acquire inertial sensor measurements.', controlAction: 'Inertial Data', controlDetails: 'Measured acceleration and angular velocity.', toFunction: '3D Scene Understanding', toDetails: 'Estimate the scene from sensor measurements.' },
    { fromFunction: 'Fuse Multi-Modal State Estimates', fromDetails: 'Fuse current sensor estimates.', controlAction: 'Fused State', controlDetails: 'Current estimated operating state.', toFunction: 'Maintain Canonical Scene State', toDetails: 'Maintain the scene used by the planner.' },
    { fromFunction: 'Task Planner', fromDetails: 'Choose the requested motion.', controlAction: 'Motion Request', controlDetails: 'Requested speed and direction.', toFunction: 'Motion Controller', toDetails: 'Control the requested vehicle motion.' },
  ];
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id, name: 'AV Stack fixture' }]));
  localStorage.setItem('xhandle.projectData', JSON.stringify({ [id]: { responseRows: rows, riskRegister: [], analysisResult: null } }));
  localStorage.setItem('xhandle.activeProjectId', id);
  localStorage.setItem('xhandle.lastNonCopilotSection', 'projects');
  localStorage.setItem('xhandle.copilotDockOpen', 'true'); localStorage.setItem('xhandle.copilotDockCollapsed', 'false');
  localStorage.setItem('xhc.threads', JSON.stringify([{ id: 'view-thread', title: 'Current view checks', messages: [
    { role: 'user', content: 'Earlier discussion of a different diagram.' }, { role: 'assistant', content: 'We were discussing an unrelated battery system.' },
  ] }]));
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('xhandle-design-artifacts', 2);
    request.onupgradeneeded = () => { for (const name of ['metadata', 'revisions', 'jobs', 'baselines', 'presentations']) {
      if (request.result.objectStoreNames.contains(name)) continue;
      const store = request.result.createObjectStore(name, { keyPath: 'id' }); store.createIndex('projectId', 'projectId'); if (name !== 'metadata') store.createIndex('artifactId', 'artifactId');
    } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction(['metadata', 'revisions'], 'readwrite'), done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'view-folder', name: 'Current view designs', modules: [] }])); localStorage.setItem('xhandle:req-active-project', JSON.stringify('view-folder'));
  const config = { templateId: 'conops', title: 'Control operations', projectId: id, workspaceType: 'functional', folderId: 'view-folder', system: 'Controller', sources: [], notes: 'Recorded command control evidence.' };
  tx.objectStore('metadata').put({ id: 'view-doc', title: config.title, templateId: config.templateId, config, revision: 1, projectId: id, folderId: config.folderId, freshness: 'current' });
  tx.objectStore('revisions').put({ id: 'view-doc:1', artifactId: 'view-doc', number: 1, objects: [
    { id: 'view-doc:s1', sectionId: 's1', kind: 'section', title: 'Command operation', text: '', sourceIds: [] },
    { id: 'view-doc:r1', sectionId: 's1', parentId: 'view-doc:s1', kind: 'requirement', title: '', text: 'The controller shall reject expired commands.', sourceIds: [] },
  ], sources: { entries: [] }, createdAt: now }); await done; db.close();
  const safetyCase = createBlankSafetyCase({ projectId: id, name: 'Control Safety Case' });
  safetyCase.nodes = [createSafetyCaseNode({ id: 'view-claim', title: 'Expired commands cannot cause motion', status: 'needs-review' }),
    createSafetyCaseNode({ id: 'view-evidence', type: 'evidence', title: 'Command expiration test', description: 'Recorded test evidence; approval is pending.', status: 'draft' })];
  safetyCase.edges = [createSafetyCaseEdge('view-evidence', 'view-claim', 'supports')]; safetyCase.rootNodeId = 'view-claim'; await saveSafetyCase(safetyCase);
  await saveGeneratedReport(id, { title: 'Control Evidence Report', reportType: 'Custom Report', report: '# Control Evidence Report\n\nThe controller rejects expired commands. Verification is pending.' });
  localStorage.setItem('xhandle:vnv-test-case-documents', JSON.stringify([{ id: 'view-tests', name: 'Control Tests', projectId: id, sourceProjectId: id, requirements: [], testCases: [
    { id: 'TC-EXPIRE', title: 'Reject stale command', requirementId: 'REQ-EXPIRE', status: 'Draft', method: 'Test', objective: 'Verify command expiration.', steps: ['Submit an expired command.'], expectedResults: ['The command is rejected.'] },
  ], createdAt: now, updatedAt: now }])); localStorage.setItem('xhandle:vnv-active-document-id', 'view-tests');
  return { projectId: id, sourceRows: rows.length };
};
