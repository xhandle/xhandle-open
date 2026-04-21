process.env.LOCAL_DEV = process.env.LOCAL_DEV || 'true';
process.env.PORT = process.env.PORT || '5001';

require('../server');
