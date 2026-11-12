# Changelog

## [1.0.0] - 2026-11-12

- Initial Pi package: decode Codex HTTP/SSE zstd request bodies before the existing fetch sends them.
- Preserve JSON bytes, authentication, routed proxy fetch, cancellation and response streaming.
- Add `/codex-transport` runtime counters, 14 offline tests, a manifest/runtime check, and an opt-in synthetic live probe.
- No retries, no tool re-execution, no credentials or request-body logging.
