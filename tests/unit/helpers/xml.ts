import { expect } from 'vitest'

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no raw '<' in text. */
export function assertWellFormed(xml: string): void {
  const stack: string[] = []
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    const between = xml.slice(last, m.index)
    expect(between, 'stray markup between tags').not.toMatch(/[<>]/)
    const [, close, name, , selfClose] = m
    if (close) expect(stack.pop(), `closing </${name}>`).toBe(name)
    else if (!selfClose) stack.push(name)
    last = tagRe.lastIndex
  }
  expect(xml.slice(last).trim()).toBe('')
  expect(stack).toEqual([])
}
