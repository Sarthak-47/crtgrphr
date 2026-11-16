/**
 * Manifest parsers for the JVM (Maven, Gradle) and .NET (csproj, sln). Pure
 * string functions, no XML or Groovy parser: these files are regular enough that
 * targeted patterns read what the map needs (a name, modules, dependencies).
 *
 * Dependencies are returned as coordinates ("group:artifact" for the JVM, package
 * ids for .NET) plus the bare artifact/project names, so the same set serves both
 * infra detection and links between modules of one repository.
 */

/** Remove XML comments and the given elements (with their content). */
function stripXml(text: string, elements: string[]): string {
  let s = text.replace(/<!--[\s\S]*?-->/g, '')
  for (const el of elements) s = s.replace(new RegExp(`<${el}(\\s[^>]*)?>[\\s\\S]*?</${el}>`, 'g'), '')
  return s
}

const tag = (xml: string, name: string): string | null => xml.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`))?.[1] ?? null

export interface JvmManifest {
  name: string | null
  /** group:artifact coordinates and bare artifact ids */
  deps: Set<string>
  /** module directories (Maven <modules>, Gradle include) relative to the manifest */
  modules: string[]
  /** true for a Maven aggregator (packaging pom with modules) */
  aggregator: boolean
}

export function parsePom(text: string): JvmManifest {
  const top = stripXml(text, ['parent', 'dependencies', 'dependencyManagement', 'build', 'profiles', 'reporting', 'pluginRepositories', 'repositories', 'distributionManagement', 'developers', 'scm', 'licenses', 'properties'])
  const name = tag(top, 'artifactId')
  const modules = [...(top.match(/<modules>([\s\S]*?)<\/modules>/)?.[1] ?? '').matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((m) => m[1])
  const packaging = tag(top, 'packaging')
  const deps = new Set<string>()
  // Real dependencies only: not those in <dependencyManagement> (version pins) or plugins.
  const body = stripXml(text, ['dependencyManagement', 'build', 'reporting'])
  for (const block of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const g = tag(block[1], 'groupId')
    const a = tag(block[1], 'artifactId')
    if (!a) continue
    deps.add(a)
    if (g) deps.add(`${g}:${a}`)
  }
  return { name, deps, modules, aggregator: packaging === 'pom' && modules.length > 0 }
}

/** build.gradle / build.gradle.kts: dependency coordinates and project(':x') references. */
export function parseGradleBuild(text: string): { deps: Set<string> } {
  const deps = new Set<string>()
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const CONFIGS = '(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt|ksp|annotationProcessor|compile|runtime)'
  // "group:artifact:version" in any of the configurations, Groovy or Kotlin syntax.
  for (const m of t.matchAll(new RegExp(`\\b${CONFIGS}\\s*\\(?\\s*(?:platform\\s*\\()?["']([^"':\\s]+):([^"':\\s]+)(?::[^"']*)?["']`, 'g'))) {
    deps.add(m[2])
    deps.add(`${m[1]}:${m[2]}`)
  }
  // Map form: implementation group: 'g', name: 'a'
  for (const m of t.matchAll(/group\s*[:=]\s*["']([^"']+)["']\s*,\s*name\s*[:=]\s*["']([^"']+)["']/g)) {
    deps.add(m[2])
    deps.add(`${m[1]}:${m[2]}`)
  }
  // Module links: project(':core'), project(path: ':core'), projects.core (type-safe accessors)
  // Both the full module path ("core:data", which tells feature:foryou:api from
  // feature:interests:api) and the last segment (how single-level builds name modules).
  const addModule = (path: string): void => {
    deps.add(path)
    deps.add(path.split(':').pop()!)
  }
  for (const m of t.matchAll(/project\s*\(\s*(?:path\s*[:=]\s*)?["']:?([^"']+)["']/g)) addModule(m[1].replace(/^:/, ''))
  for (const m of t.matchAll(/\bprojects\.([A-Za-z0-9_.]+)/g)) {
    addModule(m[1].split('.').map((p) => p.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()).join(':'))
  }
  return { deps }
}

/** settings.gradle(.kts): the root project name and included module paths (as directories). */
export function parseGradleSettings(text: string): { name: string | null; modules: string[] } {
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const name = t.match(/rootProject\.name\s*=\s*["']([^"']+)["']/)?.[1] ?? null
  const modules: string[] = []
  for (const m of t.matchAll(/\binclude\s*\(?([^\n)]*)\)?/g)) {
    for (const q of m[1].matchAll(/["']([^"']+)["']/g)) modules.push(q[1].replace(/^:/, '').split(':').join('/'))
  }
  return { name, modules }
}

export interface DotnetProject {
  name: string
  sdk: string | null
  /** package ids and referenced project names */
  deps: Set<string>
  isTest: boolean
}

export function parseCsproj(text: string, fileName: string): DotnetProject {
  const name = fileName.replace(/\.(cs|fs|vb)proj$/i, '')
  const sdk = text.match(/<Project\s[^>]*Sdk\s*=\s*"([^"]+)"/i)?.[1] ?? null
  const deps = new Set<string>()
  for (const m of text.matchAll(/<PackageReference\s[^>]*Include\s*=\s*"([^"]+)"/gi)) deps.add(m[1])
  for (const m of text.matchAll(/<ProjectReference\s[^>]*Include\s*=\s*"([^"]+)"/gi)) {
    const file = m[1].split(/[\\/]/).pop() ?? m[1]
    deps.add(file.replace(/\.(cs|fs|vb)proj$/i, ''))
  }
  const isTest =
    /\.(Tests?|UnitTests|IntegrationTests|Specs|Benchmarks?)$/i.test(name) ||
    [...deps].some((d) => /^(Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest\.TestFramework)$/i.test(d))
  return { name, sdk, deps, isTest }
}

/** Project files listed in a .sln, relative to it (solution folders skipped). */
export function parseSln(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^Project\("\{[^}]+\}"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.(?:cs|fs|vb)proj)"/gm)) out.push(m[1].replace(/\\/g, '/'))
  return out
}
