require('./dev-process-diagnostics').installDevProcessDiagnostics('API');
process.env.LOCAL_DEV = process.env.LOCAL_DEV || 'true';
process.env.PORT = process.env.PORT || '5001';

const app = require('../server');
const { logger } = require('../server/logger');
const listener = app.listen(Number(process.env.PORT), process.env.HOST || undefined, () => {
  logger.debug(`🚀 Server running at http://localhost:${listener.address().port}`);
});
