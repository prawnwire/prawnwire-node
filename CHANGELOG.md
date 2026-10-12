# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-11

### Added

- Published on npm as `@prawnwire/node`.
- `Prawnwire` client with `emails.send`, `emails.sendBatch`, `emails.list`, `emails.get`,
  `suppressions.list`, `suppressions.delete`, `domains.list`, `members.list` and `me`.
- camelCase inputs and outputs mapped to the API's Postmark field names; `to`, `cc`, `bcc` and
  `replyTo` take a string or an array; headers take a record or a list; attachment content takes a
  base64 string or a `Uint8Array`.
- `PrawnwireError` with `status`, `code`, `message` and `retryAfter`, for API errors in both error
  shapes, network failures (`network_error`) and timeouts (`timeout`).
- Zero runtime dependencies. Works on Node 18+, Bun, Deno and edge runtimes through the global
  `fetch`, with a `fetch` option to override it.
- ESM and CommonJS builds with bundled type declarations.
