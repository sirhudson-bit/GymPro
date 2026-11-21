// بررسی شکل خطای node-zklib وقتی دستگاه در دسترس نیست
const ZKLib = require('node-zklib');

const target = process.argv[2] ?? '10.255.255.1';
const zk = new ZKLib(target, 4370, 2000, 1500);
const done = (label, e) => {
  const info = {
    label,
    typeofError: typeof e,
    ctor: e && typeof e === 'object' ? e.constructor?.name : null,
    keys: e && typeof e === 'object' ? Object.keys(e) : null,
    message: e?.message ?? null,
    code: e?.code ?? null,
    errno: e?.errno ?? null,
    asString: String(e).slice(0, 200),
  };
  console.log(JSON.stringify(info, null, 1));
  process.exit(0);
};

zk.createSocket()
  .then(() => done('connected', null))
  .catch((e) => done('rejected', e));

setTimeout(() => done('timeout-no-rejection', null), 8000);
