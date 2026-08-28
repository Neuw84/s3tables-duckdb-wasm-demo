# Rebuilding `aws.duckdb_extension.wasm` from source

The binary in `public/extensions/` was built from the
[duckdb-aws](https://github.com/duckdb/duckdb-aws) `v1.5-variegata` branch
against DuckDB **v1.5.5**, with the two patches shipped in [`patches/`](patches/).

## Prerequisites

- CMake ≥ 3.30, Ninja, git, pkg-config
- [emsdk](https://github.com/emscripten-core/emsdk) **3.1.71** (the version
  duckdb's extension CI uses)
- [vcpkg](https://github.com/microsoft/vcpkg) at commit
  `84bab45d415d22042bd0b9081aea57f362da3f35` (duckdb-aws's builtin baseline)

```sh
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install 3.1.71 && ./emsdk activate 3.1.71 && cd ..

mkdir vcpkg && cd vcpkg && git init
git remote add origin https://github.com/microsoft/vcpkg.git
git fetch --depth 1 origin 84bab45d415d22042bd0b9081aea57f362da3f35
git checkout FETCH_HEAD && ./bootstrap-vcpkg.sh -disableMetrics && cd ..
```

## Build

```sh
git clone --recurse-submodules https://github.com/duckdb/duckdb-aws
cd duckdb-aws
git checkout v1.5-variegata
git -C duckdb fetch --depth 1 origin tag v1.5.5 && git -C duckdb checkout v1.5.5

# apply the wasm patches from this repo
git apply /path/to/patches/duckdb-aws-v1.5-variegata.patch

# overlay port that fixes aws-c-io for Emscripten
mkdir -p vcpkg-overlay && cp -r /path/to/patches/aws-c-io-overlay-port vcpkg-overlay/aws-c-io

source /path/to/emsdk/emsdk_env.sh
export VCPKG_TOOLCHAIN_PATH=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake
export VCPKG_TARGET_TRIPLET=wasm32-emscripten
export VCPKG_OVERLAY_PORTS=$PWD/vcpkg-overlay
export DUCKDB_PLATFORM=wasm_eh
export WASM_EXTENSIONS=1
export GEN=ninja

make wasm_eh        # configure step; vcpkg builds the whole AWS SDK for wasm
ninja -C build/wasm_eh   # the Makefile's emmake step assumes Make; with GEN=ninja run ninja directly
```

Artifact: `build/wasm_eh/extension/aws/aws.duckdb_extension.wasm`. Copy it to
`public/extensions/` here.

## What the patches do

1. **`aws-c-io` overlay port** — upstream aws-c-io fails CMake configure on
   Emscripten ("Event Loop is not setup on the platform"). The overlay adds an
   Emscripten branch that compiles the POSIX sources without an event loop;
   event-loop creation fails gracefully at runtime. Everything else in the
   dependency tree (openssl, curl, s2n, all other CRT libs, aws-sdk-cpp)
   builds for `wasm32-emscripten` unmodified.
2. **`LINKED_LIBS` in `extension_config.cmake`** — DuckDB's wasm loadable
   extension is produced by a plain `emcc <archive> -sSIDE_MODULE=2` re-link
   that ignores `target_link_libraries`; the SDK static libs must be listed
   explicitly or every `Aws::*` symbol is left unresolved.
3. **`src/wasm_compat.c`** — `ntohs`/`htons`/`ntohl`/`htonl` shims, which the
   duckdb-wasm main module does not export.

A draft PR upstreaming these changes to duckdb-aws is in progress; see the
patch headers for details.
