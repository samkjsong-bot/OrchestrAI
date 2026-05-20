import { describe, it, expect } from 'vitest'
import { _internal } from '../src/util/updateChecker'

const { isNewer } = _internal

describe('updateChecker.isNewer', () => {
  it('higher patch → newer', () => {
    expect(isNewer('0.1.39', '0.1.40')).toBe(true)
  })
  it('higher minor → newer', () => {
    expect(isNewer('0.1.39', '0.2.0')).toBe(true)
  })
  it('higher major → newer', () => {
    expect(isNewer('0.1.39', '1.0.0')).toBe(true)
  })
  it('same version → not newer', () => {
    expect(isNewer('0.1.40', '0.1.40')).toBe(false)
  })
  it('lower patch → not newer', () => {
    expect(isNewer('0.1.40', '0.1.39')).toBe(false)
  })
  it('strips v prefix', () => {
    expect(isNewer('v0.1.39', 'v0.1.40')).toBe(true)
  })
  it('handles missing patch component', () => {
    expect(isNewer('0.1', '0.1.1')).toBe(true)
  })
  it('handles malformed → 0 fallback (no newer claim)', () => {
    expect(isNewer('0.1.40', 'abc')).toBe(false)
  })
})
