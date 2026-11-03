// Engine-parity harness: swaps the Electron sqlite3-CLI adapter for the web
// runtime's SQLite WASM engine *before* any shared-core module is loaded, so
// unchanged Sojourner repositories, migrations, and domain services run on
// the exact engine the PWA uses.
//
// Usage: node --experimental-strip-types --import ./tests/support/wasm-sqlite-preload.mjs <test file>
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  WasmSqliteClient,
  WasmSqliteEngine,
  setActiveWasmSqliteEngine,
} from "../../src/pwa/runtime/wasm-sqlite-engine.ts";

const require = createRequire(import.meta.url);
const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
const engine = new WasmSqliteEngine({
  sqlite3,
  fs,
  dirname: path.dirname,
  revalidateExternalChanges: true,
});
setActiveWasmSqliteEngine(engine);

const sqliteModule = require("../../electron-runtime/electron/src/sqlite.cjs");
sqliteModule.SqliteClient = WasmSqliteClient;
sqliteModule.resolveSqliteBinary = async () => `sqlite-wasm:${engine.version}`;
globalThis.__SOJOURNER_SQL_ENGINE__ = `sqlite-wasm:${engine.version}`;

process.on("exit", (code) => {
  if (code === 0 && engine.operationCount === 0) {
    console.error("WASM engine parity harness: the test never reached the SQLite WASM engine");
    process.exitCode = 1;
    process.reallyExit?.(1);
  }
  if (code === 0) {
    console.log(`[sqlite-wasm parity] ${engine.operationCount} engine operations`);
  }
});
