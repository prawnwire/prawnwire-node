import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Prawnwire, PrawnwireError, type FetchLike, type PrawnwireOptions } from '../src/index'
import { startMock, type Mock, type Reply, type Recorded } from './mock-server'

const KEY = 'pw_test_unit-test-key'

let mock: Mock | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

async function setup(reply: (request: Recorded, index: number) => Reply, options: PrawnwireOptions = {}) {
  mock = await startMock(reply)
  return new Prawnwire(KEY, { baseUrl: mock.url, ...options })
}

async function failure(promise: Promise<unknown>): Promise<PrawnwireError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PrawnwireError)
    return error as PrawnwireError
  }
  throw new Error('expected the call to reject')
}

const accepted = {
  To: 'grace@example.org',
  SubmittedAt: '2026-10-11T09:00:00.000Z',
  MessageID: '8c4f0f0e-0000-4000-8000-000000000001',
  ErrorCode: 0,
  Message: 'OK',
}

describe('constructor', () => {
  const saved = process.env.PRAWNWIRE_API_KEY
  beforeEach(() => {
    delete process.env.PRAWNWIRE_API_KEY
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.PRAWNWIRE_API_KEY
    else process.env.PRAWNWIRE_API_KEY = saved
  })

  it('throws a clear PrawnwireError when no key is given and the environment has none', () => {
    try {
      new Prawnwire()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(PrawnwireError)
      const e = error as PrawnwireError
      expect(e.code).toBe('missing_api_key')
      expect(e.status).toBe(0)
      expect(e.message).toContain('PRAWNWIRE_API_KEY')
    }
  })

  it('treats an empty key as missing', () => {
    expect(() => new Prawnwire('  ')).toThrowError(PrawnwireError)
  })

  it('reads PRAWNWIRE_API_KEY when no key is passed', async () => {
    process.env.PRAWNWIRE_API_KEY = 'pw_test_from-env'
    mock = await startMock(() => ({ body: { org: {}, key: {} } }))
    await new Prawnwire(undefined, { baseUrl: mock.url }).me()
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer pw_test_from-env')
  })

  it('prefers an explicit key over the environment', async () => {
    process.env.PRAWNWIRE_API_KEY = 'pw_test_from-env'
    mock = await startMock(() => ({ body: {} }))
    await new Prawnwire('pw_test_explicit', { baseUrl: mock.url }).me()
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer pw_test_explicit')
  })

  it('does not expose the key when the client is serialized', () => {
    const client = new Prawnwire('pw_live_secret-value')
    expect(JSON.stringify(client)).not.toContain('secret-value')
  })

  it('accepts a fetch override and a base URL with trailing slashes', async () => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
    const fetchStub: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return { status: 200, headers: { get: () => null }, text: async () => '{"org":{},"key":{}}' }
    }
    await new Prawnwire(KEY, { baseUrl: 'https://example.test/v1//', fetch: fetchStub }).me()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://example.test/v1/me')
    expect(calls[0]?.init.method).toBe('GET')
    expect(calls[0]?.init.headers).toEqual({ Authorization: `Bearer ${KEY}`, Accept: 'application/json' })
  })
})

