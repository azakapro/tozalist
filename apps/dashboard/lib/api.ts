'use client'

/** Minimal client for the /internal session API: cookies + CSRF header. */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

let csrfToken: string | null = null

export function setCsrfToken(token: string): void {
  csrfToken = token
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken !== null && init.method === 'POST' ? { 'X-CSRF-Token': csrfToken } : {}),
      ...init.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as {
    data?: T
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new ApiError(response.status, body.error?.message ?? 'Request failed')
  }
  return body.data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
}
