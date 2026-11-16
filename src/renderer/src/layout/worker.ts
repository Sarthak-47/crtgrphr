/**
 * ELK in a Web Worker, for the app. Layout of a big map takes hundreds of
 * milliseconds (see docs/performance.md); in a worker the window stays
 * responsive meanwhile.
 *
 * The worker loads a 1.6 MB script, which can take seconds on a slow machine.
 * Layout doesn't wait for it: the app lays out in-process from the start and
 * switches to the worker once a tiny probe layout comes back from it. If the
 * worker can't start at all, layout simply stays in-process.
 */
import ElkApi from 'elkjs/lib/elk-api.js'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'
import type { LayoutEngine } from './elk'

export async function workerLayoutEngine(): Promise<LayoutEngine | null> {
  if (typeof Worker === 'undefined') return null
  try {
    const elk = new ElkApi({ workerUrl, workerFactory: (url?: string) => new Worker(url ?? workerUrl) }) as unknown as LayoutEngine
    await elk.layout({ id: 'probe', layoutOptions: { 'elk.algorithm': 'layered' }, children: [{ id: 'a', width: 10, height: 10 }], edges: [] })
    return elk
  } catch (e) {
    console.warn(`Layout runs in the window instead of a worker: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
