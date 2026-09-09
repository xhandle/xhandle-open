function normalizedFunctionKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedDescription(value) {
  return String(value || '').trim();
}

function updateFunctionDetails(detailsByFunction, label, description, priority) {
  const normalizedLabel = String(label || '').trim();
  const key = normalizedFunctionKey(normalizedLabel);
  if (!key) return;

  const candidateDescription = normalizedDescription(description);
  const current = detailsByFunction.get(key);
  const shouldReplace = !current
    || (!current.description && candidateDescription)
    || (
      candidateDescription
      && priority > current.priority
    )
    || (
      candidateDescription
      && priority === current.priority
      && candidateDescription.length > current.description.length
    );

  if (shouldReplace) {
    detailsByFunction.set(key, {
      label: normalizedLabel,
      description: candidateDescription,
      priority,
    });
  }
}

export function buildFunctionalNodeDetails(rows = []) {
  const detailsByFunction = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    // Source details describe the function's owned responsibility. Target
    // details are receiver-oriented and are therefore a fallback.
    updateFunctionDetails(detailsByFunction, row?.toFunction, row?.toDetails, 1);
    updateFunctionDetails(detailsByFunction, row?.fromFunction, row?.fromDetails, 2);
  });

  return detailsByFunction;
}

export function getFunctionalNodeDetails(detailsByFunction, functionName) {
  return detailsByFunction?.get(normalizedFunctionKey(functionName)) || null;
}
