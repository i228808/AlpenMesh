const BASE = '/api/v1/economy'

function friendlyMessage(status, payload) {
  // Use whatever the server explicitly sent if it looks like real prose
  const server = payload?.message || payload?.error
  if (server && typeof server === 'string' && server.length < 200) return server

  switch (status) {
    case 400: return 'Please check your details and try again.'
    case 401: return 'Incorrect email or password.'
    case 403: return 'You do not have permission to do that.'
    case 404: return 'Account not found.'
    case 409: return 'An account with this email already exists.'
    case 422: return 'Please check your details and try again.'
    case 429: return 'Too many attempts. Please wait a moment and try again.'
    case 500:
    case 502:
    case 503: return 'Something went wrong on our end. Please try again in a moment.'
    default:  return 'Something went wrong. Please try again.'
  }
}

async function request(path, options = {}) {
  const url = `${BASE}${path}`
  const { headers: userHeaders = {}, ...rest } = options

  let res
  try {
    res = await fetch(url, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...userHeaders },
    })
  } catch {
    throw new ApiError('Unable to connect. Please check your internet connection and try again.', 0, null)
  }

  let payload = {}
  try {
    payload = await res.json()
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    throw new ApiError(friendlyMessage(res.status, payload), res.status, payload)
  }

  return payload?.data !== undefined ? payload.data : payload
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

export const client = {
  get: (path, headers = {}) => request(path, { method: 'GET', headers }),
  post: (path, body, headers = {}) =>
    request(path, { method: 'POST', body: JSON.stringify(body), headers }),
  put: (path, body, headers = {}) =>
    request(path, { method: 'PUT', body: JSON.stringify(body), headers }),
  patch: (path, body, headers = {}) =>
    request(path, { method: 'PATCH', body: JSON.stringify(body), headers }),
  delete: (path, headers = {}) => request(path, { method: 'DELETE', headers }),
}
