import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/**
 * Checks whether an IP address is in a private, loopback, link-local,
 * cloud-metadata, or reserved network range.
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const normalized = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;

  const version = isIP(normalized);
  if (version === 0) return true; // Invalid IP is blocked

  if (version === 4) {
    const parts = normalized.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [b0, b1] = parts as [number, number, number, number];

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (b0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 169.254.0.0/16 (Link-local & Cloud metadata: 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0) return true;
    // 192.168.0.0/16 (Private network)
    if (b0 === 192 && b1 === 168) return true;
    // 198.18.0.0/15 (Network benchmark tests)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved for future use & broadcast 255.255.255.255)
    if (b0 >= 240) return true;

    return false;
  }

  if (version === 6) {
    const lower = normalized.toLowerCase();

    // Loopback (::1) or Unspecified (::)
    if (lower === '::1' || lower === '::' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') {
      return true;
    }

    // Unique Local Addresses (fc00::/7 -> fc00... to fdff...)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }

    // Link-Local (fe80::/10 -> fe80... to febf...)
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return true;
    }

    return false;
  }

  return true;
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  url?: URL;
}

/**
 * Validates a target URL against SSRF attack vectors:
 * - Scheme must be http: or https:
 * - Hostname cannot be localhost or private IP
 * - Resolves all DNS records and verifies none target internal/cloud networks
 */
export async function validateUrlForOutboundFetch(
  urlString: string,
): Promise<UrlValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variations
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, reason: 'Local and internal hostnames are blocked.' };
  }

  // If hostname is directly an IP address
  if (isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      return { valid: false, reason: 'Target IP is in a private, local, or reserved range.' };
    }
    return { valid: true, url: parsed };
  }

  // Resolve DNS to verify resolved IPs
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) {
      return { valid: false, reason: 'Could not resolve domain.' };
    }

    for (const record of records) {
      if (isPrivateOrBlockedIp(record.address)) {
        return {
          valid: false,
          reason: `Resolved IP "${record.address}" is in a private, local, or reserved range.`,
        };
      }
    }
  } catch (err) {
    return {
      valid: false,
      reason: `DNS lookup failed for hostname "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { valid: true, url: parsed };
}

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
}

/**
 * Performs a safe outbound HTTP GET request with:
 * - DNS-level SSRF prevention
 * - Manual redirect validation on every hop
 * - Maximum byte limit enforcement
 * - Abort timeout signal
 */
export async function safeFetch(
  targetUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ text: string; status: number; contentType: string | null; finalUrl: string }> {
  let currentUrl = targetUrl;
  let redirectCount = 0;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_PAYLOAD_BYTES;

  while (redirectCount <= maxRedirects) {
    const validation = await validateUrlForOutboundFetch(currentUrl);
    if (!validation.valid || !validation.url) {
      throw new Error(`SSRF validation failed for URL "${currentUrl}": ${validation.reason}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        ...options,
        redirect: 'manual',
        signal: controller.signal,
      });

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response from "${currentUrl}" missing Location header.`);
        }

        const resolvedRedirect = new URL(location, currentUrl).toString();
        currentUrl = resolvedRedirect;
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Upstream request to "${currentUrl}" failed with HTTP ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxBytes) {
        throw new Error(`Response size (${contentLength} bytes) exceeds limit of ${maxBytes} bytes.`);
      }

      // Read response body safely with byte accounting
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        return {
          text: text.slice(0, maxBytes),
          status: response.status,
          contentType: response.headers.get('content-type'),
          finalUrl: currentUrl,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new Error(`Response body exceeded maximum allowed size of ${maxBytes} bytes.`);
          }
          chunks.push(value);
        }
      }

      const decoder = new TextDecoder('utf-8');
      const text = chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode();

      return {
        text,
        status: response.status,
        contentType: response.headers.get('content-type'),
        finalUrl: currentUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Too many redirects (exceeded limit of ${maxRedirects}).`);
}
