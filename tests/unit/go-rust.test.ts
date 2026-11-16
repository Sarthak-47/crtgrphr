import { describe, expect, it } from 'vitest'
import { goImports, rustReferences, stripComments } from '../../src/main/scan/go-rust'

describe('Go and Rust lexing', () => {
  it('reads Go imports from the import section only', () => {
    const code = String.raw`package x
// import "a.com/c"
/* import "a.com/d" */
import (
  "fmt"
  y "b.com/y" // why
  _ "e.com/driver"
)
import "c.com/z"
func f() { s := "import \"d.com/q\""; r := ` + '`import "d.com/r"`' + ` }
`
    expect(goImports(code).sort()).toEqual(['b.com/y', 'c.com/z', 'e.com/driver', 'fmt'])
  })

  it('keeps Go strings with escaped quotes intact', () => {
    const s = stripComments(String.raw`a := "x\"// not a comment"; b := 1 // comment`, 'go')
    expect(s).toContain(String.raw`"x\"// not a comment"`)
    expect(s).not.toContain('comment`')
    expect(s.trimEnd().endsWith('1')).toBe(true)
  })

  it('skips Rust comments (nested), strings and raw strings but not lifetimes', () => {
    const s = stripComments(
      String.raw`fn a<'a>(x: &'a str) { /* a /* crate::x */ b */ let _ = r#"crate::y"#; let c = '\''; let d = "crate::w \" crate::v"; crate::z::f(); }`,
      'rust',
    )
    expect(s).toContain('crate::z')
    expect(s).not.toMatch(/crate::[xyvw]/)
    expect(s).toContain("'a str")
  })

  it('resolves super:: only when it climbs to the crate root', () => {
    expect([...rustReferences('use super::sibling;', ['db', 'pool']).modules]).toEqual([])
    expect([...rustReferences('use super::{config, db::Pool};', ['handlers']).modules].sort()).toEqual(['config', 'db'])
    expect([...rustReferences('use super::super::store;', ['api', 'v1']).modules]).toEqual(['store'])
    expect([...rustReferences('use crate::{a::b, c, self};', ['x']).modules].sort()).toEqual(['a', 'c'])
  })
})
