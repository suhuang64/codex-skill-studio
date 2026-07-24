export async function api(path, options = {}) {
    const headers = {};
    if (options.body !== undefined)
        headers['Content-Type'] = 'application/json';
    const response = await fetch(`/api${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(data.error || '请求失败');
    return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = (path) => api(path, { method: 'DELETE' });
