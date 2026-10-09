// Calls to this installation's own Möbius Town service (which talks to the hub).

export class ServiceError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export class HubClient {
  constructor({ appId, token, cid }) {
    this.appId = appId
    this.token = token
    this.cid = cid
  }

  async call(path, body = {}, { timeoutMs = 15000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(`/api/apps/${this.appId}/service/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, cid: this.cid }),
        signal: controller.signal,
      })
    } catch (err) {
      throw new ServiceError(err?.name === 'AbortError' ? 'The town took too long to answer.' : 'You seem to be offline.', 0)
    } finally {
      clearTimeout(timer)
    }
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (res.status === 429) throw new ServiceError('The town is very busy right now.', 429)
    if (!res.ok) {
      const message = data?.error || data?.detail || (res.status === 401
        ? 'Your Möbius session expired. Reopen Möbius Town to keep playing.'
        : `The town could not answer (${res.status}).`)
      throw new ServiceError(typeof message === 'string' ? message : 'The town could not answer.', res.status)
    }
    return data
  }

  hello() {
    return this.call('hello')
  }

  join() {
    return this.call('join', {}, { timeoutMs: 25000 })
  }

  sync(body) {
    return this.call('sync', body)
  }

  act(op, args = {}) {
    return this.call('act', { op, ...args })
  }

  leave() {
    return this.call('leave', {}, { timeoutMs: 4000 }).catch(() => null)
  }
}

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}
