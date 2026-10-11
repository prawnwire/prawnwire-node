/** The slice of a fetch Response this client reads. The global `Response` satisfies it. */
export interface FetchResponseLike {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

/** A fetch implementation. The global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponseLike>

/** Options for the {@link Prawnwire} client. */
export interface PrawnwireOptions {
  /** API base URL. Defaults to `https://api.prawnwire.com/v1`. */
  baseUrl?: string
  /** A fetch implementation to use instead of the global `fetch`. */
  fetch?: FetchLike
  /** Per-request timeout in milliseconds. Defaults to 30000. `0` turns the timeout off. */
  timeoutMs?: number
}

/** One address or several. Several are sent comma-separated. */
export type AddressInput = string | readonly string[]

/** Custom headers as a record, or as a list of name and value pairs. */
export type EmailHeaders = Readonly<Record<string, string>> | readonly { name: string; value: string }[]

/** A file attached to a message. */
export interface Attachment {
  /** File name shown to the recipient. Executable and script types are refused by the API. */
  filename: string
  /** Base64 string, or raw bytes (a `Uint8Array` or Node `Buffer`), which are encoded for you. */
  content: string | Uint8Array
  /** MIME type. Defaults to `application/octet-stream` on the server. */
  contentType?: string
  /** Content ID for inline images, referenced from the HTML as `cid:...`. */
  contentId?: string
}

/** A message to send. Provide `text`, `html`, or both. */
export interface EmailMessage {
  /** Sender on one of your verified domains, e.g. `"Ada <ada@example.com>"`. */
  from: string
  /** At least one recipient. At most 50 recipients across `to`, `cc` and `bcc`. */
  to: AddressInput
  cc?: AddressInput
  bcc?: AddressInput
  replyTo?: AddressInput
  subject?: string
  html?: string
  text?: string
  headers?: EmailHeaders
  /** Free-form tag, up to 1000 characters, filterable in message activity. */
  tag?: string
  /** Up to 10 fields, keys up to 20 characters, values up to 80. */
  metadata?: Readonly<Record<string, string>>
  attachments?: readonly Attachment[]
  /** Accepted and ignored by the API until open tracking ships. */
  trackOpens?: boolean
}

/** The answer to a message the API accepted. */
export interface SendResult {
  /** The recipients as submitted (the `to` field). */
  to: string
  /** ISO 8601 timestamp. */
  submittedAt: string
  /** Use it with `emails.get`. */
  messageId: string
  /** Always `0` for an accepted message. */
  errorCode: 0
  message: string
}

/** One accepted message in a batch. */
export interface BatchSent extends SendResult {
  ok: true
}

/** One message in a batch the API refused. Other messages in the batch are unaffected. */
export interface BatchRefused {
  ok: false
  /** The Postmark error code, e.g. `300`, `400`, `405`, `406`. */
  errorCode: number
  message: string
}

/** The answer for one message of a batch, in the order sent. */
export type BatchResult = BatchSent | BatchRefused

export type OutboundStatus = 'queued' | 'sent' | 'failed'

/** Filters for `emails.list`. */
export interface ListEmailsFilters {
  /** Page size, 1 to 500. The API defaults to 50. */
  count?: number
  /** Messages to skip, 0 to 10000. */
  offset?: number
  status?: OutboundStatus
  recipient?: string
  fromEmail?: string
  tag?: string
  subject?: string
}

export interface EmailAddress {
  email: string
  name: string | null
}

/** A message in activity. */
export interface EmailSummary {
  messageId: string
  messageStream: string
  tag: string
  /** `"Queued"`, `"Sent"` or `"Failed"`. */
  status: string
  from: string
  subject: string
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  /** Every recipient address across To, Cc and Bcc. */
  recipients: string[]
  receivedAt: string
  trackOpens: boolean
  trackLinks: string
  metadata: Record<string, string>
  sandboxed: boolean
}

export interface EmailEvent {
  recipient: string
  /** `Queued`, `Sent`, `Delivered`, `Deferred`, `Bounced`, `Suppressed` or `Failed`. */
  type: string
  receivedAt: string
  details: string | null
}

/** A message with its bodies, attachment names and delivery events. */
export interface EmailDetails extends EmailSummary {
  textBody: string
  htmlBody: string
  attachments: string[]
  events: EmailEvent[]
}

export interface EmailList {
  totalCount: number
  messages: EmailSummary[]
}

export interface Suppression {
  emailAddress: string
  /** `"HardBounce"` or `"ManualSuppression"`. */
  suppressionReason: string
  /** `"Recipient"`, `"Customer"` or `"Admin"`. */
  origin: string
  createdAt: string
}

export interface SuppressionDeletion {
  emailAddress: string
  /** `"Deleted"` or `"Failed"`. */
  status: string
  message: string | null
}

export interface Domain {
  domain: string
  status: string
  verifiedAt: string | null
  createdAt: string
}

export interface Member {
  email: string
  name: string | null
  role: string
  joinedAt: string
}

/** The organization and API key the client is authenticated as. */
export interface Me {
  org: { id: string; name: string; slug: string }
  key: { id: string; name: string; prefix: string; scopes: string[]; test: boolean }
}
