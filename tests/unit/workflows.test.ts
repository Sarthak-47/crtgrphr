/**
 * GitHub only reports a broken workflow file after it is pushed, as a failed run
 * with no logs. Parse every workflow and the Action here instead, so a YAML
 * mistake fails the unit tests locally.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

const ROOT = resolve(__dirname, '../..')
const WF = join(ROOT, '.github/workflows')

describe('GitHub workflow files', () => {
  for (const file of readdirSync(WF).filter((f) => /\.ya?ml$/.test(f))) {
    it(`${file} is valid YAML with jobs that have steps`, () => {
      const doc = yaml.load(readFileSync(join(WF, file), 'utf8')) as any
      expect(doc.on ?? doc.true).toBeTruthy() // js-yaml reads a bare `on` key as true
      expect(Object.keys(doc.jobs).length).toBeGreaterThan(0)
      for (const [name, job] of Object.entries<any>(doc.jobs)) {
        expect(job['runs-on'], `${name} runs-on`).toBeTruthy()
        expect(Array.isArray(job.steps) && job.steps.length > 0, `${name} steps`).toBe(true)
        for (const step of job.steps) expect(step.run !== undefined || step.uses !== undefined, `${name}: a step needs run or uses`).toBe(true)
      }
    })
  }

  it('action.yml is a valid composite action whose script exists', () => {
    const action = yaml.load(readFileSync(join(ROOT, 'action.yml'), 'utf8')) as any
    expect(action.runs.using).toBe('composite')
    expect(action.runs.steps[0].env.CG_BIN).toContain('action/dist/crtgrphr.mjs')
    for (const input of ['path', 'map', 'mode', 'strict']) expect(action.inputs[input]).toBeTruthy()
    expect(readFileSync(join(ROOT, 'action/dist/crtgrphr.mjs'), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true)
  })
})
