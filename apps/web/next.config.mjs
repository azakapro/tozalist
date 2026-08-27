import createMDX from '@next/mdx'

/**
 * Security headers (roadmap 8.1). The public site is fully static content:
 * no frames, no referrer leakage, own assets only - plus the API origin for
 * the lead form fetch. 'unsafe-inline' script-src is the standard Next
 * hydration trade-off without per-request nonces.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      `img-src 'self' data:; connect-src 'self' ${API_ORIGIN}; frame-ancestors 'none'; ` +
      "base-uri 'self'; form-action 'self'",
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

const withMDX = createMDX({})

export default withMDX(nextConfig)
