# @prawnwire/node

The official TypeScript client for the [Prawnwire](https://prawnwire.com) email send API. No runtime
dependencies, strict types, and it runs anywhere `fetch` does: Node 18+, Bun, Deno, Cloudflare Workers
and other edge runtimes.

```sh
npm install @prawnwire/node
# or: pnpm add @prawnwire/node / yarn add @prawnwire/node / bun add @prawnwire/node
```

## Send an email

Create an API key in the Prawnwire console with the `email:send` scope. Send from an address on one of
your verified domains.

```ts
import { Prawnwire } from '@prawnwire/node'

const prawnwire = new Prawnwire() // reads PRAWNWIRE_API_KEY, or pass the key: new Prawnwire('pw_live_...')

const { messageId, submittedAt } = await prawnwire.emails.send({
  from: 'Ada <ada@example.com>',
  to: 'grace@example.org', // or ['grace@example.org', 'linus@example.org']
  subject: 'Welcome',
  text: 'Hi Grace, welcome aboard.',
  html: '<p>Hi Grace, welcome aboard.</p>',
  tag: 'welcome',
  metadata: { plan: 'pro' },
  attachments: [{ filename: 'guide.pdf', content: pdfBytes, contentType: 'application/pdf' }],
})
```

A message needs `from`, at least one `to`, and `text`, `html` or both. The other fields are `cc`,
`bcc`, `replyTo`, `subject`, `headers` (a record, or a list of `{ name, value }`), `tag`, `metadata`,
`attachments` and `trackOpens` (accepted and ignored until open tracking ships). Attachment `content`
is a base64 string or a `Uint8Array` (a Node `Buffer` works). Several addresses are sent comma-separated,
so put a display name that contains a comma in quotes: `'"Doe, Jane" <jane@example.org>'`.

Limits: 50 recipients across `to`, `cc` and `bcc`, 10 MB per message including attachments.

## Send a batch

`emails.sendBatch` sends up to 500 messages in one request and returns one result per message, in order.
A message the API refuses does not throw; check `ok`.

```ts
const results = await prawnwire.emails.sendBatch(
  users.map((user) => ({
    from: 'Ada <ada@example.com>',
    to: user.email,
    subject: 'Your weekly summary',
    text: summaryFor(user),
  })),
)

for (const [index, result] of results.entries()) {
  if (result.ok) console.log(users[index].email, result.messageId)
  else console.warn(users[index].email, result.errorCode, result.message)
}
```

## Other methods

| Call | Does | Key scope |
|---|---|---|
| `emails.list({ count, offset, status, recipient, fromEmail, tag, subject })` | Page of sent and queued messages: `{ totalCount, messages }` | `email:read` |
| `emails.get(id)` | One message with bodies and delivery events | `email:read` |
| `suppressions.list()` | Addresses the organization will not send to | `email:read` |
| `suppressions.delete(addresses)` | Reactivate addresses | `email:send` |
| `domains.list()` | The organization's domains | `domains:read` |
| `members.list()` | The organization's members | `members:read` |
| `me()` | The organization and key you are authenticated as | none |

Outputs are camelCase: `messageId`, `submittedAt`, `to`, `message`, `totalCount`, `receivedAt`.

## Errors

Every failure is a `PrawnwireError`:

```ts
import { Prawnwire, PrawnwireError } from '@prawnwire/node'

try {
  await prawnwire.emails.send(message)
} catch (error) {
  if (error instanceof PrawnwireError) {
    console.error(error.status, error.code, error.message)
    if (error.status === 429) await sleep((error.retryAfter ?? 60) * 1000)
  } else {
    throw error
  }
}
```

| Property | Meaning |
|---|---|
| `status` | HTTP status. `0` when there was no response. |
| `code` | The API's string code (`"unauthorized"`, `"insufficient_scope"`), the Postmark error code number (`10` invalid key, `300` invalid message, `400` From domain not verified, `405` daily limit, `406` all recipients suppressed, `701` message not found), or a client code. |
| `retryAfter` | Seconds to wait, from `Retry-After` on a 429. |
| `cause` | The underlying error for network failures and timeouts. |

Client codes: `missing_api_key` (no key passed and `PRAWNWIRE_API_KEY` unset), `network_error`, `timeout`
(default 30 seconds, set `timeoutMs`), `invalid_response` and `http_error` (an answer that is not the API's JSON).
The client does not retry on its own.

## Test keys

A key that starts with `pw_test_` runs every check a live key does and answers like a real send, with a
`messageId`, but queues nothing and counts toward no limit. Use it in CI and local development:

```ts
const prawnwire = new Prawnwire(process.env.PRAWNWIRE_TEST_KEY)
```

Test-key message ids do not exist in activity, so `emails.get` on one answers code `701`.

## Options

```ts
new Prawnwire(apiKey?, {
  baseUrl: 'https://api.prawnwire.com/v1', // default
  timeoutMs: 30_000, // default; 0 turns the timeout off
  fetch: customFetch, // default: the global fetch
})
```

## Runtime support

Node 18 and newer, Bun, Deno and edge runtimes. The client uses only the global `fetch`,
`AbortController`, `URLSearchParams` and `btoa`, and imports nothing from Node. The API key defaults to
`process.env.PRAWNWIRE_API_KEY` where `process` exists; elsewhere pass it explicitly. It ships ESM and
CommonJS builds with bundled type declarations.

## The API

Prawnwire's send API is Postmark-compatible: same paths under `https://api.prawnwire.com/v1`, same field
names, same error codes. See the [Postmark Email API](https://postmarkapp.com/developer/api/email-api)
for the wire format. This package maps it to camelCase, and Postmark's own libraries also work against
Prawnwire by changing the base URL and token.

## License

MIT
