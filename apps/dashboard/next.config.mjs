/**
 * Security headers (roadmap 8.1). The dashboard is an authenticated app: it
 * may never be framed, never leaks referrers, and its CSP allows only its own
 * assets plus the API origin for fetch. Next.js hydration requires inline
 * scripts, hence 'unsafe-inline' on script-src - the accepted Next trade-off
 * absent per-request nonces on a mostly-static deployment.
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
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
