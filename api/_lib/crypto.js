import crypto from 'node:crypto'

const algorithm = 'aes-256-gcm'

function requireEnv(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}

function decodeKey(value) {
  const base64 = Buffer.from(value, 'base64')

  if (base64.length === 32) {
    return base64
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex')
  }

  return crypto.createHash('sha256').update(value).digest()
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function randomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url')
}

export function signState(state) {
  const secret = requireEnv('SESSION_SECRET')
  const signature = crypto.createHmac('sha256', secret).update(state).digest('base64url')

  return `${state}.${signature}`
}

export function verifyStateCookie(value) {
  if (!value || !value.includes('.')) {
    return null
  }

  const [state, signature] = value.split('.')
  const expected = signState(state).split('.')[1]

  if (!timingSafeEqualText(signature, expected)) {
    return null
  }

  return state
}

export function encryptJson(payload) {
  const key = decodeKey(requireEnv('TOKEN_ENCRYPTION_KEY'))
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

export function decryptJson(value) {
  const key = decodeKey(requireEnv('TOKEN_ENCRYPTION_KEY'))
  const packed = Buffer.from(value, 'base64url')

  if (packed.length < 29) {
    throw new Error('Invalid encrypted payload')
  }

  const iv = packed.subarray(0, 12)
  const tag = packed.subarray(12, 28)
  const ciphertext = packed.subarray(28)
  const decipher = crypto.createDecipheriv(algorithm, key, iv)

  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}
