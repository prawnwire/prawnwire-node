import { beforeAll, describe, expect, it } from 'vitest'
import { Prawnwire, PrawnwireError } from '../src/index'

// Runs only with PRAWNWIRE_TEST_KEY (a pw_test_ key). A test key validates and answers like a send
// but queues nothing. PRAWNWIRE_BASE_URL points it at another API, e.g. http://localhost:4431/v1.
// PRAWNWIRE_TEST_FROM overrides the From address; by default it is sender@ on the key's first verified domain.
const key = process.env.PRAWNWIRE_TEST_KEY
const baseUrl = process.env.PRAWNWIRE_BASE_URL

describe.skipIf(!key)('integration (test key)', () => {
  let client: Prawnwire
  let scopes: string[] = []
  let from = process.env.PRAWNWIRE_TEST_FROM ?? ''

  beforeAll(async () => {
    if (!key?.startsWith('pw_test_')) throw new Error('PRAWNWIRE_TEST_KEY must be a pw_test_ key; this suite never sends with a live key.')
    client = new Prawnwire(key, baseUrl ? { baseUrl } : {})
    const me = await client.me()
    scopes = me.key.scopes
    expect(me.key.test).toBe(true)
    if (!from && scopes.includes('domains:read')) {
      const domain = (await client.domains.list()).find((d) => d.status === 'verified')
      if (domain) from = `sender@${domain.domain}`
    }
  })

  const needs = (scope: string, ctx: { skip: () => never }) => {
    if (!scopes.includes(scope)) ctx.skip()
  }

  it('me reports a test key with a prefix and scopes', async () => {
    const me = await client.me()
    expect(me.org.id).toBeTruthy()
    expect(me.key.prefix.startsWith('pw_test_')).toBe(true)
    expect(Array.isArray(me.key.scopes)).toBe(true)
  })

  it('send validates and answers like a real send', async (ctx) => {
    needs('email:send', ctx)
    if (!from) ctx.skip()
    const result = await client.emails.send({
      from,
      to: 'integration-test@example.org',
      subject: 'prawnwire-node integration test',
      text: 'Sent with a test key, so nothing is delivered.',
      html: '<p>Sent with a test key, so nothing is delivered.</p>',
      tag: 'prawnwire-node',
      metadata: { suite: 'integration' },
      headers: { 'X-Prawnwire-Test': '1' },
      attachments: [{ filename: 'hello.txt', content: new TextEncoder().encode('hello'), contentType: 'text/plain' }],
    })
    expect(result.errorCode).toBe(0)
    expect(result.to).toBe('integration-test@example.org')
    expect(result.messageId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(Number.isNaN(Date.parse(result.submittedAt))).toBe(false)
  })

  it('send throws PrawnwireError 400 for a domain that is not verified', async (ctx) => {
    needs('email:send', ctx)
    const error = await client.emails
      .send({ from: 'someone@not-a-verified-domain.invalid', to: 'a@example.org', text: 'x' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrawnwireError)
    expect([(error as PrawnwireError).status, (error as PrawnwireError).code]).toEqual([422, 400])
  })

  it('send throws code 300 without a body', async (ctx) => {
    needs('email:send', ctx)
    if (!from) ctx.skip()
    const error = await client.emails.send({ from, to: 'a@example.org', subject: 'no body' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrawnwireError)
    expect((error as PrawnwireError).code).toBe(300)
  })

  it('sendBatch returns a result per message and does not throw for a refused one', async (ctx) => {
    needs('email:send', ctx)
    if (!from) ctx.skip()
    const results = await client.emails.sendBatch([
      { from, to: 'a@example.org', subject: 'one', text: 'one' },
      { from: 'someone@not-a-verified-domain.invalid', to: 'b@example.org', text: 'two' },
      { from, to: ['c@example.org', 'd@example.org'], subject: 'three', html: '<p>three</p>' },
    ])
    expect(results.map((r) => r.ok)).toEqual([true, false, true])
    expect(results[1]).toMatchObject({ ok: false, errorCode: 400 })
  })

  it('get answers 701 for a message a test key never queued', async (ctx) => {
    needs('email:read', ctx)
    const error = await client.emails.get('00000000-0000-4000-8000-000000000000').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrawnwireError)
    expect([(error as PrawnwireError).status, (error as PrawnwireError).code]).toEqual([422, 701])
  })

  it('list returns a page of activity', async (ctx) => {
    needs('email:read', ctx)
    const list = await client.emails.list({ count: 5 })
    expect(typeof list.totalCount).toBe('number')
    expect(Array.isArray(list.messages)).toBe(true)
    expect(list.messages.length).toBeLessThanOrEqual(5)
  })

  it('list rejects count 0 with code 300', async (ctx) => {
    needs('email:read', ctx)
    const error = await client.emails.list({ count: 0 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrawnwireError)
    expect((error as PrawnwireError).code).toBe(300)
  })

  it('suppressions.list returns an array', async (ctx) => {
    needs('email:read', ctx)
    expect(Array.isArray(await client.suppressions.list())).toBe(true)
  })

  it('suppressions.delete reports a result per address', async (ctx) => {
    needs('email:send', ctx)
    const results = await client.suppressions.delete(['integration-not-suppressed@example.org', 'not-an-address'])
    expect(results.map((r) => r.status)).toEqual(['Deleted', 'Failed'])
  })

  it('domains.list returns the organization domains', async (ctx) => {
    needs('domains:read', ctx)
    const domains = await client.domains.list()
    expect(domains.length).toBeGreaterThan(0)
    expect(domains[0]).toHaveProperty('verifiedAt')
  })

  it('members.list returns the organization members', async (ctx) => {
    needs('members:read', ctx)
    const members = await client.members.list()
    expect(members[0]).toHaveProperty('joinedAt')
  })

  it('a wrong key throws PrawnwireError 401', async () => {
    const wrong = new Prawnwire('pw_test_' + 'x'.repeat(43), baseUrl ? { baseUrl } : {})
    const error = await wrong.me().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrawnwireError)
    expect((error as PrawnwireError).status).toBe(401)
    expect((error as PrawnwireError).code).toBe('unauthorized')
  })
})
