import { PrawnwireError } from './errors'
import {
  batchFromWire,
  deletionFromWire,
  detailsFromWire,
  domainFromWire,
  filtersToQuery,
  listFromWire,
  memberFromWire,
  messageToWire,
  sendFromWire,
  suppressionFromWire,
} from './map'
import type {
  BatchResult,
  Domain,
  EmailDetails,
  EmailList,
  EmailMessage,
  FetchLike,
  ListEmailsFilters,
  Me,
  Member,
  PrawnwireOptions,
  SendResult,
  Suppression,
  SuppressionDeletion,
} from './types'

const DEFAULT_BASE_URL = 'https://api.prawnwire.com/v1'
const DEFAULT_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function envApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.PRAWNWIRE_API_KEY
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function tryParse(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return undefined
  }
}

/** The error for a non-2xx answer: Postmark's { ErrorCode, Message } or the API's { error: { code, message } }. */
function responseError(status: number, text: string, retryAfterHeader: string | null): PrawnwireError {
  const body = tryParse(text)?.value
  let code: string | number = 'http_error'
  let message = `Request failed with status ${status}.`
  if (isRecord(body)) {
    if (typeof body.ErrorCode === 'number') {
      code = body.ErrorCode
      if (typeof body.Message === 'string') message = body.Message
    } else if (isRecord(body.error)) {
      if (typeof body.error.code === 'string') code = body.error.code
      if (typeof body.error.message === 'string') message = body.error.message
    }
  }
  return new PrawnwireError({
    status,
    code,
    message,
    retryAfter: status === 429 ? parseRetryAfter(retryAfterHeader) : undefined,
  })
}

class Transport {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #timeoutMs: number
  readonly #fetch: FetchLike

  constructor(apiKey: string, baseUrl: string, timeoutMs: number, fetchImpl: FetchLike | undefined) {
    this.#apiKey = apiKey
    this.#baseUrl = baseUrl.replace(/\/+$/, '')
    this.#timeoutMs = timeoutMs
    // Called as a bare function so Workers and browsers do not see a foreign `this`.
    this.#fetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init))
  }

  async request<T>(method: 'GET' | 'POST', path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const query = options.query && Object.keys(options.query).length ? `?${new URLSearchParams(options.query).toString()}` : ''
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json' }
    const init: Parameters<FetchLike>[1] = { method, headers }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }

    const controller = new AbortController()
    init.signal = controller.signal
    let timedOut = false
    const timer =
      this.#timeoutMs > 0 && Number.isFinite(this.#timeoutMs)
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, this.#timeoutMs)
        : undefined

    let status: number
    let text: string
    let retryAfter: string | null
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}${query}`, init)
      status = response.status
      retryAfter = response.headers.get('retry-after')
      text = await response.text()
    } catch (cause) {
      if (timedOut) {
        throw new PrawnwireError({ status: 0, code: 'timeout', message: `The request timed out after ${this.#timeoutMs} ms.`, cause })
      }
      const reason = cause instanceof Error && cause.message ? `: ${cause.message}` : ''
      throw new PrawnwireError({ status: 0, code: 'network_error', message: `Could not reach the Prawnwire API${reason}`, cause })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }

    if (status < 200 || status >= 300) throw responseError(status, text, retryAfter)
    const parsed = tryParse(text)
    if (!parsed) {
      throw new PrawnwireError({ status, code: 'invalid_response', message: 'The API answered with a body that is not valid JSON.' })
    }
    return parsed.value as T
  }
}

