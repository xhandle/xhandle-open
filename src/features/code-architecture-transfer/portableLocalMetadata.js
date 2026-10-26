// Per-request telemetry is diagnostic history, not analysis results or resume
// state. Keep summary metrics and all other metadata. Never mutate source storage.
export function portableLocalMetadata(key, text) {
  if(!key.startsWith('cbaMeta:') || typeof text!=='string')return text;
  let value;try{value=JSON.parse(text);}catch{return text;}
  if(!value || typeof value!=='object' || !Array.isArray(value.metrics?.calls))return text;
  const {calls,...metrics}=value.metrics;
  return JSON.stringify({...value,metrics});
}