describe('emails.send', () => {
  it('maps every camelCase field to the API field names', async () => {
    const client = await setup(() => ({ body: accepted }))
    const result = await client.emails.send({
      from: 'Ada <ada@example.com>',
      to: ['grace@example.org', 'linus@example.org'],
      cc: 'cc@example.org',
      bcc: ['bcc1@example.org', 'bcc2@example.org'],
      replyTo: 'support@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: { 'X-Entity-Ref-ID': 'abc' },
      tag: 'welcome',
      metadata: { plan: 'pro' },
      attachments: [
        { filename: 'note.txt', content: 'aGk=', contentType: 'text/plain' },
        { filename: 'logo.png', content: new Uint8Array([0, 1, 2, 250, 255]), contentId: 'cid:logo' },
      ],
      trackOpens: true,
    })

    const request = mock!.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/email')
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.headers.accept).toBe('application/json')
    expect(request.json).toStrictEqual({
      From: 'Ada <ada@example.com>',
      To: 'grace@example.org, linus@example.org',
      Cc: 'cc@example.org',
      Bcc: 'bcc1@example.org, bcc2@example.org',
      ReplyTo: 'support@example.com',
      Subject: 'Hello',
      HtmlBody: '<p>Hi</p>',
      TextBody: 'Hi',
      Headers: [{ Name: 'X-Entity-Ref-ID', Value: 'abc' }],
      Tag: 'welcome',
      Metadata: { plan: 'pro' },
      Attachments: [
        { Name: 'note.txt', Content: 'aGk=', ContentType: 'text/plain' },
        { Name: 'logo.png', Content: 'AAEC+v8=', ContentID: 'cid:logo' },
      ],
      TrackOpens: true,
    })
    expect(result).toStrictEqual({
      to: 'grace@example.org',
      submittedAt: '2026-10-11T09:00:00.000Z',
      messageId: '8c4f0f0e-0000-4000-8000-000000000001',
      errorCode: 0,
      message: 'OK',
    })
  })

  it('sends only the fields that were given', async () => {
    const client = await setup(() => ({ body: accepted }))
    await client.emails.send({ from: 'a@example.com', to: 'b@example.org', subject: 'S', text: 'T' })
    expect(Object.keys(mock!.requests[0]!.json).sort()).toEqual(['From', 'Subject', 'TextBody', 'To'])
  })

  it('accepts headers as a list of name and value pairs', async () => {
    const client = await setup(() => ({ body: accepted }))
    await client.emails.send({
      from: 'a@example.com',
      to: 'b@example.org',
      text: 'T',
      headers: [{ name: 'List-Unsubscribe', value: '<mailto:u@example.com>' }, { name: 'X-A', value: '1' }],
    })
    expect(mock!.requests[0]!.json.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<mailto:u@example.com>' },
      { Name: 'X-A', Value: '1' },
    ])
  })

  it('encodes large Uint8Array attachments to the same base64 as Buffer', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
    const client = await setup(() => ({ body: accepted }))
    await client.emails.send({ from: 'a@example.com', to: 'b@example.org', text: 'T', attachments: [{ filename: 'big.bin', content: bytes }] })
    expect(mock!.requests[0]!.json.Attachments[0].Content).toBe(Buffer.from(bytes).toString('base64'))
  })

  it('throws a PrawnwireError with the Postmark ErrorCode on a 422', async () => {
    const client = await setup(() => ({ status: 422, body: { ErrorCode: 400, Message: 'example.com is not a verified domain of this organization.' } }))
    const error = await failure(client.emails.send({ from: 'a@example.com', to: 'b@example.org', text: 'T' }))
    expect(error.name).toBe('PrawnwireError')
    expect(error.status).toBe(422)
    expect(error.code).toBe(400)
    expect(error.message).toBe('example.com is not a verified domain of this organization.')
    expect(error.retryAfter).toBeUndefined()
  })

  it('throws code 10 on a 401 in Postmark shape', async () => {
    const client = await setup(() => ({ status: 401, body: { ErrorCode: 10, Message: 'This API key is not valid.' } }))
    const error = await failure(client.emails.send({ from: 'a@example.com', to: 'b@example.org', text: 'T' }))
    expect([error.status, error.code]).toEqual([401, 10])
  })
})

describe('emails.sendBatch', () => {
  it('posts a list and returns one result per message without throwing for a refusal', async () => {
    const client = await setup(() => ({
      body: [
        accepted,
        { ErrorCode: 400, Message: 'nope.test is not a verified domain of this organization.' },
        { ...accepted, To: 'c@example.org', MessageID: 'id-3' },
      ],
    }))
    const results = await client.emails.sendBatch([
      { from: 'a@example.com', to: 'grace@example.org', text: '1' },
      { from: 'a@nope.test', to: ['x@example.org', 'y@example.org'], text: '2', tag: 't' },
      { from: 'a@example.com', to: 'c@example.org', html: '<p>3</p>' },
    ])

    const request = mock!.requests[0]!
    expect(request.url).toBe('/v1/email/batch')
    expect(request.json).toEqual([
      { From: 'a@example.com', To: 'grace@example.org', TextBody: '1' },
      { From: 'a@nope.test', To: 'x@example.org, y@example.org', TextBody: '2', Tag: 't' },
      { From: 'a@example.com', To: 'c@example.org', HtmlBody: '<p>3</p>' },
    ])
    expect(results).toStrictEqual([
      { ok: true, to: 'grace@example.org', submittedAt: '2026-10-11T09:00:00.000Z', messageId: '8c4f0f0e-0000-4000-8000-000000000001', errorCode: 0, message: 'OK' },
      { ok: false, errorCode: 400, message: 'nope.test is not a verified domain of this organization.' },
      { ok: true, to: 'c@example.org', submittedAt: '2026-10-11T09:00:00.000Z', messageId: 'id-3', errorCode: 0, message: 'OK' },
    ])
  })

  it('throws when the whole batch is refused', async () => {
    const client = await setup(() => ({ status: 422, body: { ErrorCode: 410, Message: 'A batch can have at most 500 messages; this one has 501.' } }))
    const error = await failure(client.emails.sendBatch([]))
    expect([error.status, error.code]).toEqual([422, 410])
  })
})

