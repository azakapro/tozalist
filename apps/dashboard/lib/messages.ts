/**
 * The single user-facing strings file, structured for i18n. English is
 * complete; ru and uz keys are present and fall back to English until their
 * translations land.
 */

const en = {
  'app.name': 'TozaList',
  'nav.dashboard': 'Dashboard',
  'nav.keys': 'API keys',
  'nav.settings': 'Settings',
  'nav.logout': 'Log out',

  'auth.login.title': 'Log in',
  'auth.login.email': 'Email',
  'auth.login.password': 'Password',
  'auth.login.submit': 'Log in',
  'auth.login.failed': 'The email or password is incorrect.',
  'auth.login.noAccount': 'No account yet?',
  'auth.login.signupLink': 'Create an organization',
  'auth.signup.title': 'Create your organization',
  'auth.signup.orgName': 'Organization name',
  'auth.signup.submit': 'Create account',
  'auth.signup.haveAccount': 'Already have an account?',
  'auth.signup.loginLink': 'Log in',
  'auth.signup.failed': 'Signup failed. The email may already be registered.',
  'auth.password.hint': 'At least 10 characters.',

  'mfa.setup.title': 'Set up two-factor authentication',
  'mfa.setup.intro':
    'Two-factor authentication is required for admin accounts. Scan the QR code with your authenticator app, then enter the 6-digit code.',
  'mfa.setup.manual': 'Or enter this secret manually:',
  'mfa.recovery.title': 'Recovery codes',
  'mfa.recovery.warning':
    'Store these 10 recovery codes somewhere safe. Each works exactly once, and they are shown only now.',
  'mfa.recovery.confirm': 'I have saved my recovery codes',
  'mfa.challenge.title': 'Enter your verification code',
  'mfa.challenge.hint': 'The 6-digit code from your authenticator app, or a recovery code.',
  'mfa.challenge.submit': 'Verify',
  'mfa.challenge.failed': 'The verification code is not valid.',

  'dashboard.title': 'Overview',
  'dashboard.credits': 'Credits remaining',
  'dashboard.checksThisMonth': 'Checks this month',
  'dashboard.recentBatches': 'Recent batches',
  'dashboard.recentActivity': 'Recent activity',
  'dashboard.noBatches': 'No batches yet.',
  'dashboard.noActivity': 'No activity yet.',

  'keys.title': 'API keys',
  'keys.create': 'Create key',
  'keys.name': 'Key name',
  'keys.prefix': 'Prefix',
  'keys.created': 'Created',
  'keys.lastUsed': 'Last used',
  'keys.never': 'never',
  'keys.revoked': 'revoked',
  'keys.revoke': 'Revoke',
  'keys.revokeConfirm': 'Revoke this key? Requests using it will stop working immediately.',
  'keys.modal.title': 'Your new API key',
  'keys.modal.warning':
    'Copy this key now. For your security it is shown only once and cannot be retrieved again.',
  'keys.modal.copy': 'Copy to clipboard',
  'keys.modal.copied': 'Copied.',
  'keys.modal.done': 'Done',

  'settings.title': 'Settings',
  'settings.orgName': 'Organization name',
  'settings.save': 'Save changes',
  'settings.saved': 'Saved.',
  'settings.retention.title': 'Data retention',
  'settings.retention.explain':
    'How long check results, batches and their files are kept before automatic deletion.',
  'settings.retention.7':
    '7 days — shortest retention; results and files are deleted after one week.',
  'settings.retention.30':
    '30 days — the default; one month to download results and review history.',
  'settings.retention.90': '90 days — longest retention; keep results for a quarter.',
  'settings.danger.title': 'Danger zone',
  'settings.danger.explain':
    'Deleting the organization disables all access immediately and schedules permanent data deletion. This cannot be undone.',
  'settings.danger.confirmLabel': 'Type the organization name to confirm',
  'settings.danger.delete': 'Delete organization',
  'settings.danger.mismatch': 'The confirmation name does not match.',

  'common.loading': 'Loading…',
  'common.error': 'Something went wrong. Try again.',
  'common.retry': 'Retry',
  'common.apiUnreachable': 'The service could not be reached.',
  'common.noCredits': 'You are out of credits.',
  'common.noCreditsLink': 'Go to billing',

  'nav.check': 'Check',
  'nav.batches': 'Batches',
  'nav.usage': 'Usage',

  'check.title': 'Single check',
  'check.email.tab': 'Email',
  'check.phone.tab': 'Phone',
  'check.email.placeholder': 'name@example.com',
  'check.phone.placeholder': '+998 90 123 45 67',
  'check.submit': 'Check',
  'check.verdict.valid': 'Valid',
  'check.verdict.risky': 'Risky',
  'check.verdict.unknown': 'Unknown',
  'check.verdict.invalid': 'Invalid',
  'check.unknown.notice': 'Do not delete — we could not determine this address.',
  'check.didYouMean': 'Did you mean',
  'check.reasons': 'Reasons',
  'check.phone.valid': 'Valid format',
  'check.phone.invalid': 'Invalid format',

  'batches.title': 'Batches',
  'batches.drop': 'Drag a CSV file here, or click to choose one',
  'batches.dropHint': 'Up to 20 MB and 100,000 rows. One credit per row.',
  'batches.estimate.rows': 'rows detected',
  'batches.estimate.cost': 'Estimated cost',
  'batches.confirm': 'Use {n} credits',
  'batches.cancel': 'Cancel',
  'batches.uploading': 'Uploading…',
  'batches.processing': 'Processing…',
  'batches.download': 'Download results',
  'batches.delete': 'Delete',
  'batches.deleteConfirm': 'Delete this batch and its files? This cannot be undone.',
  'batches.empty':
    'No batches yet. Upload a CSV with an email column to check a whole list at once.',
  'batches.rejected': 'Upload rejected',
  'batches.history': 'History',
  'batches.status': 'Status',
  'batches.rows': 'Rows',
  'batches.date': 'Date',
  'batches.summary': 'Verdict distribution',

  'usage.title': 'Usage',
  'usage.balance': 'Current balance',
  'usage.from': 'From',
  'usage.to': 'To',
  'usage.filter': 'Apply',
  'usage.export': 'Export CSV',
  'usage.chart': 'Checks per day (last 30 days)',
  'usage.table.date': 'Date',
  'usage.table.reason': 'Reason',
  'usage.table.delta': 'Change',
  'usage.table.balance': 'Balance',
  'usage.empty': 'No ledger entries in this period.',
} as const

export type MessageKey = keyof typeof en

// ru/uz keys exist now and fall back to English until translated.
const ru: Partial<Record<MessageKey, string>> = {}
const uz: Partial<Record<MessageKey, string>> = {}

const locales = { en, ru, uz } as const
export type Locale = keyof typeof locales

let activeLocale: Locale = 'en'

export function setLocale(locale: Locale): void {
  activeLocale = locale
}

/** Translates a key in the active locale, falling back to English. */
export function t(key: MessageKey): string {
  const table = locales[activeLocale] as Partial<Record<MessageKey, string>>
  return table[key] ?? en[key]
}
