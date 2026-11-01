import type { AuthProblem } from '@/stores/session'
import { isDetailsId } from '@/lib/storage'
import { countOf } from '@/lib/words'

/**
 * Why an item's notes or details can't be saved, when its id is one the details path can't name
 * (`isDetailsId`), or null when it can. The app makes no such id; an import or an old plan can.
 */
export function detailsIdProblem(id: string, what: 'notes' | 'details'): string | null {
  if (isDetailsId(id)) return null
  const why = id.includes('/') ? 'its id has a slash in it' : 'its id isn’t one the server takes'
  return `This item’s ${what} can’t be saved: ${why}.`
}

/** The repeat-password field's error, on every form that asks for a new password twice. */
export const MISMATCH = 'The passwords don’t match. Type the same password in both fields.'

/** A sentence for each way a sign-in, a sign-up, a link or a sign-out can fail. */
export function describeProblem(p: AuthProblem): string {
  switch (p.code) {
    case 'invalid':
      return 'Wrong email or password. Check them and try again.'
    case 'locked': {
      const minutes = Math.max(1, Math.ceil((p.retryAfter ?? 900) / 60))
      return `Too many attempts. Try again in ${countOf(minutes, 'minute')}.`
    }
    case 'busy':
      return 'The server is busy. Try again in a moment.'
    case 'offline':
      return 'Can’t reach the server. Check the connection and try again.'
    case 'gone':
      return 'This link has expired or was already used. Ask for a new one.'
    case 'password':
      return 'Use 10 to 256 characters.'
    case 'email':
      return 'Enter an email address, like name@example.com.'
    case 'exists':
      return 'There’s already an account for that email. Go to sign in.'
    case 'closed':
      return 'New accounts are closed for now. Ask whoever runs this planner for an invite.'
    case 'too-many': {
      const minutes = Math.max(1, Math.ceil((p.retryAfter ?? 3600) / 60))
      return `Too many new accounts at once. Try again in ${countOf(minutes, 'minute')}.`
    }
    case 'too-soon': {
      // The daily limit can mean hours: past an hour, say hours.
      const wait = p.retryAfter ?? 60
      const when =
        wait > 3600
          ? countOf(Math.ceil(wait / 3600), 'hour')
          : countOf(Math.max(1, Math.ceil(wait / 60)), 'minute')
      return `Can’t send another email yet. Try again in ${when}.`
    }
    case 'confirmed':
      return 'Your email is already confirmed.'
    case 'mail-off':
      return 'This planner doesn’t send email. Ask whoever runs it for a reset link.'
    default:
      return 'Something went wrong. Try again.'
  }
}
