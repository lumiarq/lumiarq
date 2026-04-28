import { boot } from "@lumiarq/framework"
import type { LumiARQApp } from "@lumiarq/framework"

let _app: LumiARQApp | null = null

export async function createTestApp(): Promise<LumiARQApp> {
  if (_app) return _app
  _app = await boot()
  return _app
}

export function resetTestApp(): void {
  _app = null
}

export async function get(
  app: LumiARQApp,
  path: string,
  options: { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return app.router.fetch(
    new Request(`http://localhost${path}`, {
      method: "GET",
      headers: buildHeaders(options),
    }),
  )
}

export async function post(
  app: LumiARQApp,
  path: string,
  body: unknown,
  options: { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return app.router.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildHeaders(options) },
      body: JSON.stringify(body),
    }),
  )
}

export async function json<T = unknown>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

export function expectStatus(response: Response, status: number): void {
  if (response.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${response.status}`)
  }
}

function buildHeaders(options: { token?: string; headers?: Record<string, string> }): Record<string, string> {
  return {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  }
}
