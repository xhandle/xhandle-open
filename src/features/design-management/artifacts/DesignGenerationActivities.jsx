import { useEffect, useRef } from 'react';
import { useActivityCenter } from '../../../components/activity/ActivityCenter';
import { generationRunEntries, subscribeGenerationRuns } from './generationRuns';
import { generationProgressSummary, generationStageLabel } from './generationProgress';

// Mounted with the application header, not an editor: navigation cannot detach
// the activity feed from a background generation run.
export default function DesignGenerationActivities() {
  const { startActivity, updateActivity, finishActivity } = useActivityCenter();
  const seen = useRef(new Map());
  useEffect(() => {
    const sync = () => {
      for (const [key, run] of generationRunEntries()) {
        let previous = seen.current.get(key);
        if (previous?.snapshot === run) continue;
        if (!previous || previous.runId !== run.runId) {
          if (!run.running) continue;
          const id = `design-generation:${key}:${run.runId}`;
          startActivity(id, { title: run.title, message: run.progress });
          previous = { id, runId: run.runId };
        }
        const details = run.details || {};
        const location = [details.documentTitle, details.sectionTitle, details.partTitle].filter(Boolean).join(' · ');
        const progressLabel = generationProgressSummary(details);
        const message = [location, run.error || run.progress].filter(Boolean).join(' — ');
        updateActivity(previous.id, { step: details.completedSections || 0, total: details.totalSections || 0,
          statusLabel: generationStageLabel(details.stage), message, progressLabel, showWhenPaused: true });
        if (!run.running && previous.snapshot?.running) finishActivity(previous.id, run.status, message);
        seen.current.set(key, { ...previous, snapshot: run });
      }
    };
    const unsubscribe = subscribeGenerationRuns(sync); sync();
    return unsubscribe;
  }, [startActivity, updateActivity, finishActivity]);
  return null;
}
