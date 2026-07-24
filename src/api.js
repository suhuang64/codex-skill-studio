const params = new URLSearchParams(location.search);
const token = params.get('token') || sessionStorage.getItem('skill-manager-token') || '';
if (token) {
    sessionStorage.setItem('skill-manager-token', token);
    history.replaceState({}, '', location.pathname);
}
export async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'x-session-token': token, ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || '请求失败');
    return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = (path) => api(path, { method: 'DELETE' });
