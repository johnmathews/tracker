import { settle } from './setup'
import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

type Props = InstanceType<typeof ConfirmDialog>['$props']

const removePushUps = {
  title: 'Remove Push-ups?',
  message:
    'Remove ‘Push-ups’ from this week’s plan and also future weeks. History is unchanged and existing data is not removed.',
  confirmLabel: 'Remove',
}

async function mountOpen(props: Partial<Props> = {}): Promise<VueWrapper> {
  const wrapper: VueWrapper = mount(ConfirmDialog, {
    attachTo: document.body,
    props: {
      ...removePushUps,
      open: true,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
      ...props,
    },
  })
  await settle()
  return wrapper
}

function alertDialog(): HTMLElement | null {
  return document.querySelector('[role="alertdialog"]')
}

function buttons(): HTMLButtonElement[] {
  return [...alertDialog()!.querySelectorAll('button')]
}

describe('ConfirmDialog', () => {
  it('is a modal alertdialog labelled by its question and described by its body', async () => {
    await mountOpen()
    const el = alertDialog()!
    expect(el.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(el.getAttribute('aria-labelledby')!)!
    expect(title.textContent).toBe('Remove Push-ups?')
    expect(title.classList).toContain('title-2')
    const body = document.getElementById(el.getAttribute('aria-describedby')!)!
    expect(body.textContent).toBe(removePushUps.message)
    expect(body.classList).toContain('body')
  })

  it('puts secondary Cancel first and the ink verb last, with no close button and no red', async () => {
    await mountOpen()
    expect(buttons().map((b) => b.textContent)).toEqual(['Cancel', 'Remove'])
    const [cancel, confirm] = buttons()
    expect(cancel!.dataset.variant).toBe('secondary')
    expect(confirm!.dataset.variant).toBe('primary')
    expect(alertDialog()!.querySelector('[aria-label="Close"]')).toBeNull()
    expect(alertDialog()!.outerHTML).not.toMatch(/error-ink|destructive|red/)
  })

  it('takes a cancel label', async () => {
    await mountOpen({ cancelLabel: 'Keep it' })
    expect(buttons()[0]!.textContent).toBe('Keep it')
  })

  it('starts focus on Cancel, the safe choice', async () => {
    await mountOpen()
    expect(document.activeElement).toBe(buttons()[0])
  })

  it('emits confirm from the verb and leaves closing to the owner', async () => {
    const wrapper = await mountOpen()
    buttons()[1]!.click()
    await settle()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(alertDialog()).not.toBeNull()
  })

  it('emits cancel and closes from Cancel', async () => {
    const wrapper = await mountOpen()
    buttons()[0]!.click()
    await settle()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(alertDialog()).toBeNull()
  })

  it('emits cancel and closes on Escape', async () => {
    const wrapper = await mountOpen()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(alertDialog()).toBeNull()
  })

  it('returns focus to the control that asked when it closes', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    await mountOpen()
    buttons()[0]!.click()
    await settle()
    expect(document.activeElement).toBe(opener)
  })

  it('sends focus where returnFocus says once the answer’s work is done', async () => {
    const opener = document.createElement('button')
    const neighbour = document.createElement('button')
    document.body.append(opener, neighbour)
    opener.focus()
    const wrapper = await mountOpen({
      returnFocus: () => (opener.isConnected ? opener : neighbour),
    })
    buttons()[1]!.click()
    await wrapper.setProps({ open: false })
    // The confirmed action removes the control that asked after the dialog has begun closing.
    opener.remove()
    await settle()
    expect(document.activeElement).toBe(neighbour)
  })

  it('keeps the verb while busy, marking it aria-busy', async () => {
    await mountOpen({ busy: true, confirmLabel: 'Sign out', title: 'Sign out now?' })
    const confirm = buttons()[1]!
    expect(confirm.textContent).toBe('Sign out')
    expect(confirm.getAttribute('aria-busy')).toBe('true')
  })

  it('shows a failure above the buttons with the icon and the words', async () => {
    await mountOpen({ error: 'Couldn’t sign out. Check your connection and try again.' })
    const error = alertDialog()!.querySelector('[role="alert"]')!
    expect(error.textContent).toBe('Couldn’t sign out. Check your connection and try again.')
    expect(error.classList).toContain('text-error-ink')
    expect(error.querySelector('svg')).not.toBeNull()
    expect(
      error.compareDocumentPosition(buttons()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('draws a panel at the page’s size, at least 400px, on the 40% scrim (K55)', async () => {
    await mountOpen()
    expect([...alertDialog()!.classList]).toEqual(
      expect.arrayContaining([
        'bg-panel',
        'border-line',
        'rounded-lg',
        'shadow-overlay',
        'max-w-[max(25rem,calc(var(--u)*600))]',
      ]),
    )
    const scrim = document.querySelector('[data-slot="confirm-dialog-scrim"]')!
    expect([...scrim.classList]).toEqual(expect.arrayContaining(['bg-scrim', 'opacity-40']))
  })
})
