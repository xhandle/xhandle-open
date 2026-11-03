/* global globalThis */
import {createHazardCsvWorkerEndpoint} from './hazardCsvWorkerProtocol';
globalThis.onmessage=createHazardCsvWorkerEndpoint(message=>globalThis.postMessage(message));
