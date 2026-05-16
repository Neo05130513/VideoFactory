'use client';

export class ApiResponseError extends Error {
  status: number;
  loginRequired: boolean;

  constructor(message: string, status = 500, loginRequired = false) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
    this.loginRequired = loginRequired;
  }
}

export async function readApiJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!isJson) {
    const text = await response.text().catch(() => '');
    const looksLikeLogin = response.redirected || response.url.includes('/login') || text.includes('登录 Video Factory');
    if (looksLikeLogin) {
      throw new ApiResponseError('登录状态已失效，请重新登录后再生成视频。', 401, true);
    }
    throw new ApiResponseError(`${fallbackMessage}：接口返回了非 JSON 内容`, response.status || 500);
  }

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 401) {
    const authMessage = payload?.error && payload.error !== 'Unauthorized'
      ? payload.error
      : '登录状态已失效，请重新登录后再生成视频。';
    throw new ApiResponseError(authMessage, 401, true);
  }
  if (!response.ok) {
    throw new ApiResponseError(payload?.error || fallbackMessage, response.status || 500);
  }
  return payload as T;
}

export function formatApiClientError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiResponseError && error.loginRequired) {
    window.setTimeout(() => {
      window.location.href = '/login';
    }, 700);
    return `${error.message} 正在跳转登录页...`;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}
