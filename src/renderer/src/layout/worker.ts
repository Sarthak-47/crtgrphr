/**
 * ELK in a Web Worker, for the app. Layout of a big map takes hundreds of
 * milliseconds (see docs/performance.md); in a worker the window stays
 * responsive meanwhile. If the worker can't start or doesn't answer a tiny
 * probe layout within a few seconds, layout stays in-process.
 */
import ElkApi from 'elkjs/lib/elk-api.js'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'
import type { LayoutEngine } from './elk'

const PROBE_TIMEOUT_MS = 4000

export async function workerLayoutEngine(): Promise<LayoutEngine | null> {
  if (typeof Worker === 'undefined') return null
  try {
    const elk = new ElkApi({ workerUrl, workerFactory: (url?: string) => new Worker(url ?? workerUrl) }) as unknown as LayoutEngine & { terminateWorker?: () => void }
    const probe = elk.layout({ id: 'probe', layoutOptions: { 'elk.algorithm': 'layered' }, children: [{ id: 'a', width: 10, height: 10 }], edges: [] })
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('layout worker did not answer')), PROBE_TIMEOUT_MS))
    await Promise.race([probe, timeout])
    return elk
  } catch (e) {
    console.warn(`Layout runs in the window instead of a worker: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
