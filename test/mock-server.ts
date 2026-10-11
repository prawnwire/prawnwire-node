import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Recorded {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
  json: any
}

export interface Reply {
  status?: number
  headers?: Record<string, string>
  body?: unknown
  /** A body sent as is, for non-JSON answers. */
  raw?: string
  /** Never answer, to exercise the timeout. */
  hang?: boolean
}

export interface Mock {
  /** Base URL including /v1. */
  url: string
  requests: Recorded[]
  close(): Promise<void>
}

/** A local HTTP server that records every request and answers with whatever `reply` returns. */
export async function startMock(reply: (request: Recorded, index: number) => Reply): Promise<Mock> {
  const requests: Recorded[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      let json: unknown
      try {
        json = body ? JSON.parse(body) : undefined
      } catch {
        json = undefined
      }
      const recorded: Recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body, json }
      requests.push(recorded)
      const answer = reply(recorded, requests.length - 1)
      if (answer.hang) return
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...answer.headers })
      res.end(answer.raw ?? JSON.stringify(answer.body ?? {}))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
