import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import ProgrammeBuilder from '@/components/ProgrammeBuilder.vue'
import { signedIn } from '@/lib/__tests__/signedIn'
import { withProgrammes } from './programmesApi'

let wrapper: VueWrapper

async function open(hash: string): Promise<void> {
  history.replaceState(null, '', `/${hash}`)
  withProgrammes(signedIn(), {})
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('the programme builder’s addresses', () => {
  it('opens a new programme at #/programmes/new', async () => {
    await open('#/programmes/new')
    const builder = wrapper.getComponent(ProgrammeBuilder)
    expect(builder.props('programmeId')).toBeNull()
    expect(builder.get('h1').text()).toBe('New programme')
    expect(wrapper.find('[data-slot="bar"]').exists()).toBe(false)
  })

  it('opens a library programme at #/programmes/<id>/edit', async () => {
    await open('#/programmes/xmwluommflktp/edit')
    const builder = wrapper.getComponent(ProgrammeBuilder)
    expect(builder.props('programmeId')).toBe('xmwluommflktp')
    expect(builder.get('h1').text()).toBe('Edit programme')
  })

  it('moves between the two addresses on a hash change', async () => {
    await open('#/programmes/new')
    history.replaceState(null, '', '/#/programmes/abc/edit')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(wrapper.getComponent(ProgrammeBuilder).props('programmeId')).toBe('abc')
    history.replaceState(null, '', '/#/programmes/new')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(wrapper.getComponent(ProgrammeBuilder).props('programmeId')).toBeNull()
  })

  it('still opens the Programmes page at #/programmes', async () => {
    await open('#/programmes')
    expect(wrapper.findComponent(ProgrammeBuilder).exists()).toBe(false)
  })
})
