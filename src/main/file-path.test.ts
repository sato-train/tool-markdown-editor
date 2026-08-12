import { describe, expect, it } from 'vitest'
import { extractMarkdownPath } from './file-path'

const existing = (expected: string) => (candidate: string): boolean => candidate === expected

describe('extractMarkdownPath', () => {
  it('finds an absolute Markdown path containing spaces', () => {
    const path = 'C:\\My Notes\\today.md'
    expect(extractMarkdownPath(['electron.exe', path], 'C:\\work', existing(path))).toBe(path)
  })

  it('resolves a relative path from the launching working directory', () => {
    const path = 'C:\\work\\notes\\today.markdown'
    expect(extractMarkdownPath(['app.exe', 'notes\\today.markdown'], 'C:\\work', existing(path))).toBe(path)
  })

  it('accepts case-insensitive Markdown extensions', () => {
    const path = 'C:\\work\\README.MD'
    expect(extractMarkdownPath(['app.exe', path], 'C:\\work', existing(path))).toBe(path)
  })

  it('ignores missing files and unrelated arguments', () => {
    expect(extractMarkdownPath(['app.exe', '--inspect', 'notes.txt'], 'C:\\work', () => false)).toBeNull()
  })
})
