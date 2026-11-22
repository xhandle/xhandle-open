// cwd is an isolated run directory: the backend's SQLite file stays disposable.
process.env.LOCAL_DEV='true';
const app=require(process.argv[2]);
const listener=app.listen(0,'127.0.0.1',()=>process.send({backend:`http://127.0.0.1:${listener.address().port}`}));
process.on('SIGTERM',()=>listener.close(()=>process.exit(0)));
