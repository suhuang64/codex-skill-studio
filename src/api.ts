const params = new URLSearchParams(location.search)
const token = params.get('token') || sessionStorage.getItem('skill-manager-token') || ''
if (token) {
  sessionStorage.setItem('skill-manager-token', token)
  history.replaceState({}, '', location.pathname)
}
export async function api<T = any>(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = { 'x-session-token': token }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data as T
}
export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const patch = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const remove = <T = any>(path: string) => api<T>(path, { method: 'DELETE' })
