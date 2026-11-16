const fs = require('node:fs');
const path = require('node:path');

// Opt-in only: profiling adds overhead and is not part of the latency gate.
exports.startHazardProfiler = async (page, directory) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('HeapProfiler.startSampling', {samplingInterval: 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});
  await session.send('Profiler.start');
  let pending = Promise.resolve(), index = 0, stopped = false;
  const capture = () => {
    pending = pending.then(async () => {
      if (stopped) return;
      const file = path.join(directory, `profile-${String(index++).padStart(3, '0')}.json`);
      const result = {at: new Date().toISOString()};
      try {
        result.heap = await session.send('Runtime.getHeapUsage');
        result.allocations = await session.send('HeapProfiler.getSamplingProfile');
        result.cpu = await session.send('Profiler.stop');
        await session.send('Profiler.start');
      } catch (error) {result.error = error.message;}
      fs.writeFileSync(file, JSON.stringify(result));
    });
    return pending;
  };
  const timer = setInterval(capture, 10000);
  return async () => {
    clearInterval(timer);
    await capture();
    stopped = true;
    await session.detach().catch(() => {});
  };
};
