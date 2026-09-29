// The persisted projects array also defines the order within each folder.
export function reorderProject(projects, projectId, targetId, position = "before") {
  if (projectId === targetId) return projects;
  const project = projects.find((item) => item.id === projectId);
  const target = projects.find((item) => item.id === targetId);
  if (!project || !target) return projects;
  const result = projects.filter((item) => item.id !== projectId);
  const targetIndex = result.findIndex((item) => item.id === targetId);
  const moved = (project.folderId || null) === (target.folderId || null)
    ? project : { ...project, folderId: target.folderId || null };
  result.splice(targetIndex + (position === "after" ? 1 : 0), 0, moved);
  return result;
}