describe('emails.list', () => {
  const summary = {
    Tag: 'welcome',
    MessageID: 'id-1',
    MessageStream: 'outbound',
    To: [{ Email: 'grace@example.org', Name: null }],
    Cc: [],
    Bcc: [{ Email: 'bcc@example.org', Name: null }],
    Recipients: ['grace@example.org', 'bcc@example.org'],
    ReceivedAt: '2026-10-11T09:00:00.000Z',
    From: '"Ada" <ada@example.com>',
    Subject: 'Hello',
    Status: 'Sent',
    TrackOpens: false,
    TrackLinks: 'None',
    Metadata: { plan: 'pro' },
    Sandboxed: false,
  }

  it('maps filters to query parameters and the answer to camelCase', async () => {
    const client = await setup(() => ({ body: { TotalCount: 1, Messages: [summary] } }))
    const list = await client.emails.list({ count: 10, offset: 20, status: 'sent', recipient: 'grace@example.org', fromEmail: 'ada@example.com', tag: 'welcome', subject: 'Hello there' })

    const url = new URL(mock!.requests[0]!.url, 'http://x')
    expect(url.pathname).toBe('/v1/messages/outbound')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      count: '10',
      offset: '20',
      status: 'sent',
      recipient: 'grace@example.org',
      fromemail: 'ada@example.com',
      tag: 'welcome',
      subject: 'Hello there',
    })
    expect(list).toStrictEqual({
      totalCount: 1,
      messages: [
        {
          messageId: 'id-1',
          messageStream: 'outbound',
          tag: 'welcome',
          status: 'Sent',
          from: '"Ada" <ada@example.com>',
          subject: 'Hello',
          to: [{ email: 'grace@example.org', name: null }],
          cc: [],
          bcc: [{ email: 'bcc@example.org', name: null }],
          recipients: ['grace@example.org', 'bcc@example.org'],
          receivedAt: '2026-10-11T09:00:00.000Z',
          trackOpens: false,
          trackLinks: 'None',
          metadata: { plan: 'pro' },
          sandboxed: false,
        },
      ],
    })
  })

  it('sends no query string when there are no filters', async () => {
    const client = await setup(() => ({ body: { TotalCount: 0, Messages: [] } }))
    expect(await client.emails.list()).toEqual({ totalCount: 0, messages: [] })
    expect(mock!.requests[0]!.url).toBe('/v1/messages/outbound')
  })

  it('throws on an invalid filter the API refuses', async () => {
    const client = await setup(() => ({ status: 422, body: { ErrorCode: 300, Message: 'count must be 1 to 500.' } }))
    const error = await failure(client.emails.list({ count: 0 }))
    expect([error.status, error.code]).toEqual([422, 300])
  })

  it('get returns details with events and encodes the id', async () => {
    const client = await setup(() => ({
      body: {
        ...summary,
        TextBody: 'Hi',
        HtmlBody: '<p>Hi</p>',
        Attachments: ['note.txt'],
        MessageEvents: [
          { Recipient: '', Type: 'Queued', ReceivedAt: '2026-10-11T09:00:00.000Z', Details: {} },
          { Recipient: 'grace@example.org', Type: 'Bounced', ReceivedAt: '2026-10-11T09:01:00.000Z', Details: { Summary: '550 5.1.1 no such user' } },
        ],
      },
    }))
    const details = await client.emails.get('a/b id')
    expect(mock!.requests[0]!.url).toBe('/v1/messages/outbound/a%2Fb%20id/details')
    expect(details.messageId).toBe('id-1')
    expect(details.textBody).toBe('Hi')
    expect(details.htmlBody).toBe('<p>Hi</p>')
    expect(details.attachments).toEqual(['note.txt'])
    expect(details.events).toEqual([
      { recipient: '', type: 'Queued', receivedAt: '2026-10-11T09:00:00.000Z', details: null },
      { recipient: 'grace@example.org', type: 'Bounced', receivedAt: '2026-10-11T09:01:00.000Z', details: '550 5.1.1 no such user' },
    ])
  })

  it('get throws code 701 for an unknown message', async () => {
    const client = await setup(() => ({ status: 422, body: { ErrorCode: 701, Message: 'This message was not found.' } }))
    const error = await failure(client.emails.get('missing'))
    expect([error.status, error.code]).toEqual([422, 701])
  })
})

