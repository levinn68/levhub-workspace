import dns from 'node:dns/promises';
import net from 'node:net';
import { LevhubError } from './errors.js';

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .map((octet) => Number(octet))
    .reduce((acc, oct) => (acc << 8) + oct, 0) >>> 0;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '').trim();

  if (net.isIPv4(clean)) {
    const n = ipv4ToInt(clean);
    const ranges: Array<[string, number]> = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10], // CGNAT
      ['127.0.0.0', 8], // Loopback
      ['169.254.0.0', 16], // Link-local / Cloud metadata
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.168.0.0', 16],
      ['224.0.0.0', 4], // Multicast
      ['240.0.0.0', 4], // Reserved
    ];
    for (const [base, prefix] of ranges) {
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      if ((n & mask) === (ipv4ToInt(base) & mask)) return true;
    }
    return false;
  }

  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // Link-local
    }
    if (lower.startsWith('ff')) return true; // Multicast
    // IPv4-mapped forms that were not stripped cleanly (e.g. 0:0:0:0:0:ffff:7f00:1).
    if (lower.includes('::ffff:') || lower.includes('0:0:0:0:0:ffff')) return true;
    // NAT64 (64:ff9b::/96) can wrap private IPv4 space.
    if (lower.startsWith('64:ff9b:') || lower.startsWith('64:ff9b::')) return true;
    // 6to4 (2002::/16) embeds an IPv4 address in the next 32 bits.
    if (lower.startsWith('2002:')) {
      const hextets = lower.split(':');
      if (hextets.length >= 2 && hextets[1].length === 4) {
        const hi = parseInt(hextets[1].slice(0, 2), 16);
        const lo = parseInt(hextets[1].slice(2, 4), 16);
        if (hextets[2] && hextets[2].length === 4) {
          const hi2 = parseInt(hextets[2].slice(0, 2), 16);
          const lo2 = parseInt(hextets[2].slice(2, 4), 16);
          const embedded = `${hi}.${lo}.${hi2}.${lo2}`;
          return isPrivateOrReservedIp(embedded);
        }
      }
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Validates external MCP endpoint URLs against SSRF (S-007).
 * Blocks non-HTTPS in production, loopback/private/link-local/metadata IPs, and DNS rebinding to private ranges.
 *
 * Known limitation: this performs a pre-flight DNS check. A TOCTOU window
 * remains because the actual fetch resolves DNS again. True pinning requires
 * a custom undici Agent/dispatcher wired into the MCP transport, which is not
 * yet implemented. Redirects are rejected (`redirect: 'error'`) which removes
 * the most common bypass.
 */
export async function validateExternalEndpointUrl(
  rawUrl: string,
  options: { allowHttpInDev?: boolean; skipDnsLookup?: boolean } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new LevhubError('INVALID_INPUT', 'Format URL endpoint MCP tidak valid.', 400);
  }

  const allowedProtocols = options.allowHttpInDev ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new LevhubError(
      'INVALID_INPUT',
      'Endpoint MCP eksternal wajib menggunakan protokol HTTPS.',
      400,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new LevhubError('INVALID_INPUT', 'Host lokal/internal tidak diizinkan untuk MCP eksternal.', 400);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new LevhubError('INVALID_INPUT', 'Alamat IP privat atau reserved ditolak (proteksi SSRF).', 400);
    }
    return parsed;
  }

  if (!options.skipDnsLookup) {
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (addresses.length === 0) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'DNS endpoint MCP tidak ditemukan.', 400);
      }
      for (const addr of addresses) {
        if (isPrivateOrReservedIp(addr.address)) {
          throw new LevhubError(
            'INVALID_INPUT',
            'Resolusi DNS mengarah ke alamat IP privat/terlarang (proteksi SSRF).',
            400,
          );
        }
      }
    } catch (err) {
      if (err instanceof LevhubError) throw err;
      throw new LevhubError('MCP_CONNECT_FAILED', 'Gagal memverifikasi DNS endpoint MCP.', 400, true);
    }
  }

  return parsed;
}
