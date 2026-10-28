export default function createHazardRowsWorker(){return new Worker(new URL('./hazardRowsWorker.js',import.meta.url));}
