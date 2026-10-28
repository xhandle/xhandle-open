/* global globalThis */
import {openHazardSchema} from './hazardSchema';
import {prepareHazardTableIndex} from './prepareHazardTableIndex';
globalThis.onmessage = async ({data}) => {
  let db;
  try {
    db = await openHazardSchema();
    await prepareHazardTableIndex(db, data.runId, {
      onProgress: progress => globalThis.postMessage({type:'progress', progress}),
    });
    globalThis.postMessage({type:'done'});
  } catch (error) {
    globalThis.postMessage({type:'error', message:error.message});
  } finally { db?.close(); }
};
