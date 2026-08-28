import { useCallback, useRef, useState } from 'react';
import { boot, loadExtensions, connectCatalog, query } from './duck.js';
import './App.css';

const DEFAULT_ARN = 'arn:aws:s3tables:<region>:<account-id>:bucket/<table-bucket>';
const SCHEMA = 'webdemo';
const TABLE = 'sensor_readings';
const FQT = `s3t.${SCHEMA}.${TABLE}`;

const PRESET_QUERIES = [
  {
    label: 'Preview rows',
    sql: `SELECT * FROM ${FQT} ORDER BY ts LIMIT 15`,
  },
  {
    label: 'Stats per sensor',
    sql: `SELECT sensor_id,
       count(*)::INT AS readings,
       round(avg(temperature), 1) AS avg_temp,
       round(min(temperature), 1) AS min_temp,
       round(max(temperature), 1) AS max_temp,
       round(avg(humidity), 1) AS avg_humidity
FROM ${FQT}
GROUP BY sensor_id
ORDER BY sensor_id`,
  },
  {
    label: 'Hottest 10 readings',
    sql: `SELECT sensor_id, ts, round(temperature, 1) AS temperature
FROM ${FQT}
ORDER BY temperature DESC
LIMIT 10`,
  },
];

function ResultTable({ rows }) {
  if (!rows) return null;
  if (!rows.length) return <p className="muted">(no rows)</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StepCard({ n, title, done, enabled, children }) {
  return (
    <section className={`card ${enabled ? '' : 'disabled'}`}>
      <h2>
        <span className={`badge ${done ? 'done' : ''}`}>{done ? '✓' : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const [creds, setCreds] = useState({ key: '', secret: '', token: '', region: 'us-east-1', bucketArn: DEFAULT_ARN });
  const [log, setLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowCount, setRowCount] = useState(100);
  const [generated, setGenerated] = useState(null);
  const [sql, setSql] = useState(PRESET_QUERIES[0].sql);
  const [rows, setRows] = useState(null);
  const [queryMs, setQueryMs] = useState(null);
  const [error, setError] = useState(null);
  const logRef = useRef(null);

  const pushLog = useCallback((m) => {
    setLog((l) => [...l, m]);
    queueMicrotask(() => logRef.current?.scrollTo(0, 1e9));
  }, []);

  const guard = (fn) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      pushLog(`ERROR: ${e.message.split('\n')[0]}`);
    } finally {
      setBusy(false);
    }
  };

  const onConnect = guard(async () => {
    await boot(pushLog);
    await loadExtensions(pushLog);
    await connectCatalog(creds, pushLog);
    const tables = await query('SHOW ALL TABLES');
    pushLog(`Catalog attached; ${tables.length} table(s) visible.`);
    setConnected(true);
  });

  const onGenerate = guard(async () => {
    pushLog(`Generating ${rowCount} sensor readings…`);
    await query(`CREATE SCHEMA IF NOT EXISTS s3t.${SCHEMA}`);
    await query(`DROP TABLE IF EXISTS ${FQT}`);
    await query(`CREATE TABLE ${FQT} (
        sensor_id VARCHAR,
        ts TIMESTAMP,
        temperature DOUBLE,
        humidity DOUBLE
    )`);
    await query(`INSERT INTO ${FQT}
      SELECT
        'sensor-' || (range % 5 + 1),
        NOW()::TIMESTAMP - INTERVAL (range) MINUTE,
        18 + random() * 14,
        35 + random() * 40
      FROM range(${Number(rowCount) || 100})`);
    const [{ n }] = await query(`SELECT count(*)::INT AS n FROM ${FQT}`);
    pushLog(`Wrote ${n} rows to ${FQT} (Iceberg commit against S3 Tables).`);
    setGenerated(n);
  });

  const onQuery = guard(async () => {
    const t0 = performance.now();
    const result = await query(sql);
    setQueryMs(Math.round(performance.now() - t0));
    setRows(result);
    pushLog(`Query returned ${result.length} row(s).`);
  });

  return (
    <main>
      <header>
        <h1>DuckDB-Wasm × Amazon S3 Tables</h1>
        <p>
          End-to-end in this browser tab: the locally built <code>aws</code> extension
          (<a href="https://github.com/duckdb/duckdb-wasm/issues/1919" target="_blank" rel="noreferrer">duckdb-wasm#1919</a>),
          plus <code>httpfs</code> and <code>iceberg</code>, writing and querying Iceberg tables in an
          S3 Tables bucket — no backend server involved.
        </p>
      </header>

      <StepCard n="1" title="Credentials & catalog" done={connected} enabled={!busy}>
        <p className="muted">
          Credentials stay in this tab and are only sent to AWS. Use temporary credentials, e.g. from{' '}
          <code>aws sts get-session-token</code> or your SSO tooling of choice.
        </p>
        <div className="grid">
          <label>Access key ID
            <input value={creds.key} onChange={(e) => setCreds({ ...creds, key: e.target.value.trim() })} placeholder="ASIA…" />
          </label>
          <label>Secret access key
            <input type="password" value={creds.secret} onChange={(e) => setCreds({ ...creds, secret: e.target.value.trim() })} />
          </label>
          <label className="wide">Session token
            <textarea rows="2" value={creds.token} onChange={(e) => setCreds({ ...creds, token: e.target.value.trim() })} />
          </label>
          <label>Region
            <input value={creds.region} onChange={(e) => setCreds({ ...creds, region: e.target.value.trim() })} />
          </label>
          <label className="wide">Table bucket ARN
            <input value={creds.bucketArn} onChange={(e) => setCreds({ ...creds, bucketArn: e.target.value.trim() })} />
          </label>
        </div>
        <button onClick={onConnect} disabled={busy || !creds.key || !creds.secret}>
          {connected ? 'Reconnect' : busy ? 'Connecting…' : 'Boot DuckDB & attach catalog'}
        </button>
      </StepCard>

      <StepCard n="2" title="Generate data → write to S3 Tables" done={generated != null} enabled={connected && !busy}>
        <p className="muted">
          Creates <code>{FQT}</code> and inserts synthetic IoT readings. The CREATE TABLE and INSERT are
          real Iceberg commits: metadata via the S3 Tables REST catalog, parquet data files PUT to the
          table bucket — all signed and sent from this tab.
        </p>
        <label className="inline">Rows:{' '}
          <input type="number" min="1" max="100000" value={rowCount} onChange={(e) => setRowCount(e.target.value)} />
        </label>
        <button onClick={onGenerate} disabled={!connected || busy}>
          {busy ? 'Working…' : generated != null ? 'Regenerate' : 'Generate & write'}
        </button>
        {generated != null && <p className="ok">✓ {generated} rows committed to {FQT}</p>}
      </StepCard>

      <StepCard n="3" title="Query it back" done={rows != null} enabled={generated != null && !busy}>
        <div className="presets">
          {PRESET_QUERIES.map((p) => (
            <button key={p.label} className="chip" onClick={() => setSql(p.sql)}>{p.label}</button>
          ))}
        </div>
        <textarea rows="6" value={sql} onChange={(e) => setSql(e.target.value)} spellCheck="false" />
        <button onClick={onQuery} disabled={generated == null || busy}>Run query</button>
        {queryMs != null && <span className="muted"> {queryMs} ms</span>}
        <ResultTable rows={rows} />
      </StepCard>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>Log</h2>
        <pre ref={logRef} className="log">{log.join('\n') || '—'}</pre>
      </section>
    </main>
  );
}
