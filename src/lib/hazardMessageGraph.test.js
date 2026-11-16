import { captureHazardSnapshot, createHazardGraphTransport, largeHazardMessage } from './hazardMessageGraph';

test('snapshot isolation retains shared cells, cycles, undefined and prototype-named data', () => {
  const row = ['Hazard'], input = { Summary: [row], HARA: [row], absent: undefined };
  input.self = input;
  Object.defineProperty(input, '__proto__', { enumerable: true, value: { description: 'Source fact' } });
  const snapshot = captureHazardSnapshot(input); row[0] = 'Edited';
  expect(snapshot.Summary[0][0]).toBe('Hazard'); expect(snapshot.Summary[0]).toBe(snapshot.HARA[0]);
  expect(snapshot.self).toBe(snapshot); expect(Object.hasOwn(snapshot, 'absent')).toBe(true);
  expect(snapshot.__proto__).toEqual({ description: 'Source fact' });
  expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
});

test('large graph transfer gives input time, preserves aliases and exposes only completed results', async () => {
  const row = ['Hazard', 'x'.repeat(2048)], sheet = Array.from({ length: 600 }, () => [...row]);
  const input = { Summary: sheet, HARA: sheet }, snapshot = captureHazardSnapshot(input);
  let sender, receiver, result, parts = 0, inFlight = 0, peakInFlight = 0;
  sender = createHazardGraphTransport(message => {
    if (message.graph === 'part') { parts++; inFlight++; peakInFlight = Math.max(peakInFlight, inFlight); }
    queueMicrotask(() => receiver.receive(message));
  }, () => {});
  receiver = createHazardGraphTransport(message => {
    if (message.graph === 'ack') inFlight--;
    queueMicrotask(() => sender.receive(message));
  }, (_, value) => { result = value; });
  expect(largeHazardMessage(input)).toBe(true);
  const work = sender.send(1, snapshot); sheet[0][0] = 'Caller edit';
  let serviced = false; setTimeout(() => { serviced = true; }, 0);
  await Promise.resolve(); expect(result).toBeUndefined();
  await work; await Promise.resolve();
  expect(serviced).toBe(true); expect(parts).toBeGreaterThan(1); expect(peakInFlight).toBe(1);
  expect(result.Summary).toBe(result.HARA); expect(result.Summary).toHaveLength(600);
  expect(result.Summary[0][0]).toBe('Hazard'); expect(result.Summary[599][1]).toBe(row[1]);
});

test('a closed transport releases an unacknowledged transfer', async () => {
  const sender = createHazardGraphTransport(() => {}, () => {});
  const work = sender.send(1, { rows: [['Hazard']] });
  const rejected = expect(work).rejects.toThrow('Stopped');
  sender.close(new Error('Stopped')); await rejected;
});
