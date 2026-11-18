import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The shared contract with the API's tests: the cases live in fixtures/transfer/ as JSON.
// (jsdom gives import.meta.url an http: scheme, so resolve from the file's directory instead.)
const FIXTURES = join(import.meta.dirname, '../../../fixtures/transfer')

/** A fixture file by its path under `fixtures/transfer/`. */
export function readFixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as T
}

/**
 * A programme document from fixtures/programmes/, read at run time like the transfer cases: a
 * static JSON import would make the app's type-check (and so the Docker build, whose context
 * leaves fixtures/ out) need the file.
 */
export function readProgrammeFixture(path: string): Record<string, unknown> {
  const file = join(import.meta.dirname, '../../../fixtures/programmes', path)
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

/** Every `.json` file in a fixture directory, sorted, as `[filename, contents]`. */
export function fixtureCases<T>(dir: string): [string, T][] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [f, readFixture<T>(`${dir}/${f}`)])
}
