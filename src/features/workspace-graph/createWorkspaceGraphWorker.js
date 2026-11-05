export default function createWorkspaceGraphWorker(){return new Worker(new URL('./workspaceGraphIndexWorker.ts',import.meta.url));}