describe('suppressions', () => {
  it('list unwraps and renames the dump', async () => {
    const client = await setup(() => ({
      body: { Suppressions: [{ EmailAddress: 'bounced@example.org', SuppressionReason: 'HardBounce', Origin: 'Recipient', CreatedAt: '2026-10-10T00:00:00.000Z' }] },
    }))
    expect(await client.suppressions.list()).toEqual([
      { emailAddress: 'bounced@example.org', suppressionReason: 'HardBounce', origin: 'Recipient', createdAt: '2026-10-10T00:00:00.000Z' },
    ])
    expect(mock!.requests[0]!.method).toBe('GET')
    expect(mock!.requests[0]!.url).toBe('/v1/message-streams/outbound/suppressions/dump')
  })

  it('delete posts the addresses and returns one result per address', async () => {
    const client = await setup(() => ({
      body: {
        Suppressions: [
          { EmailAddress: 'a@example.org', Status: 'Deleted', Message: null },
          { EmailAddress: 'bad', Status: 'Failed', Message: 'Not a valid email address.' },
        ],
      },
    }))
    const results = await client.suppressions.delete(['a@example.org', 'bad'])
    const request = mock!.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/message-streams/outbound/suppressions/delete')
    expect(request.json).toEqual({ Suppressions: [{ EmailAddress: 'a@example.org' }, { EmailAddress: 'bad' }] })
    expect(results).toEqual([
      { emailAddress: 'a@example.org', status: 'Deleted', message: null },
      { emailAddress: 'bad', status: 'Failed', message: 'Not a valid email address.' },
    ])
  })

  it('delete accepts a single address', async () => {
    const client = await setup(() => ({ body: { Suppressions: [] } }))
    await client.suppressions.delete('a@example.org')
    expect(mock!.requests[0]!.json).toEqual({ Suppressions: [{ EmailAddress: 'a@example.org' }] })
  })
})

