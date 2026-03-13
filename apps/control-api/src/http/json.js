export function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body, null, 2))
}

export function text(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(body)
}

const MAX_BODY_BYTES = 1_048_576 // 1 MB — hard ceiling for any request body

export async function readJson(req) {
  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    totalBytes += chunk.length
    if (totalBytes > MAX_BODY_BYTES) {
      // Drain remaining data to prevent socket hang, then reject
      req.destroy()
      const err = new Error('request_body_too_large')
      err.statusCode = 413
      throw err
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}
