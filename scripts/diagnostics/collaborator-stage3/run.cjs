// Reuse the isolated native runtime harness, with additional Stage 3 reads.
process.env.XHANDLE_AUDIT_TEMPLATE=require('path').join(__dirname,'entry.template.js');
require('../collaborator-stage2/run.cjs');
