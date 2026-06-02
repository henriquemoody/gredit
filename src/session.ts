import { resolve } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { Config } from './config.ts';

/**
 * A live, authenticated browser session backed by the persistent profile.
 * Call `close()` when finished so cookies are flushed to disk.
 */
export interface Session {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
  /**
   * Run a fetch against the Grafana backend from inside the page context, so
   * the session cookie AND a correct Origin header (needed for Grafana's CSRF
   * check) are attached automatically. Returns parsed JSON.
   */
  apiFetch: <T = unknown>(path: string, init?: RequestInit) => Promise<ApiResult<T>>;
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T;
}

/**
 * Launch (or reuse) the persistent context and land on the Grafana origin.
 * playwright is imported lazily so browser-free commands (lint, help) don't
 * pay for it or require the browser binaries to be installed.
 */
export async function openSession(config: Config): Promise<Session> {
  const { chromium } = await import('playwright');
  const profile = resolve(process.cwd(), config.profileDir);

  const context = await chromium
    .launchPersistentContext(profile, {
      headless: config.headless,
    })
    .catch((err: Error) => {
      if (
        /executable doesn.?t exist|chromium.*not found|browser.*not.*installed/i.test(err.message)
      ) {
        throw new Error("Playwright browser not found. Run 'gredit setup' to download it.");
      }
      throw err;
    });
  const page = context.pages()[0] ?? (await context.newPage());

  // Navigate to the origin first so page-context fetches are same-origin.
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });

  const apiFetch = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
    const url = path.startsWith('http') ? path : `${config.baseUrl}${path}`;
    // Note: init is serialized across the page boundary via page.evaluate, so
    // it must contain only JSON-compatible values (no Headers, AbortSignal, Blob, etc.).
    return page.evaluate(
      async ({ url, init }) => {
        const r = await fetch(url, { credentials: 'include', ...(init as RequestInit) });
        let body: unknown;
        const text = await r.text();
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text; // surface non-JSON (e.g. an Okta HTML redirect page)
        }
        return { status: r.status, ok: r.ok, body };
      },
      { url, init: init ?? {} },
    ) as Promise<ApiResult<T>>;
  };

  return {
    context,
    page,
    apiFetch,
    close: async () => {
      await context.close();
    },
  };
}

/**
 * Heuristic: detect when an API call actually hit an unauthenticated redirect
 * (Okta / Grafana login) instead of the JSON API, so commands can tell the
 * user to re-authenticate rather than printing a confusing parse error.
 */
export function looksUnauthenticated<T>(res: ApiResult<T>): boolean {
  if (res.status === 401 || res.status === 403) return true;
  if (typeof res.body === 'string' && /<!doctype html|<html/i.test(res.body)) return true;
  return false;
}
