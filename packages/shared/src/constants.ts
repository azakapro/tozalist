/**
 * Constants shared across every TozaList surface.
 *
 * Scope note (step 0.1): infrastructure-level values only. Product domain
 * constants land with the features that need them.
 */

export const APP_NAME = 'TozaList'

/** Every deployable unit in the monorepo. */
export const SERVICE_NAMES = ['api', 'worker', 'dashboard', 'web', 'engine'] as const

/**
 * Services that must never be reachable from outside the private network.
 * See docs/architecture.md for the trust boundary this encodes.
 */
export const INTERNAL_ONLY_SERVICES = ['engine'] as const
