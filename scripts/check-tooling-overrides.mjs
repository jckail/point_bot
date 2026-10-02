import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { runInNewContext } from "node:vm";

// Exercise the actual callers whose obsolete transitive dependencies are
// overridden. Audit success alone does not establish API compatibility.
const require = createRequire(import.meta.url);
const kitRequire = createRequire(require.resolve("@esbuild-kit/core-utils"));
assert.equal(kitRequire("esbuild").version, "0.25.12");
const transforms = require("@esbuild-kit/core-utils");
const cjs = transforms.transformSync("const value: number = 42; module.exports = value;", "/tmp/pointup-tooling-smoke.cts");
const sandbox = { module: { exports: {} }, exports: {} };
runInNewContext(cjs.code, sandbox);
assert.equal(sandbox.module.exports, 42);
assert.ok(cjs.map);
const esm = await transforms.transform("export const value: number = 42;", "/tmp/pointup-tooling-smoke.mts");
assert.match(esm.code, /export/);
assert.ok(esm.map);

const hyperidRequire = createRequire(require.resolve("hyperid"));
const uuid = hyperidRequire("uuid");
const buffer = Buffer.alloc(16);
assert.equal(uuid.v4(undefined, buffer, 0), buffer);
assert.equal(buffer[6] >> 4, 4);
assert.equal(buffer[8] >> 6, 2);
assert.match(uuid.v4(), /^[0-9a-f-]{36}$/);
const hyperid = require("hyperid");
const generate = hyperid({ urlSafe: true, maxInt: 2 });
const ids = Array.from({ length: 5 }, () => generate());
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(ids.map(id => hyperid.decode(id, { urlSafe: true }).count), [0, 1, 0, 1, 0]);

// Bounded synthetic loopback requests, never an external load test.
const received = [];
const server = createServer((request, response) => {
  received.push(request.url);
  response.end("ok");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const result = await new Promise((resolve, reject) => require("autocannon")({
    url: `http://127.0.0.1:${server.address().port}/[<id>]`,
    connections: 1, amount: 5, idReplacement: true,
  }, (error, result) => error ? reject(error) : resolve(result)));
  assert.equal(result.errors, 0);
  assert.ok(received.length >= 5);
  assert.ok(received.every(path => !path.includes("<id>") && hyperid.decode(path.slice(1), { urlSafe: true })));
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log("Tooling override compatibility passed: core-utils transforms, UUID buffer/CJS, hyperid rollover, autocannon loopback.");
