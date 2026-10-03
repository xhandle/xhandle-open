// Layout owns geometry; an explicitly saved description belongs to the user.
export function preserveGroupMetadata(nextBoxes, existingBoxes = []) {
  const identity = box => `${box.elementType || 'subsystem'}:${String(box.label || '').trim().toLowerCase()}`;
  const byId = new Map(existingBoxes.map(box => [box.id, box]));
  const byIdentity = new Map();
  const nextIdentityCounts = new Map();
  for (const box of nextBoxes) {
    const key = identity(box);
    nextIdentityCounts.set(key, (nextIdentityCounts.get(key) || 0) + 1);
  }
  for (const box of existingBoxes) {
    const key = identity(box);
    byIdentity.set(key, byIdentity.has(key) ? null : box);
  }
  return nextBoxes.map(box => {
    const key = identity(box);
    const old = byId.get(box.id) || (nextIdentityCounts.get(key) === 1 ? byIdentity.get(key) : null);
    if (!old || (old.elementType || 'subsystem') !== (box.elementType || 'subsystem')) return box;
    const metadata = {};
    const fields = ['brandColor', 'manualMembership'];
    if (old.descriptionUserEdited) fields.push('description', 'descriptionUserEdited', 'descriptionSource', 'descriptionGeneratedAt');
    fields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(old, field)) metadata[field] = old[field];
    });
    return { ...box, ...metadata };
  });
}
