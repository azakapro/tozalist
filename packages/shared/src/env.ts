/**
 * Startup environment validation (roadmap 8.1): checks every required
 * variable up front and fails fast with ONE error naming ALL missing
 * variables - never their values - so a misconfigured deployment reports the
 * complete gap instead of dying one variable at a time.
 */
export function assertRequiredEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = names.filter((name) => {
    const value = env[name]
    return value === undefined || value.trim() === ''
  })
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(', ')}`)
  }
}
