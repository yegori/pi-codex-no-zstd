import assert from "node:assert/strict";
import { test } from "node:test";
import { zstdCompressSync } from "node:zlib";
import { identityFetch, wrapCodexProvider, MARKER } from "../transport.mjs";

const url = "https://chatgpt.com/backend-api/codex/responses";
const text = JSON.stringify({ text: "Русский текст ✓ 😀", filler: "a".repeat(140000), image: "data:image/png;base64,AAAA" });
const raw = Buffer.from(text);
const compressed = zstdCompressSync(raw);
const options = () => ({ method: "POST", headers: new Headers({ "Content-Encoding": "zstd", "Content-Length": String(compressed.length), "Authorization": "Bearer fake-test-token", "Accept": "text/event-stream" }), body: compressed });
const stats = () => ({ requests: 0, jsonBytes: 0, compressedBytes: 0 });

test("exact JSON bytes, header removal, immutable input, unchanged response and signal", async () => {
  const original = options();
  const signal = new AbortController().signal;
  original.signal = signal;
  const response = new Response("stream-data", { status: 200 });
  const s = stats(); let calls = 0;
  const result = await identityFetch(async (input, init) => {
    calls++; assert.equal(input, url); assert.deepEqual(Buffer.from(init.body), raw);
    assert.equal(init.headers.has("content-encoding"), false);
    assert.equal(init.headers.has("content-length"), false);
    assert.equal(init.headers.get("authorization"), "Bearer fake-test-token");
    assert.equal(init.headers.get("accept"), "text/event-stream");
    assert.equal(init.method, "POST"); assert.equal(init.signal, signal);
    return response;
  }, s)(url, original);
  assert.equal(result, response); assert.equal(calls, 1);
  assert.equal(original.headers.get("content-encoding"), "zstd");
  assert.equal(original.body, compressed);
  assert.deepEqual(s, { requests: 1, jsonBytes: raw.length, compressedBytes: compressed.length });
});

for (const [name, input, init] of [
  ["other provider URL", "https://api.anthropic.com/v1/messages", options()],
  ["OAuth URL", "https://auth.openai.com/oauth/token", options()],
  ["uncompressed JSON", url, { method: "POST", body: text, headers: { "content-type": "application/json" } }],
  ["different encoding", url, { ...options(), headers: { "content-encoding": "gzip" } }],
]) test(`untouched: ${name}`, async () => {
  let calls = 0; const s = stats();
  await identityFetch(async (i, o) => { calls++; assert.equal(i, input); assert.equal(o, init); return new Response(); }, s)(input, init);
  assert.equal(calls, 1); assert.equal(s.requests, 0);
});

test("supports ArrayBuffer and a view with nonzero byteOffset", async () => {
  const storage = Buffer.concat([Buffer.from("pad"), compressed, Buffer.from("end")]);
  for (const body of [new Uint8Array(compressed).buffer, new Uint8Array(storage.buffer, storage.byteOffset + 3, compressed.length)]) {
    await identityFetch(async (_i, o) => { assert.deepEqual(Buffer.from(o.body), raw); return new Response(); })(url, { ...options(), body });
  }
});

test("supports Request object without consuming its original body", async () => {
  const request = new Request(url, options());
  await identityFetch(async (i, o) => {
    assert.equal(i, request); assert.deepEqual(Buffer.from(o.body), raw);
    assert.equal(o.headers.has("content-encoding"), false); return new Response();
  })(request);
  assert.equal(request.bodyUsed, false);
});

for (const [name, body] of [["malformed frame", new Uint8Array([1, 2, 3])], ["unsupported body", "not-a-frame"]]) {
  test(`${name}: fails closed without sending`, async () => {
    let calls = 0;
    await assert.rejects(identityFetch(async () => { calls++; })(url, { ...options(), body }), /codex-no-zstd:/);
    assert.equal(calls, 0);
  });
}

test("aborted requests are not sent, including abort during decoding", async () => {
  for (const alreadyAborted of [true, false]) {
    const controller = new AbortController(); let calls = 0;
    if (alreadyAborted) controller.abort();
    const promise = identityFetch(async () => { calls++; })(url, { ...options(), signal: controller.signal });
    controller.abort(); await assert.rejects(promise, { name: "AbortError" }); assert.equal(calls, 0);
  }
});

test("HTTP errors and network errors are passed through exactly once (no retries)", async () => {
  const response = new Response('{"detail":"Bad Request"}', { status: 400 });
  let calls = 0;
  const result = await identityFetch(async () => { calls++; return response; })(url, options());
  assert.equal(result, response); assert.equal(calls, 1);
  const error = new Error("synthetic network error"); calls = 0;
  await assert.rejects(identityFetch(async () => { calls++; throw error; })(url, options()), e => e === error);
  assert.equal(calls, 1);
});

test("delegates both native stream methods; preserves metadata/auth/catalog/non-chat methods", async () => {
  const auth = {}; const getModels = () => []; const classify = () => "classifier";
  const context = { messages: [] }; const marker = {};
  let calls = 0;
  const base = { id: "openai-codex", auth, getModels, classify };
  for (const method of ["stream", "streamSimple"]) base[method] = (model, ctx, opts) => {
    calls++; assert.equal(ctx, context); assert.equal(opts.onPayload, marker);
    assert.equal(opts.transport, "sse"); return opts.fetch(url, options());
  };
  const wrapped = wrapCodexProvider(base, stats());
  assert.equal(wrapped.auth, auth); assert.equal(wrapped.getModels, getModels); assert.equal(wrapped.classify, classify);
  assert.equal(wrapped[MARKER], true); assert.equal(wrapCodexProvider(wrapped), wrapped);
  let routed = 0;
  const fetch = async (_input, init) => { routed++; assert.deepEqual(Buffer.from(init.body), raw); return new Response(); };
  for (const method of ["stream", "streamSimple"]) await wrapped[method]({ api: "openai-codex-responses" }, context, { fetch, onPayload: marker, transport: "sse" });
  assert.equal(calls, 2); assert.equal(routed, 2);
});

test("proxy-router composition: routed fetch is not bypassed", async () => {
  let proxyRequests = 0;
  const base = { streamSimple: (_model, _context, opts) => opts.fetch(url, options()) };
  const inner = wrapCodexProvider(base, stats());
  const proxy = { streamSimple: (m, c, o) => inner.streamSimple(m, c, { ...o, fetch: async (_input, init) => {
    proxyRequests++; assert.deepEqual(Buffer.from(init.body), raw); return new Response();
  }, transport: "sse" }) };
  await proxy.streamSimple({ api: "openai-codex-responses" }, { messages: [] }, {});
  assert.equal(proxyRequests, 1);
});

test("non-Codex API on the provider receives original options", () => {
  const opts = { fetch() {} }; const context = {};
  const base = { streamSimple: (_m, c, o) => { assert.equal(c, context); assert.equal(o, opts); return 42; } };
  assert.equal(wrapCodexProvider(base).streamSimple({ api: "openai-responses" }, context, opts), 42);
});
