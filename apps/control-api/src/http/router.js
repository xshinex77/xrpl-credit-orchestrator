import { json } from './json.js'
import { createRateLimiter } from './rate-limit.js'
import { extractBearer, verifyToken, isRoleAllowed } from './auth.js'
import { Roles } from '../../../../packages/shared-types/src/index.js'

function compilePattern(pattern) {
  const parts = pattern.split('/').filter(Boolean)
  const names = []
  const regex = new RegExp(`^/${parts.map((part) => {
    if (part.startsWith(':')) {
      names.push(part.slice(1))
      return '([^/]+)'
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')}/?$`)
  return { regex, names }
}

export class Router {
  constructor(context) {
    this.context = context
    this.routes = []
    this.rateLimiter = createRateLimiter({
      windowMs: context.config.rateLimitWindowMs,
      max: context.config.rateLimitMax
    })
  }

  register(method, pattern, handler, options = {}) {
    const compiled = compilePattern(pattern)
    this.routes.push({ method, pattern, compiled, handler, options })
  }

  async handle(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname
    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = pathname.match(route.compiled.regex)
      if (!match) continue

      const params = {}
      route.compiled.names.forEach((name, idx) => { params[name] = match[idx + 1] })

      // Rate limit key: trust X-Forwarded-For ONLY if TRUST_PROXY=true
      let clientIp = req.socket?.remoteAddress ?? 'local'
      if (process.env.TRUST_PROXY === 'true') {
        const xff = req.headers['x-forwarded-for']
        if (xff) clientIp = String(xff).split(',')[0].trim()
      }
      const rateKey = `${clientIp}:${pathname}`
      const rate = this.rateLimiter.check(rateKey)
      res.setHeader('x-rate-limit-remaining', String(rate.remaining))
      res.setHeader('x-rate-limit-reset', String(rate.resetAt))
      if (!rate.allowed) {
        return json(res, 429, { error: 'rate_limited', resetAt: new Date(rate.resetAt).toISOString() })
      }

      let auth = null
      if (route.options.auth !== false) {
        try {
          const token = extractBearer(req)
          if (!token) return json(res, 401, { error: 'missing_bearer_token' })
          auth = verifyToken(token, this.context.config.authTokenSecret)
          if (route.options.roles && !isRoleAllowed(auth.role, route.options.roles)) {
            return json(res, 403, { error: 'forbidden' })
          }
        } catch (error) {
          return json(res, 401, { error: 'invalid_token', detail: error.message })
        }
      }

      let body = {}
      try {
        body = await this.context.readJson(req)
      } catch (error) {
        if (error.statusCode === 413) {
          return json(res, 413, { error: 'request_body_too_large', detail: 'Maximum body size is 1MB' })
        }
        return json(res, 400, { error: 'invalid_json', detail: error.message })
      }

      try {
        await route.handler({ req, res, body, params, auth, context: this.context })
      } catch (error) {
        return json(res, 500, {
          error: 'internal_error',
          detail: error?.message ?? String(error)
        })
      }
      return
    }
    return json(res, 404, { error: 'not_found' })
  }
}

export const AuthRoles = Roles
