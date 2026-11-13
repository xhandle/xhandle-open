export default function createArtifactWorker() {
  return new Worker(new URL('./artifactWorker.js', import.meta.url));
}
