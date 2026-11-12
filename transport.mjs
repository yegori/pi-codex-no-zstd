import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";

const decompress = promisify(zstdDecompress);
export const MARKER = Symbol.for("yegori.pi.codex-no-zstd.v1");
const MAX_DECODED_BYTES = 512 * 1024 * 1024;

function isCodexResponses(input) {
  try {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    return /\/codex\/responses\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Change only the entity encoding; preserve routing, credentials, signal and response. */
export function identityFetch(baseFetch, stats) {
  return async (input, init) => {
    if (!isCodexResponses(input)) return baseFetch(input, init);
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const headers = new Headers(init?.headers ?? request?.headers);
    if (headers.get("content-encoding")?.trim().toLowerCase() !== "zstd") {
      return baseFetch(input, init);
    }
    const signal = init?.signal ?? request?.signal;
    signal?.throwIfAborted();
    const body = init?.body ?? (request ? await request.clone().arrayBuffer() : undefined);
    let bytes;
    if (ArrayBuffer.isView(body)) bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
    else throw new Error("codex-no-zstd: unsupported compressed request body; request not sent");

    let decoded;
    try {
      decoded = await decompress(bytes, { maxOutputLength: MAX_DECODED_BYTES });
    } catch {
      // Do not include body, headers, or upstream error contents in diagnostics.
      throw new Error("codex-no-zstd: cannot decode compressed request (limit 512 MiB); request not sent");
    }
    signal?.throwIfAborted();
    headers.delete("content-encoding");
    headers.delete("content-length");
    if (stats) {
      stats.requests += 1;
      stats.compressedBytes += bytes.byteLength;
      stats.jsonBytes += decoded.byteLength;
    }
    // No JSON parsing/reserialization, response buffering, retries or tool execution.
    return baseFetch(input, { ...init, headers, body: new Uint8Array(decoded) });
  };
}

/** Install below proxy-router: its routed options.fetch is wrapped, not replaced. */
export function wrapCodexProvider(base, stats) {
  if (base[MARKER]) return base;
  const wrapped = { ...base };
  for (const method of ["stream", "streamSimple"]) {
    if (typeof base[method] !== "function") continue;
    wrapped[method] = (model, context, options) => {
      if (model.api !== "openai-codex-responses") return base[method](model, context, options);
      return base[method](model, context, {
        ...options,
        fetch: identityFetch(options?.fetch ?? globalThis.fetch.bind(globalThis), stats),
      });
    };
  }
  Object.defineProperty(wrapped, MARKER, { value: true });
  return wrapped;
}
