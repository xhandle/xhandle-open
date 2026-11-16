export default function createHazardStorageWorker() {
  return new Worker(new URL('./hazardStorageWorker.js', import.meta.url));
}
