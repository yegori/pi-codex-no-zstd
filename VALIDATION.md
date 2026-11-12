# Validation — 2026-11-12

This report is deliberately sanitized. No private project content, local user paths, original conversation/session IDs, account identifiers, response correlation IDs, tokens or full HTTP traces are included.

## Tested installation

- Pi 1.5.2.
- Node.js 24.18.0, Windows.
- Built-in `openai-codex` provider, model `gpt-6.1-sol`.
- Existing pi-proxy-router 1.2.4 with its normal routed fetch.

## Offline tests

14/14 passed with Node's built-in test runner. Coverage includes byte-identical JSON/Unicode and image data fields; immutable input; header removal; preservation of authorization, signal and response identity; passthrough; ArrayBuffer/view offsets/Request; invalid input; cancellation before/during decoding; no retries for 400/network errors; both provider stream entry points; native metadata/auth/catalog method preservation; idempotence; proxy composition; other API passthrough.

The package check verifies the manifest loads only `index.ts`, required files exist, no runtime dependencies are declared, accidental npm publication is disabled, and Node zstd is available.

## Same-body integration A/B

One synthetic JSON body was supplied through Pi's normal `onPayload` callback: 140,212 bytes, one 140,000-character filler string and an instruction to reply `OK`, no tools, images, history or private documents. Both invocations used Pi's ordinary credential resolution, same model and existing proxy-router.

| Configuration | HTTP result | Model result |
|---|---|---|
| Workaround loaded | 200 | `stop`, text `OK` |
| Control: discovery disabled, only proxy-router and synthetic probe explicitly loaded | 400 | `error`, `{"detail":"Bad Request"}` |

The working runtime reported one transformed request: 140,212 JSON bytes, 206 original zstd bytes. The control failure was expected and exited nonzero. No configuration or historical conversation was changed to run the control.

This establishes an encoding-dependent failure in this environment, not a universal request-size limit or proof of a specific failing backend component. Larger and smaller compressed requests may succeed.

## Agent loop / tool / image continuation

A temporary synthetic tool with no filesystem/network actions returned Unicode text and a valid Pillow-generated PNG (32×32). The model called the tool once and then completed with `PROBE_OK`. Both HTTP requests returned 200; final stop reason was `stop`; process exited successfully. Runtime counters showed two transformed requests.

An initial test fixture contained a PNG with a bad CRC. That attempt failed image decoding after HTTP acceptance. The fixture was corrected and the assertion strengthened to require both semantic completion and the exact final response, rather than HTTP200 alone. Only the corrected test is reported as successful.

## Scope

No actual user work/tool operations were replayed. Existing transcript files, credentials and project documents were not modified or published. Only Windows was live-integration-tested; the CI matrix is intended to exercise offline tests on Linux, macOS and Windows. Other Pi versions, other user profiles and conflicting native provider extensions need separate verification.

## Public references

- [OpenAI Codex #60594](https://github.com/openai/codex/issues/60594): compression-dependent same-input comparisons, including text-only inputs and Pi.
- [OpenAI Codex #59621](https://github.com/openai/codex/issues/59621): opaque Bad Request failures and repeated follow-ups in an image-heavy session; exact cause not established there.
- [Pi packages documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).
