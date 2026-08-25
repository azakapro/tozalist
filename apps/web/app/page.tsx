import { redirect } from 'next/navigation'
import { DEFAULT_LOCALE } from '../lib/messages'

export default function Root() {
  redirect(`/${DEFAULT_LOCALE}`)
}
