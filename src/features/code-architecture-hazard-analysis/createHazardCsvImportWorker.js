export default function createHazardCsvImportWorker(){return new Worker(new URL('./hazardCsvImportWorker.js',import.meta.url));}
