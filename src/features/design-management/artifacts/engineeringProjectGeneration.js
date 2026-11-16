import { generationMembers } from './engineeringProjectModel';
import { createGenerationBudget } from './generationBudget';
import { getTemplate } from './artifactModel';
import { generateArtifact } from './artifactGeneration';
import { loadArtifact } from './artifactRepository';
import { beginEngineeringGeneration, finishEngineeringGeneration, loadEngineeringProject, prepareEngineeringDocument } from './engineeringProjectRepository';

export async function generateEngineeringProject(id, options = {}) {
  const budget = createGenerationBudget(options.signal);
  try { return await generateEngineeringProjectWork(id, { ...options, signal: budget.signal, budget }); }
  catch (error) { throw budget.error() || error; }
  finally { budget.close(); }
}
async function generateEngineeringProjectWork(id, { reset = false, signal, request, hazardRequest, budget, onProgress = () => {} }) {
  const { program: before, records } = await loadEngineeringProject(id);
  const program = await beginEngineeringGeneration(id, before.version, reset);
  const generated = new Map();
  const documents = records.filter(record => record.meta.templateId !== 'traceability-matrix');
  const members = generationMembers(program);
  const counts = new Map(documents.map(record => [record.meta.id, reset ? 0 : Object.keys(record.job?.sections || {}).length]));
  const ready = new Set(reset ? [] : documents.filter(record => record.job?.state === 'ready').map(record => record.meta.id));
  const totalSections = members.reduce((sum, member) => sum + getTemplate(member.config.templateId).sections.length, 0);
  const report = (message, details = {}) => onProgress(message, { projectTitle: program.title,
    completedDocuments: ready.size, totalDocuments: members.length,
    completedSections: [...counts.values()].reduce((sum, value) => sum + value, 0), totalSections, ...details });
  report('Preparing the project document set…', { stage: 'preparing' });
  try {
    for (const member of members) {
      if (signal?.aborted) throw new DOMException('Project generation paused.', 'AbortError');
      const document = { artifactId: member.id, documentTitle: member.config.title, documentIndex: members.indexOf(member) + 1, sectionTitle: null, partTitle: null, retryReason: null, savedParts: 0 };
      report(`Preparing ${member.config.title}…`, { ...document, stage: 'preparing' });
      const upstream = member.dependsOn.map(id => generated.get(id));
      const job = await prepareEngineeringDocument(program, member.id, upstream);
      if (job.state !== 'ready') await generateArtifact(member.id, { signal, request, hazardRequest, budget, programRunToken: program.runToken, onProgress: (message, details = {}) => {
        counts.set(member.id, details.completedSections || 0);
        const { completedSections, totalSections: documentTotalSections, ...location } = details;
        report(`${member.config.title}: ${message}`, { ...document, ...location, stage: location.stage === 'complete' ? 'saving' : location.stage,
          documentCompletedSections: completedSections, documentTotalSections });
      } });
      generated.set(member.id, await loadArtifact(member.id));
      ready.add(member.id); counts.set(member.id, getTemplate(member.config.templateId).sections.length);
      report(`${member.config.title} is saved and ready for review.`, { ...document, stage: 'saving' });
    }
    report('Checking all documents and source references…', { stage: 'verifying', artifactId: null, documentTitle: null, sectionTitle: null, partTitle: null, savedParts: 0, retryReason: null });
    await finishEngineeringGeneration(program, 'ready');
    report('All selected documents are ready for review.', { stage: 'complete' });
  } catch (cause) {
    const error = budget.error() || cause;
    await finishEngineeringGeneration(program, 'paused', error.name === 'AbortError' ? 'Paused. Completed documents and sections are saved.' : error.message);
    throw error;
  }
}
