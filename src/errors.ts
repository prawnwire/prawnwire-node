/** Fields used to build a {@link PrawnwireError}. */
export interface PrawnwireErrorInit {
  status: number
  code: string | number
  message: string
  retryAfter?: number | undefined
  cause?: unknown
}

/**
 * The only error this package throws.
 *
 * - `status` is the HTTP status, or `0` when no response arrived (network failure, timeout) or the
 *   request never left the client (missing API key).
 * - `code` is the API's string code (`"unauthorized"`, `"insufficient_scope"`), the Postmark
 *   `ErrorCode` number (`10`, `300`, `400`, ...), or one of the client's own strings:
 *   `"missing_api_key"`, `"network_error"`, `"timeout"`, `"invalid_response"`, `"http_error"`.
 * - `retryAfter` is the number of seconds to wait before retrying, set from the `Retry-After`
 *   header on a 429.
 */
export class PrawnwireError extends Error {
  override readonly name = 'PrawnwireError'
  readonly status: number
  readonly code: string | number
  readonly retryAfter: number | undefined

  constructor(init: PrawnwireErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.status = init.status
    this.code = init.code
    this.retryAfter = init.retryAfter
  }
}
