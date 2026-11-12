import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(manifest.private, true, "Keep accidental npm publication disabled");
assert.deepEqual(manifest.pi.extensions, ["./index.ts"], "Load only the production entry, not diagnostic tools/tests");
assert.equal(manifest.dependencies, undefined, "Runtime should use Pi's own host modules");
for (const name of ["index.ts", "transport.mjs", "README.md", "LICENSE", "test/transport.test.mjs", "test/live-probe.ts"]) {
  await access(join(root, name));
}
const bytes = Buffer.from("zstd runtime capability check");
assert.deepEqual(zstdDecompressSync(zstdCompressSync(bytes)), bytes);
console.log(`PASS: ${manifest.name}@${manifest.version}; manifest, files and Node zstd support`);
