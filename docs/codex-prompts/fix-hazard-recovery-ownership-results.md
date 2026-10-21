# Recovery ownership fix

The registry now tracks the underlying worker separately from the immediately cancellable UI task. Stop remains immediate, but finishing the UI task no longer removes ownership while background recovery is pending. Late updates are accepted only from the registered attempt; after cancellation, only incomplete recovery (including an incomplete pending attempt attached to prior completed output) is accepted.

App now uses that acceptance gate before retaining and showing a partial result. Visibility additionally requires the same project/repository scope. Replaced or discarded attempts cannot update the registry or visible result. Failed saves remain retained for retry/export. Once background work settles, saved results release registry ownership; pending saves remain retained.

Validation: 7 suites / 55 tests passed. Integration uses the real runner, abortable task and registry with failed mocked persistence, reproducing the former Stop race and verifying visible/registry retention. Additional tests cover replacement, deletion, cancelled completed output, and cleanup after successful recovery. Existing runner, store, save wait and cancellation tests pass. This is not a live Safari or full mounted-App test. No live AI calls or customer data changes. Database schema and serialized writes unchanged.

Production build status is reported in the final response. Changes are not committed or pushed.
