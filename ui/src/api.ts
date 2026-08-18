export const AUTH_REQUIRED_EVENT = 'pi-dashboard-auth-required'

export function notifyAuthenticationRequired(): void {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: init?.credentials ?? 'same-origin' })
  if (response.status === 401) notifyAuthenticationRequired()
  return response
}

export async function authenticationRequired(): Promise<boolean> {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin' })
  if (!response.ok) return false
  const status = await response.json() as { enabled?: boolean; authenticated?: boolean }
  return status.enabled === true && status.authenticated !== true
}
