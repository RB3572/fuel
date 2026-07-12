const cookieDefaults = {
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
}

export function isProduction() {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
}

export function parseCookies(req) {
  const header = req.headers.cookie || ''

  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=')

    if (index === -1) {
      return cookies
    }

    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()

    if (!key) {
      return cookies
    }

    cookies[key] = decodeURIComponent(value)
    return cookies
  }, {})
}

export function serializeCookie(name, value, options = {}) {
  const settings = { ...cookieDefaults, secure: isProduction(), ...options }
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (settings.maxAge !== undefined) {
    parts.push(`Max-Age=${settings.maxAge}`)
  }

  if (settings.expires) {
    parts.push(`Expires=${settings.expires.toUTCString()}`)
  }

  if (settings.path) {
    parts.push(`Path=${settings.path}`)
  }

  if (settings.httpOnly) {
    parts.push('HttpOnly')
  }

  if (settings.secure) {
    parts.push('Secure')
  }

  if (settings.sameSite) {
    parts.push(`SameSite=${settings.sameSite}`)
  }

  return parts.join('; ')
}

export function clearCookie(name) {
  return serializeCookie(name, '', {
    maxAge: 0,
    expires: new Date(0),
  })
}

export function setCookies(res, cookies = []) {
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies)
  }
}

export function sendJson(res, statusCode, body, cookies = []) {
  setCookies(res, cookies)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function redirect(res, location, cookies = []) {
  setCookies(res, cookies)
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

export function methodNotAllowed(res, allowed = ['GET']) {
  res.setHeader('Allow', allowed.join(', '))
  sendJson(res, 405, { error: 'Method not allowed' })
}
