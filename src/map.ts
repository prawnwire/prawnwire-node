import type {
  Attachment,
  BatchResult,
  EmailAddress,
  EmailDetails,
  EmailHeaders,
  EmailList,
  EmailMessage,
  EmailSummary,
  AddressInput,
  ListEmailsFilters,
  SendResult,
  Suppression,
  SuppressionDeletion,
  Domain,
  Member,
} from './types'

/** Base64 without Buffer, so it runs on every runtime that has `btoa`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const addresses = (value: AddressInput): string => (typeof value === 'string' ? value : value.join(', '))

const headersToWire = (headers: EmailHeaders) =>
  Array.isArray(headers)
    ? (headers as readonly { name: string; value: string }[]).map((h) => ({ Name: h.name, Value: h.value }))
    : Object.entries(headers as Readonly<Record<string, string>>).map(([Name, Value]) => ({ Name, Value }))

const attachmentToWire = (a: Attachment) => ({
  Name: a.filename,
  Content: typeof a.content === 'string' ? a.content : toBase64(a.content),
  ContentType: a.contentType,
  ContentID: a.contentId,
})

/** A camelCase message as the API's Postmark field names. Undefined fields drop out of the JSON. */
export function messageToWire(m: EmailMessage) {
  return {
    From: m.from,
    To: addresses(m.to),
    Cc: m.cc === undefined ? undefined : addresses(m.cc),
    Bcc: m.bcc === undefined ? undefined : addresses(m.bcc),
    ReplyTo: m.replyTo === undefined ? undefined : addresses(m.replyTo),
    Subject: m.subject,
    HtmlBody: m.html,
    TextBody: m.text,
    Headers: m.headers === undefined ? undefined : headersToWire(m.headers),
    Tag: m.tag,
    Metadata: m.metadata,
    Attachments: m.attachments?.map(attachmentToWire),
    TrackOpens: m.trackOpens,
  }
}

export function filtersToQuery(f: ListEmailsFilters): Record<string, string> {
  const pairs: [string, string | number | undefined][] = [
    ['count', f.count],
    ['offset', f.offset],
    ['status', f.status],
    ['recipient', f.recipient],
    ['fromemail', f.fromEmail],
    ['tag', f.tag],
    ['subject', f.subject],
  ]
  const query: Record<string, string> = {}
  for (const [key, value] of pairs) if (value !== undefined) query[key] = String(value)
  return query
}

interface WireSend {
  To: string
  SubmittedAt: string
  MessageID: string
  ErrorCode: number
  Message: string
}

export const sendFromWire = (w: WireSend): SendResult => ({
  to: w.To,
  submittedAt: w.SubmittedAt,
  messageId: w.MessageID,
  errorCode: 0,
  message: w.Message,
})

export function batchFromWire(w: WireSend): BatchResult {
  return w.ErrorCode === 0
    ? { ok: true, ...sendFromWire(w) }
    : { ok: false, errorCode: w.ErrorCode, message: w.Message }
}

interface WireAddress {
  Email: string
  Name: string | null
}

interface WireSummary {
  Tag: string
  MessageID: string
  MessageStream: string
  To: WireAddress[]
  Cc: WireAddress[]
  Bcc: WireAddress[]
  Recipients: string[]
  ReceivedAt: string
  From: string
  Subject: string
  Status: string
  TrackOpens: boolean
  TrackLinks: string
  Metadata: Record<string, string>
  Sandboxed: boolean
}

interface WireDetails extends WireSummary {
  TextBody: string
  HtmlBody: string
  Attachments: string[]
  MessageEvents: { Recipient: string; Type: string; ReceivedAt: string; Details: { Summary?: string } }[]
}

const addressFromWire = (a: WireAddress): EmailAddress => ({ email: a.Email, name: a.Name })

export const summaryFromWire = (w: WireSummary): EmailSummary => ({
  messageId: w.MessageID,
  messageStream: w.MessageStream,
  tag: w.Tag,
  status: w.Status,
  from: w.From,
  subject: w.Subject,
  to: w.To.map(addressFromWire),
  cc: w.Cc.map(addressFromWire),
  bcc: w.Bcc.map(addressFromWire),
  recipients: w.Recipients,
  receivedAt: w.ReceivedAt,
  trackOpens: w.TrackOpens,
  trackLinks: w.TrackLinks,
  metadata: w.Metadata,
  sandboxed: w.Sandboxed,
})

export const detailsFromWire = (w: WireDetails): EmailDetails => ({
  ...summaryFromWire(w),
  textBody: w.TextBody,
  htmlBody: w.HtmlBody,
  attachments: w.Attachments,
  events: w.MessageEvents.map((e) => ({
    recipient: e.Recipient,
    type: e.Type,
    receivedAt: e.ReceivedAt,
    details: e.Details.Summary ?? null,
  })),
})

export const listFromWire = (w: { TotalCount: number; Messages: WireSummary[] }): EmailList => ({
  totalCount: w.TotalCount,
  messages: w.Messages.map(summaryFromWire),
})

export const suppressionFromWire = (w: {
  EmailAddress: string
  SuppressionReason: string
  Origin: string
  CreatedAt: string
}): Suppression => ({
  emailAddress: w.EmailAddress,
  suppressionReason: w.SuppressionReason,
  origin: w.Origin,
  createdAt: w.CreatedAt,
})

export const deletionFromWire = (w: {
  EmailAddress: string
  Status: string
  Message: string | null
}): SuppressionDeletion => ({ emailAddress: w.EmailAddress, status: w.Status, message: w.Message })

export const domainFromWire = (w: {
  domain: string
  status: string
  verified_at: string | null
  created_at: string
}): Domain => ({ domain: w.domain, status: w.status, verifiedAt: w.verified_at, createdAt: w.created_at })

export const memberFromWire = (w: {
  email: string
  name: string | null
  role: string
  joined_at: string
}): Member => ({ email: w.email, name: w.name, role: w.role, joinedAt: w.joined_at })