describe('domains, members and me', () => {
  it('domains.list unwraps data and camelCases the fields', async () => {
    const client = await setup(() => ({
      body: { data: [{ domain: 'example.com', status: 'verified', verified_at: '2026-10-01T00:00:00.000Z', created_at: '2026-09-30T00:00:00.000Z' }] },
    }))
    expect(await client.domains.list()).toEqual([
      { domain: 'example.com', status: 'verified', verifiedAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-09-30T00:00:00.000Z' },
    ])
    expect(mock!.requests[0]!.url).toBe('/v1/domains')
  })

  it('members.list unwraps data and camelCases the fields', async () => {
    const client = await setup(() => ({
      body: { data: [{ email: 'ada@example.com', name: 'Ada', role: 'admin', joined_at: '2026-09-30T00:00:00.000Z' }] },
    }))
    expect(await client.members.list()).toEqual([{ email: 'ada@example.com', name: 'Ada', role: 'admin', joinedAt: '2026-09-30T00:00:00.000Z' }])
    expect(mock!.requests[0]!.url).toBe('/v1/members')
  })

  it('me returns the organization and key', async () => {
    const body = {
      org: { id: 'o1', name: 'Example', slug: 'example' },
      key: { id: 'k1', name: 'CI', prefix: 'pw_test_abcd', scopes: ['email:send'], test: true },
    }
    const client = await setup(() => ({ body }))
    expect(await client.me()).toEqual(body)
    expect(mock!.requests[0]!.url).toBe('/v1/me')
  })
})

describe('errors', () => {
  it('reads the { error: { code, message } } shape with a string code', async () => {
    const client = await setup(() => ({ status: 403, body: { error: { code: 'insufficient_scope', message: 'This key needs the domains:read scope.' } } }))
    const error = await failure(client.domains.list())
    expect(error.status).toBe(403)
    expect(error.code).toBe('insufficient_scope')
    expect(error.message).toBe('This key needs the domains:read scope.')
  })

  it('reads Retry-After seconds on a 429', async () => {
    const client = await setup(() => ({
      status: 429,
      headers: { 'retry-after': '60' },
      body: { ErrorCode: 429, Message: 'Over 120 requests a minute for this key.' },
    }))
    const error = await failure(client.emails.send({ from: 'a@example.com', to: 'b@example.org', text: 'T' }))
    expect([error.status, error.code, error.retryAfter]).toEqual([429, 429, 60])
  })

  it('reads Retry-After in the { error } shape too, and leaves it undefined when absent', async () => {
    const withHeader = await setup(() => ({ status: 429, headers: { 'retry-after': '7' }, body: { error: { code: 'rate_limited', message: 'Slow down.' } } }))
    const first = await failure(withHeader.me())
    expect([first.code, first.retryAfter]).toEqual(['rate_limited', 7])
    await mock!.close()

    const without = await setup(() => ({ status: 429, body: { error: { code: 'rate_limited', message: 'Slow down.' } } }))
    expect((await failure(without.me())).retryAfter).toBeUndefined()
  })

  it('turns a Retry-After HTTP date in the past into 0 seconds', async () => {
    const client = await setup(() => ({ status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' }, body: { ErrorCode: 429, Message: 'x' } }))
    expect((await failure(client.me())).retryAfter).toBe(0)
  })

  it('ignores Retry-After on other statuses', async () => {
    const client = await setup(() => ({ status: 503, headers: { 'retry-after': '5' }, raw: 'Service Unavailable' }))
    const error = await failure(client.me())
    expect([error.status, error.code, error.retryAfter]).toEqual([503, 'http_error', undefined])
  })

  it('gives http_error for an error body that is not JSON', async () => {
    const client = await setup(() => ({ status: 502, raw: '<html>Bad gateway</html>' }))
    const error = await failure(client.me())
    expect([error.status, error.code]).toEqual([502, 'http_error'])
    expect(error.message).toContain('502')
  })

  it('gives invalid_response for a 200 that is not JSON', async () => {
    const client = await setup(() => ({ raw: 'not json' }))
    const error = await failure(client.me())
    expect([error.status, error.code]).toEqual([200, 'invalid_response'])
  })

  it('gives network_error when the server cannot be reached', async () => {
    const closed = await startMock(() => ({}))
    const url = closed.url
    await closed.close()
    const error = await failure(new Prawnwire(KEY, { baseUrl: url }).me())
    expect([error.status, error.code]).toEqual([0, 'network_error'])
    expect(error.cause).toBeDefined()
  })

  it('gives network_error when a custom fetch rejects', async () => {
    const boom = new TypeError('fetch failed')
    const client = new Prawnwire(KEY, { fetch: async () => { throw boom } })
    const error = await failure(client.me())
    expect([error.status, error.code, error.cause]).toEqual([0, 'network_error', boom])
    expect(error.message).toContain('fetch failed')
  })

  it('gives timeout, a different code, when the server does not answer in time', async () => {
    const client = await setup(() => ({ hang: true }), { timeoutMs: 50 })
    const error = await failure(client.me())
    expect([error.status, error.code]).toEqual([0, 'timeout'])
    expect(error.message).toContain('50 ms')
  })

  it('never puts the API key in an error message', async () => {
    const client = await setup(() => ({ status: 401, body: { ErrorCode: 10, Message: 'This API key is not valid.' } }))
    const error = await failure(client.me())
    expect(JSON.stringify([error.message, error.code, error.status])).not.toContain(KEY)
  })
})
