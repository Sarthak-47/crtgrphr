/** `crtgrphr` executable entry point. See main.ts. */
import { run } from './main'

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (e) => {
    console.error(`crtgrphr: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 2
  },
)
