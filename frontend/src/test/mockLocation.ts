import { vi } from 'vitest'

/**
 * jsdom's `window.location` is non-configurable, so `vi.spyOn(location, 'assign')`
 * throws "Cannot redefine property". The working pattern is to delete the own
 * property and swap in a plain stand-in for the duration of a test.
 */
export function mockLocation(pathname = '/groups') {
  const original = window.location
  const assign = vi.fn()

  // @ts-expect-error — jsdom permits deleting the own `location` property
  delete window.location
  // @ts-expect-error — minimal stand-in; only pathname + assign are exercised
  window.location = {
    ...original,
    pathname,
    href: `http://localhost${pathname}`,
    assign,
  }

  return {
    assign,
    restore() {
      // @ts-expect-error — restore the real object
      delete window.location
      // @ts-expect-error
      window.location = original
    },
  }
}
