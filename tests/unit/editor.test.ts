import { describe, expect, it } from 'vitest'
import { editorUrl, evidencePath, isEditorId, sourcePath } from '../../src/shared/editor'

describe('opening files in an editor', () => {
  it('builds editor URLs with each segment encoded and the drive kept', () => {
    expect(editorUrl('vscode', String.raw`D:\Code Projs\repo\a#b.ts`)).toBe('vscode://file/D:/Code%20Projs/repo/a%23b.ts')
    expect(editorUrl('cursor', '/home/me/repo/x.yml')).toBe('cursor://file/home/me/repo/x.yml')
    expect(editorUrl('system', '/home/me/x')).toBeNull()
  })

  it('accepts only listed editors', () => {
    expect(isEditorId('vscode')).toBe(true)
    expect(isEditorId('toString')).toBe(false)
    expect(isEditorId('cmd /c calc')).toBe(false)
  })

  it('reads the path from a node source', () => {
    expect(sourcePath('k8s/app.yaml#Deployment/web')).toBe('k8s/app.yaml')
    expect(sourcePath('namespace shop')).toBeNull()
    expect(sourcePath('../outside')).toBeNull()
  })

  it('reads the cited file from link evidence', () => {
    expect(evidencePath('docker-compose.yml: services.web.depends_on')).toBe('docker-compose.yml')
    expect(evidencePath('apps/web/package.json depends on api')).toBe('apps/web/package.json')
    expect(evidencePath('k8s/ingress.yaml#Ingress/web sends / to Service web')).toBe('k8s/ingress.yaml')
    expect(evidencePath('Ingress and LoadBalancer services')).toBeNull()
    expect(evidencePath('https://example.com/x said so')).toBeNull()
  })
})
