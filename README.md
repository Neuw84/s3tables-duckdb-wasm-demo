# Querying Amazon S3 Tables from DuckDB-Wasm — end-to-end browser demo

DuckDB running **entirely in your browser**, writing to and querying
**Amazon S3 Tables** (Apache Iceberg) — no backend server, no proxy.

This demo exists because the DuckDB `aws` extension is not distributed for
DuckDB-Wasm ([duckdb/duckdb-wasm#1919](https://github.com/duckdb/duckdb-wasm/issues/1919)).
This repository ships a **locally built** `aws.duckdb_extension.wasm`
(`public/extensions/`) produced with the patches in [`patches/`](patches/),
and a small React app that exercises the full flow:

1. **Credentials** — paste temporary AWS credentials (access key, secret,
   session token). They live in React state only and are sent nowhere except
   AWS. DuckDB-Wasm boots, loads the local `aws` extension plus the official
   `httpfs` and `iceberg` wasm extensions, creates an S3 secret, and attaches
   your S3 Tables bucket as an Iceberg catalog.
2. **Generate data** — creates `webdemo.sensor_readings` in the table bucket
   and inserts synthetic IoT readings. These are real Iceberg commits:
   metadata through the S3 Tables REST catalog, parquet data files PUT to the
   table bucket, all SigV4-signed from the browser.
3. **Query** — preset or free-form SQL against the S3 Tables data, rendered
   in the page.

## Why this works

Two things make browser-native S3 Tables access possible:

- The S3 Tables REST catalog endpoint (`s3tables.<region>.amazonaws.com`) and
  the table-bucket data plane both answer CORS preflights with
  `Access-Control-Allow-Origin: *`.
- The DuckDB `iceberg` extension does native SigV4 signing for the REST
  catalog since v1.5, so no AWS SDK networking is needed for the catalog path.

The `aws` extension itself is the missing distribution piece this repo patches
in — and the prerequisite for a future `credential_chain` story in the browser
(which would need a JS-side credential callback in duckdb-wasm; a browser tab
has no env vars, `~/.aws` files, or IMDS to read).

## Run

```sh
npm install
npm run dev
# open http://localhost:5178
```

You need an S3 Tables table bucket and temporary credentials that can use it:

```sh
aws s3tables create-table-bucket --name my-demo-bucket --region us-east-1
aws sts get-session-token   # or assume-role / SSO / etc.
```

Paste the key, secret and session token in step 1, set your table bucket ARN,
and go.

## What's in here

| Path | What |
|---|---|
| `src/` | React app (Vite) |
| `public/extensions/aws.duckdb_extension.wasm` | The `aws` extension built for `wasm_eh`, DuckDB v1.5.5 |
| `patches/duckdb-aws-v1.5-variegata.patch` | Changes to [duckdb-aws](https://github.com/duckdb/duckdb-aws) that make the wasm build work |
| `patches/aws-c-io-overlay-port/` | vcpkg overlay port fixing `aws-c-io` for Emscripten |
| `BUILDING.md` | How to rebuild the extension from source |

## Version pinning

The extension binary embeds the DuckDB version it was built against
(**v1.5.5**) and DuckDB-Wasm refuses mismatched extensions. The app pins
`@duckdb/duckdb-wasm` to a matching release; if you bump one, rebuild the
other (see `BUILDING.md`).

## Security notes

- Use **temporary** credentials, scope them to the demo table bucket, and
  prefer short sessions. The app never persists them.
- The extension is loaded with `allowUnsignedExtensions: true` because it is
  a local, unsigned build.

## License

Demo code: MIT. The compiled extension aggregates
[duckdb-aws](https://github.com/duckdb/duckdb-aws) (MIT),
[DuckDB](https://github.com/duckdb/duckdb) (MIT),
[aws-sdk-cpp](https://github.com/aws/aws-sdk-cpp) and the AWS CRT libraries
(Apache-2.0), [curl](https://curl.se) (curl license),
[OpenSSL](https://www.openssl.org) (Apache-2.0), [s2n](https://github.com/aws/s2n-tls)
(Apache-2.0) and [zlib](https://zlib.net) (zlib license).
