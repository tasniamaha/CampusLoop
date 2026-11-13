// Shared browser-side helpers for calling the API. Every call goes through the /api/backend proxy,
// which attaches the bearer token from the httpOnly cookie. Callers handle `status === 401` by
// sending the user to /login (the session can expire mid-use).

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message || `Request failed (${response.status})`;
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(`/api/backend${path}`, { cache: 'no-store', ...init });
  if (!response.ok) return { ok: false, status: response.status, message: await readError(response) };
  return { ok: true, data: (await response.json()) as T };
}

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Only plain file names from Content-Disposition; anything else falls back. */
function downloadName(header: string | null, fallback: string): string {
  const name = header?.match(/filename="([^"]+)"/)?.[1];
  return name && /^[\w.-]{1,100}$/.test(name) ? name : fallback;
}

/**
 * Downloads a file (e.g. an admin CSV export) through the proxy. Fetched first, so an error such as
 * "too many rows" (422) is shown to the user instead of being saved as the file.
 */
export async function download(path: string, fallbackName: string): Promise<ApiResult<{ filename: string }>> {
  const response = await fetch(`/api/backend${path}`, { cache: 'no-store' });
  if (!response.ok) return { ok: false, status: response.status, message: await readError(response) };
  const filename = downloadName(response.headers.get('content-disposition'), fallbackName);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: the click has started the download by then.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, data: { filename } };
}

// ---------------- URL search params ----------------

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** A repeated query param (?a=1&a=2) counts as its first value. */
export const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A positive page number, or 1 for anything else (missing, 0, negative, huge, not a number). */
export const parsePage = (value: string | string[] | undefined): number => {
  const page = firstParam(value);
  return page && /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1;
};
