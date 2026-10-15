export default function createHazardDraftWorker(){
 return new Worker(new URL('./hazardDraftWorker.js',import.meta.url));
}
