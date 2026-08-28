// DuckDB-Wasm bootstrap + S3 Tables helpers.
import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

// duckdb-wasm release this package wraps; extension URLs must match it.
export const DUCKDB_VERSION = 'v1.5.5';

const BUNDLES = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

let db = null;
let conn = null;

export async function boot(log) {
  if (conn) return conn;
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker, { type: 'classic' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ path: ':memory:', allowUnsignedExtensions: true });
  conn = await db.connect();
  const v = await query('PRAGMA version');
  log(`DuckDB-Wasm booted: ${v[0].library_version}`);
  return conn;
}

export async function query(sql) {
  const result = await conn.query(sql);
  return result.toArray().map((r) => r.toJSON());
}

export async function loadExtensions(log) {
  // Locally built aws extension (the duckdb-wasm#1919 fix) served from this app.
  await query(`LOAD '${window.location.origin}/extensions/aws.duckdb_extension.wasm'`);
  log('LOAD aws (locally built via the duckdb-aws wasm patches): OK');
  await query(`LOAD 'https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/httpfs.duckdb_extension.wasm'`);
  await query(`LOAD 'https://extensions.duckdb.org/${DUCKDB_VERSION}/wasm_eh/iceberg.duckdb_extension.wasm'`);
  log('LOAD httpfs + iceberg (official wasm builds): OK');
}

const esc = (v) => String(v).replace(/'/g, "''");

export async function connectCatalog({ key, secret, token, region, bucketArn }, log) {
  await query(`DROP SECRET IF EXISTS s3tables_demo`);
  await query(`CREATE SECRET s3tables_demo (
      TYPE S3,
      KEY_ID '${esc(key)}',
      SECRET '${esc(secret)}',
      SESSION_TOKEN '${esc(token)}',
      REGION '${esc(region)}'
  )`);
  log('CREATE SECRET: OK');
  await query(`ATTACH IF NOT EXISTS '${esc(bucketArn)}' AS s3t (TYPE iceberg, ENDPOINT_TYPE s3_tables)`);
  log(`ATTACH ${bucketArn} AS s3t: OK`);
}
