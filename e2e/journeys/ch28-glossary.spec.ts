/**
 * Chapter 28: glossary (docs/reference/28-glossary.md), and the integrity of the reference set itself.
 * These flows read the documents, not the simulator: the glossary is the index of terms, so it must be complete in form
 * (unique, sorted, every term linked to a chapter that exists and uses it), and the chapter index must lead to real files.
 */
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '..', '..', 'docs', 'reference')
const files = readdirSync(DIR)
  .filter((f) => /^\d{2}-.*\.md$/.test(f))
  .sort()
const chapterFile = (n: number) => files.find((f) => f.startsWith(String(n).padStart(2, '0') + '-'))
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')
const plain = (s: string) => s.replace(/[*`]/g, '').trim()

interface Row {
  term: string
  meaning: string
  chapters: number[]
}
const rows: Row[] = read('28-glossary.md')
  .split('\n')
  .filter((l) => l.startsWith('| **'))
  .map((l) => {
    const [, term, meaning, ch] = l.split('|').map((c) => c.trim())
    return { term: plain(term), meaning, chapters: ch.split(',').map((n) => Number(n.trim())) }
  })

// ───────────────────────── 1. The glossary ─────────────────────────

test.describe('GLO-01 the glossary is complete in form (ch28)', () => {
  test('it has the 100+ terms the chapter promises, each with a meaning', () => {
    expect(rows.length).toBeGreaterThanOrEqual(100)
    expect(rows.every((r) => r.meaning.length >= 10)).toBe(true)
  })

  test('terms are unique', () => {
    const seen = new Set<string>()
    for (const r of rows) {
      const key = r.term.toLowerCase()
      expect(seen.has(key), r.term).toBe(false)
      seen.add(key)
    }
  })

  test('terms are in alphabetical order', () => {
    const keys = rows.map((r) => r.term.toLowerCase())
    expect(keys).toEqual([...keys].sort())
  })

  test('every term cites at least one chapter, and each cited chapter exists', () => {
    for (const r of rows) {
      expect(r.chapters.length, r.term).toBeGreaterThan(0)
      for (const n of r.chapters) {
        expect(Number.isInteger(n) && n >= 1 && n <= 29, `${r.term}: chapter ${n}`).toBe(true)
        expect(chapterFile(n), `${r.term}: chapter ${n}`).toBeTruthy()
      }
    }
  })

  test('the chapter cited for a term actually uses the term (at least 90% of terms)', () => {
    const missing: string[] = []
    for (const r of rows) {
      // the first word of 4+ letters in the term, ignoring the part after a slash or parenthesis
      const head = r.term.split(/[/(]/)[0]
      const word = (head.match(/[A-Za-z][A-Za-z-]{3,}/) ?? [r.term])[0].toLowerCase()
      const stem = word.replace(/(ing|ed|s)$/, '')
      const found = r.chapters.some((n) => read(chapterFile(n)!).toLowerCase().includes(stem))
      if (!found) missing.push(`${r.term} (ch ${r.chapters.join(',')})`)
    }
    expect(missing.length / rows.length, missing.join('; ')).toBeLessThan(0.1)
  })
})

// ───────────────────────── 2. The reference set ─────────────────────────

test.describe('GLO-02 the 29 chapters exist, are numbered and are indexed (README)', () => {
  const readme = read('README.md')
  const links = [...readme.matchAll(/\]\((\d{2}-[^)]+\.md)\)/g)].map((m) => m[1])

  test('chapters 01 to 29 each exist exactly once', () => {
    for (let n = 1; n <= 29; n += 1) {
      expect(
        files.filter((f) => f.startsWith(String(n).padStart(2, '0') + '-')).length,
        `chapter ${n}`
      ).toBe(1)
    }
    expect(files.length).toBe(29)
  })

  test('the README index links every chapter and every link resolves', () => {
    expect(new Set(links).size).toBe(29)
    for (const l of links) expect(existsSync(join(DIR, l)), l).toBe(true)
  })

  test('each chapter opens with a heading carrying its own two-digit number', () => {
    for (const f of files) {
      const n = Number(f.slice(0, 2))
      expect(read(f).split('\n')[0], f).toMatch(new RegExp(`^# ${String(n).padStart(2, '0')}\\. `))
    }
  })

  test('each chapter states how its claims are marked (a Marks line)', () => {
    for (const f of files.filter((x) => !x.startsWith('28-'))) {
      expect(read(f), f).toMatch(/Marks:/)
    }
  })

  test('relative links inside the chapters point at files that exist', () => {
    for (const f of files) {
      for (const m of read(f).matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(m[1])) continue
        expect(existsSync(join(DIR, m[1])), `${f} -> ${m[1]}`).toBe(true)
      }
    }
  })

  test('chapters that cite sources end with a Sources section or say what is cited', () => {
    for (const f of files.filter((x) => !/^(26|27|28|29)-/.test(x))) {
      expect(read(f), f).toMatch(/## Sources|\*\*Testable expectations\*\*/)
    }
  })
})
