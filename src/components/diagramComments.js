const COMMENTS_SUFFIX = ':comments:v1';

function clean(value) {
  return String(value ?? '').trim();
}

export function diagramCommentsStorageKey(storageKey) {
  return `${clean(storageKey) || 'diagram'}${COMMENTS_SUFFIX}`;
}

export function normalizeDiagramComment(comment = {}) {
  const targetType = comment.targetType === 'edge' ? 'edge' : 'node';
  const targetId = clean(comment.targetId);
  const text = clean(comment.text);
  if (!targetId || !text) return null;
  return {
    id: clean(comment.id) || `comment:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
    targetType,
    targetId,
    targetLabel: clean(comment.targetLabel),
    text,
    createdAt: clean(comment.createdAt) || new Date().toISOString(),
    updatedAt: clean(comment.updatedAt) || clean(comment.createdAt) || new Date().toISOString(),
  };
}

export function createDiagramComment({ targetType, targetId, targetLabel, text } = {}) {
  return normalizeDiagramComment({ targetType, targetId, targetLabel, text });
}

export function commentsForDiagramTarget(comments = [], targetType, targetId) {
  const normalizedType = targetType === 'edge' ? 'edge' : 'node';
  const normalizedId = clean(targetId);
  return (Array.isArray(comments) ? comments : []).filter((comment) => (
    comment?.targetType === normalizedType && clean(comment?.targetId) === normalizedId
  ));
}

export function loadDiagramComments(storageKey, storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    const raw = storage?.getItem?.(diagramCommentsStorageKey(storageKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : []).map(normalizeDiagramComment).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveDiagramComments(storageKey, comments = [], storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    const normalized = (Array.isArray(comments) ? comments : []).map(normalizeDiagramComment).filter(Boolean);
    storage?.setItem?.(diagramCommentsStorageKey(storageKey), JSON.stringify(normalized));
    return normalized;
  } catch {
    return [];
  }
}
