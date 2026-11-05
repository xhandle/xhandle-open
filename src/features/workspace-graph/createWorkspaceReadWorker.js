export default function createWorkspaceReadWorker(){return new Worker(new URL('./workspaceReadWorker.ts',import.meta.url));}
