import type { NextRequest, NextResponse } from 'next/server';

export interface CookieConfig {
  sessionCookieName: string;
  csrfCookieName: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number; // in seconds
}

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days (604,800s)

/**
 * Returns cookie security configuration according to deployment environment.
 * Production enforces __Host- prefix, Secure flag, Path=/, and no Domain attribute.
 * Local development uses unprefixed cookie names and non-secure cookies over HTTP.
 */
export function getCookieConfig(): CookieConfig {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    sessionCookieName: isProduction ? '__Host-gs_session' : 'gs_session',
    csrfCookieName: isProduction ? '__Host-gs_csrf' : 'gs_csrf',
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Extracts raw session token from request cookies.
 * Tries the production __Host-gs_session first, then falls back to gs_session.
 */
export function getSessionTokenFromRequest(request: NextRequest): string | null {
  const hostCookie = request.cookies.get('__Host-gs_session')?.value;
  if (hostCookie && hostCookie.trim().length > 0) {
    return hostCookie.trim();
  }

  const devCookie = request.cookies.get('gs_session')?.value;
  if (devCookie && devCookie.trim().length > 0) {
    return devCookie.trim();
  }

  return null;
}

/**
 * Extracts raw CSRF token from request cookies.
 * Tries the production __Host-gs_csrf first, then falls back to gs_csrf.
 */
export function getCsrfTokenFromCookie(request: NextRequest): string | null {
  const hostCookie = request.cookies.get('__Host-gs_csrf')?.value;
  if (hostCookie && hostCookie.trim().length > 0) {
    return hostCookie.trim();
  }

  const devCookie = request.cookies.get('gs_csrf')?.value;
  if (devCookie && devCookie.trim().length > 0) {
    return devCookie.trim();
  }

  return null;
}

/**
 * Attaches authenticated session and CSRF cookies to an outgoing HTTP response.
 * Session cookie is strictly HttpOnly; CSRF cookie is non-HttpOnly to allow SPA JavaScript access.
 */
export function setSessionCookies(
  response: NextResponse,
  sessionToken: string,
  csrfToken: string,
): void {
  const config = getCookieConfig();

  // 1. Session cookie: HttpOnly, Secure (prod), Path=/, no Domain
  response.cookies.set({
    name: config.sessionCookieName,
    value: sessionToken,
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
    maxAge: config.maxAge,
  });

  // 2. CSRF cookie: non-HttpOnly (read by browser JS for X-CSRF-Token header)
  response.cookies.set({
    name: config.csrfCookieName,
    value: csrfToken,
    httpOnly: false,
    secure: config.secure,
    sameSite: config.sameSite,
    path: config.path,
    maxAge: config.maxAge,
  });
}

/**
 * Clears session and CSRF cookies on an outgoing HTTP response by setting maxAge = 0.
 * Clears both production and development names to prevent stale cookies across environments.
 */
export function clearSessionCookies(response: NextResponse): void {
  const config = getCookieConfig();

  const cookieNames = Array.from(
    new Set([
      config.sessionCookieName,
      config.csrfCookieName,
      '__Host-gs_session',
      '__Host-gs_csrf',
      'gs_session',
      'gs_csrf',
    ]),
  );

  for (const name of cookieNames) {
    response.cookies.set({
      name,
      value: '',
      httpOnly: name.includes('session'),
      secure: config.secure,
      sameSite: config.sameSite,
      path: config.path,
      maxAge: 0,
    });
  }
}