/** Sending, and reading message activity. */
export class EmailsResource {
  readonly #t: Transport

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport
  }

  /**
   * Send one message. Resolves when the API has accepted it for delivery.
   *
   * @throws {PrawnwireError} When the API refuses the message (HTTP 422, with the Postmark
   * `ErrorCode` as `code`), the key is invalid or lacks the `email:send` scope, or the request fails.
   *
   * @example
   * const { messageId } = await prawnwire.emails.send({
   *   from: 'Ada <ada@example.com>',
   *   to: 'grace@example.org',
   *   subject: 'Hello',
   *   text: 'Hi Grace.',
   * })
   */
  async send(message: EmailMessage): Promise<SendResult> {
    return sendFromWire(await this.#t.request('POST', '/email', { body: messageToWire(message) }))
  }

  /**
   * Send up to 500 messages in one request. Resolves with one result per message, in order. A
   * message the API refuses comes back as `{ ok: false, errorCode, message }` instead of throwing.
   *
   * @throws {PrawnwireError} When the whole request fails: invalid key, rate limit, more than 500
   * messages, or a network error.
   */
  async sendBatch(messages: readonly EmailMessage[]): Promise<BatchResult[]> {
    const wire = await this.#t.request<Parameters<typeof batchFromWire>[0][]>('POST', '/email/batch', {
      body: messages.map(messageToWire),
    })
    return wire.map(batchFromWire)
  }

  /**
   * List sent and queued messages, newest first. Needs the `email:read` scope.
   *
   * @example
   * const { totalCount, messages } = await prawnwire.emails.list({ status: 'failed', count: 20 })
   */
  async list(filters: ListEmailsFilters = {}): Promise<EmailList> {
    return listFromWire(await this.#t.request('GET', '/messages/outbound', { query: filtersToQuery(filters) }))
  }

  /**
   * One message with its bodies and delivery events. Needs the `email:read` scope.
   *
   * @throws {PrawnwireError} With code `701` when no message has this id. Test keys queue nothing, so
   * the ids they return are never found.
   */
  async get(id: string): Promise<EmailDetails> {
    return detailsFromWire(await this.#t.request('GET', `/messages/outbound/${encodeURIComponent(id)}/details`))
  }
}

/** Addresses the organization will not send to. */
export class SuppressionsResource {
  readonly #t: Transport

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport
  }

  /** Every suppressed address of the `outbound` stream. Needs the `email:read` scope. */
  async list(): Promise<Suppression[]> {
    const wire = await this.#t.request<{ Suppressions: Parameters<typeof suppressionFromWire>[0][] }>(
      'GET',
      '/message-streams/outbound/suppressions/dump',
    )
    return wire.Suppressions.map(suppressionFromWire)
  }

  /**
   * Reactivate addresses so mail to them is sent again. Needs the `email:send` scope. Resolves with
   * one result per address; an address that is not valid comes back with status `"Failed"`.
   */
  async delete(addresses: string | readonly string[]): Promise<SuppressionDeletion[]> {
    const list = typeof addresses === 'string' ? [addresses] : addresses
    const wire = await this.#t.request<{ Suppressions: Parameters<typeof deletionFromWire>[0][] }>(
      'POST',
      '/message-streams/outbound/suppressions/delete',
      { body: { Suppressions: list.map((EmailAddress) => ({ EmailAddress })) } },
    )
    return wire.Suppressions.map(deletionFromWire)
  }
}

/** The organization's mail domains. */
export class DomainsResource {
  readonly #t: Transport

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport
  }

  /** Needs the `domains:read` scope. */
  async list(): Promise<Domain[]> {
    const wire = await this.#t.request<{ data: Parameters<typeof domainFromWire>[0][] }>('GET', '/domains')
    return wire.data.map(domainFromWire)
  }
}

/** The organization's members. */
export class MembersResource {
  readonly #t: Transport

  /** @internal */
  constructor(transport: Transport) {
    this.#t = transport
  }

  /** Needs the `members:read` scope. */
  async list(): Promise<Member[]> {
    const wire = await this.#t.request<{ data: Parameters<typeof memberFromWire>[0][] }>('GET', '/members')
    return wire.data.map(memberFromWire)
  }
}

/**
 * Client for the Prawnwire send API.
 *
 * @example
 * const prawnwire = new Prawnwire() // reads PRAWNWIRE_API_KEY
 * const prawnwire = new Prawnwire('pw_live_...', { timeoutMs: 10_000 })
 */
export class Prawnwire {
  readonly emails: EmailsResource
  readonly suppressions: SuppressionsResource
  readonly domains: DomainsResource
  readonly members: MembersResource
  readonly #t: Transport

  /**
   * @param apiKey A `pw_live_...` or `pw_test_...` key. Defaults to the `PRAWNWIRE_API_KEY`
   * environment variable where `process.env` exists.
   * @throws {PrawnwireError} With code `missing_api_key` when neither is set.
   */
  constructor(apiKey?: string, options: PrawnwireOptions = {}) {
    const key = (apiKey ?? envApiKey())?.trim()
    if (!key) {
      throw new PrawnwireError({
        status: 0,
        code: 'missing_api_key',
        message: 'No API key. Pass one to new Prawnwire(apiKey) or set the PRAWNWIRE_API_KEY environment variable.',
      })
    }
    this.#t = new Transport(key, options.baseUrl ?? DEFAULT_BASE_URL, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.fetch)
    this.emails = new EmailsResource(this.#t)
    this.suppressions = new SuppressionsResource(this.#t)
    this.domains = new DomainsResource(this.#t)
    this.members = new MembersResource(this.#t)
  }

  /** The organization and key this client is authenticated as, including the key's scopes and whether it is a test key. */
  async me(): Promise<Me> {
    return this.#t.request('GET', '/me')
  }
}
