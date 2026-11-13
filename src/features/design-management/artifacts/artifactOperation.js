// Keep the original exception for debugging while identifying the failed step
// in the form. Do not include source payloads in diagnostic output.
export async function artifactOperation(stage, operation) {
  try { return await operation(); }
  catch (cause) {
    if (cause.artifactStage) throw cause;
    const error = new Error(`${stage}: ${cause.message || 'The operation could not be completed.'}`);
    error.cause = cause;
    error.artifactStage = stage;
    throw error;
  }
}
