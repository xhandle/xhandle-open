import React, { useCallback, useEffect, useState, useRef } from 'react';
import { ProfileSelect } from './TraceabilityProfilesDialog';
import { assignment, defaultSelection, getProfile, scopeKey, suggestBindings, traceCatalog } from './traceabilityRepository';
import { STAGES, profileKey } from './traceabilityModel';

export default function MatrixSetupFields({ config, owner, onChange }) {
  const [catalog, setCatalog] = useState([]), [profile, setProfile] = useState(null), [inherited, setInherited] = useState(null), [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false), [feedback, setFeedback] = useState(''), [expanded, setExpanded] = useState([]);
  const suggestionRun = useRef(0);
  const cancelSuggestion = useCallback(() => { suggestionRun.current++; }, []);
  const latest = useRef({ config, onChange }); latest.current = { config, onChange };
  const scope = config.scopeId || (owner ? scopeKey(owner) : ''), selection = config.profile || defaultSelection;
  useEffect(() => { let alive = true; setCatalog([]); setError(''); traceCatalog(scope).then(rows => { if (alive) setCatalog(rows); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [scope]);
  useEffect(() => { let alive = true; if (scope) assignment(scope).then(value => { if (alive) { setInherited({ ...value, scope }); if (!latest.current.config.profile) latest.current.onChange({ profile: value.selection, scopeId: scope, ...(Object.values(value.bindings).some(ids => ids.length) ? { bindings: value.bindings } : {}) }); } }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [scope]);
  const key = profileKey(selection);
  const { id: profileId, version: profileVersion } = selection;
  useEffect(() => { let alive = true; setError(''); getProfile({ id: profileId, version: profileVersion }).then(value => { if (alive) setProfile(value); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [profileId, profileVersion]);
  useEffect(() => { if (profile && profileKey(profile) === key && catalog.length && owner && inherited?.scope === scope && !config.bindings) latest.current.onChange({ bindings: suggestBindings(profile, catalog, { ...owner, scopeId: scope }) }); }, [profile, key, catalog, owner, config.bindings, inherited, scope]);
  useEffect(() => { cancelSuggestion(); setSuggesting(false); setFeedback(''); setExpanded([]); return cancelSuggestion; }, [scope, key, cancelSuggestion]);
  const suggest = async () => {
    const run = ++suggestionRun.current; setSuggesting(true); setFeedback(''); setError('');
    try {
      const fresh = await traceCatalog(scope);
      if (run !== suggestionRun.current) return;
      const suggested = suggestBindings(profile, fresh, { ...owner, scopeId: scope });
      const current = latest.current.config.bindings || {};
      const bindings = Object.fromEntries(profile.roles.map(role => [role.id, [...new Set([...(current[role.id] || []), ...suggested[role.id]])]]));
      const matched = profile.roles.filter(role => suggested[role.id].length), artifacts = new Set(Object.values(suggested).flat()).size;
      const added = profile.roles.reduce((count, role) => count + bindings[role.id].filter(id => !(current[role.id] || []).includes(id)).length, 0);
      setCatalog(fresh); latest.current.onChange({ bindings }); setExpanded(matched.map(role => role.id));
      setFeedback(artifacts ? `Found ${artifacts} matching artifact${artifacts === 1 ? '' : 's'} across ${matched.length} role${matched.length === 1 ? '' : 's'}. ${added ? `Added ${added} role binding${added === 1 ? '' : 's'}.` : 'All suggested bindings are already selected.'} Existing selections were kept; review the expanded roles below.` : 'No matching artifacts were found for this project and profile. Add the relevant artifacts to this project. Existing selections were kept.');
    } catch (error) { if (run === suggestionRun.current) setError(error.message); }
    finally { if (run === suggestionRun.current) setSuggesting(false); }
  };
  const bindings = config.bindings || {};
  const unavailable = Object.values(bindings).flat().some(id => !catalog.some(meta => meta.id === id));
  return <fieldset><legend>Traceability scheme and source scope</legend>
    <p>The assessment is calculated from saved relationships. Source citations alone do not establish engineering coverage.</p>
    {error && <p role="alert">{error}</p>}
    {unavailable && <p role="alert">Some saved inputs are unavailable or outside this project. <button type="button" onClick={() => onChange({ bindings: Object.fromEntries(Object.entries(bindings).map(([role, ids]) => [role, ids.filter(id => catalog.some(meta => meta.id === id))])) })}>Remove unavailable inputs</button></p>}
    <ProfileSelect value={selection} onChange={profile => onChange({ profile, bindings: null })} />
    <p>{inherited && key === profileKey(inherited.selection) ? 'Uses the owning project’s pinned profile version.' : 'Explicit profile override for this assessment; the project profile stays unchanged.'}</p>
    <label>Assessment stage<select value={config.stage || 'definition'} onChange={event => onChange({ stage: event.target.value })}>{STAGES.map(stage => <option key={stage}>{stage}</option>)}</select></label>
    {profile && <><button type="button" disabled={!owner || !scope || suggesting || profileKey(profile) !== key} onClick={suggest}>{suggesting ? 'Finding matching artifacts…' : 'Suggest role bindings from this project'}</button>{!owner && <p>Choose an owning project to suggest role bindings.</p>}{feedback && <p role="status">{feedback}</p>}<div className="trace-bindings">{profile.roles.map(role => <details key={role.id} open={expanded.includes(role.id)} onToggle={event => { const open = event.currentTarget.open; setExpanded(previous => open === previous.includes(role.id) ? previous : open ? [...previous, role.id] : previous.filter(id => id !== role.id)); }}><summary>{role.label} · {(bindings[role.id] || []).length} bound artifact(s)</summary><p>Applicable object kinds: {role.kinds.join(', ')}. Empty or unavailable roles are reported as not assessed.</p>{catalog.map(meta => <label className="trace-choice" key={meta.id}><input type="checkbox" checked={(bindings[role.id] || []).includes(meta.id)} onChange={event => onChange({ bindings: { ...bindings, [role.id]: event.target.checked ? [...bindings[role.id] || [], meta.id] : (bindings[role.id] || []).filter(id => id !== meta.id) } })} />{meta.title} ({meta.templateId})</label>)}{!catalog.length && <p>Add source artifacts to this project before binding this role.</p>}</details>)}</div></>}
  </fieldset>;
}
