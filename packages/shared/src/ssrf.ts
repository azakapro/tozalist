import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF protection for webhook destinations.
 *
 * A webhook URL must never let a customer aim TozaList's servers at internal
 * infrastructure. The hostname is resolved and every address must be public -
 * both at registration AND again at every delivery attempt, because DNS can be
 * re-pointed after registration (rebinding).
 */

/** Resolves a hostname to all its addresses. Injectable for tests. */
export type HostResolver = (hostname: string) => Promise<string[]>

export const defaultHostResolver: HostResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => entry.address)
}

/** True when the IP belongs to a private, loopback, link-local or reserved
 * range. IPv6 is fully canonicalised first, so EVERY representation of an
 * IPv4-mapped address - dotted (`::ffff:10.0.0.1`) or hexadecimal
 * (`::ffff:0a00:1`) - is unwrapped and checked as IPv4. */
export function isPrivateAddress(ip: string): boolean {
  const normalized = ip.trim().toLowerCase()

  if (isIP(normalized) === 4) return isPrivateIpv4(normalized)
  if (isIP(normalized) === 6) {
    const groups = canonicalizeIpv6(normalized)
    if (groups === null) return true // ambiguous parse: fail closed
    return isPrivateIpv6Canonical(groups)
  }
  // Unparseable input is treated as private: fail closed.
  return true
}

/**
 * Expands an IPv6 literal into its eight 16-bit groups. Handles `::`
 * compression and a trailing dotted IPv4 quad. Returns null for anything that
 * does not expand cleanly - callers must fail closed on null.
 */
function canonicalizeIpv6(ip: string): number[] | null {
  let head = ip
  // A zone index (fe80::1%en0) never belongs in a webhook target.
  if (head.includes('%')) return null

  // Trailing dotted quad becomes the final two groups.
  let tailGroups: number[] = []
  const dotted = /^(.*):(\d+\.\d+\.\d+\.\d+)$/.exec(head)
  if (dotted !== null && dotted[1] !== undefined && dotted[2] !== undefined) {
    const parts = dotted[2].split('.').map(Number)
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null
    }
    const [a, b, c, d] = parts as [number, number, number, number]
    tailGroups = [(a << 8) | b, (c << 8) | d]
    head = dotted[1]
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1)
  }

  const expand = (side: string): number[] | null => {
    if (side === '') return []
    const groups: number[] = []
    for (const part of side.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }

  const halves = head.split('::')
  if (halves.length > 2) return null

  let groups: number[] | null
  if (halves.length === 2) {
    const left = expand(halves[0] ?? '')
    const right = expand(halves[1] ?? '')
    if (left === null || right === null) return null
    const fill = 8 - tailGroups.length - left.length - right.length
    if (fill < 0) return null
    groups = [...left, ...Array.from({ length: fill }, () => 0), ...right, ...tailGroups]
  } else {
    const flat = expand(head)
    if (flat === null) return null
    groups = [...flat, ...tailGroups]
  }

  return groups.length === 8 ? groups : null
}

function isPrivateIpv6Canonical(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]

  // ::1 loopback
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true
  }
  // IPv4-mapped ::ffff:0:0/96 - unwrap and classify the embedded IPv4, so
  // hexadecimal forms like ::ffff:0a00:1 (10.0.0.1) cannot slip through.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const ipv4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`
    return isPrivateIpv4(ipv4)
  }
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link local
  return false
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 127) return true // 127.0.0.0/8
  if (a === 169 && b === 254) return true // 169.254.0.0/16
  if (a === 0) return true // 0.0.0.0/8
  return false
}

export type SsrfCheck =
  { ok: true; addresses: string[] } | { ok: false; reason: 'unresolvable' | 'private_address' }

/**
 * Resolves `hostname` (or accepts an IP literal) and requires EVERY resolved
 * address to be public. One private address poisons the whole set - resolvers
 * can interleave answers.
 */
export async function checkWebhookHost(
  hostname: string,
  resolver: HostResolver = defaultHostResolver,
): Promise<SsrfCheck> {
  if (isIP(hostname) !== 0) {
    return isPrivateAddress(hostname)
      ? { ok: false, reason: 'private_address' }
      : { ok: true, addresses: [hostname] }
  }

  let addresses: string[]
  try {
    addresses = await resolver(hostname)
  } catch {
    return { ok: false, reason: 'unresolvable' }
  }
  if (addresses.length === 0) return { ok: false, reason: 'unresolvable' }
  if (addresses.some((address) => isPrivateAddress(address))) {
    return { ok: false, reason: 'private_address' }
  }
  return { ok: true, addresses }
}
