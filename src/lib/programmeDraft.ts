import type { Field, ProgrammeKind } from '@/lib/programmes'
import { durationText } from '@/lib/words'

/**
 * The programme builder's draft (docs/specs/2026-11-20-programme-builder.md §6). The draft is the
 * `tracker-programme/1` document itself (F1): each field reads and writes one key of it, and a
 * loaded document comes back unchanged when nothing was touched (B3). Writing keeps the keys in
 * their order. A new key goes where the format puts it. None removes the key, so an absent field
 * stays absent. The only state outside the document is the session's: which keys follow a name.
 * Pure, with no I/O: the server's check is the only check (B4), so nothing here validates.
 */

export const FORMAT = 'tracker-programme/1'

/** A parameter, named by `$` and its key: `"$squat"`. */
export type Ref = `$${string}`
/** A number or a parameter: what a progression's `start`, `add` and `rate` hold. */
export type Scalar = number | Ref
/** A value that grows week by week (programmes.md §3). */
export type Progression = {
  start: Scalar
  add?: Scalar
  rate?: Scalar
  every?: number
  max?: number
  step?: number
}
/** A plan field's value: a number, a parameter or a progression. */
export type Value = Scalar | Progression
/** A value chosen at start (programmes.md §2.2). */
export type Param = { label: string; unit: string; default: number; min?: number; max?: number }
/** An activity, keyed as the schema has it. */
export type Activity = {
  key: string
  name: string
  notes?: string
  link?: string
  target?: Value
  sets?: Value
  perSide?: boolean
  reps?: Value
  duration?: Value
  weight?: Value
  distance?: Value
}
/** A percentage of the planned value, as a factor: 90% is `{ scale: 0.9 }`. */
export type Scale = { scale: number }
export type OverrideValue = number | Scale
/** One activity's values in an exception week, or every activity's under `"*"`. */
export type OverrideEntry = Partial<Record<Field, OverrideValue>>
/** An exception week (programmes.md §4). */
export type Override = {
  weeks: number[]
  label?: string
  activities: Record<string, OverrideEntry>
}
/** A `tracker-programme/1` document, keyed as the schema has it. */
export type ProgrammeDoc = {
  format: typeof FORMAT
  name: string
  description?: string
  kind: ProgrammeKind
  weeks: number
  dailyTarget?: number
  params?: Record<string, Param>
  activities: Activity[]
  overrides?: Override[]
}

/** What a value holds (F2). */
export type Shape = 'absent' | 'number' | 'param' | 'progression'
/** What a field offers: None, Stays the same (a number or a parameter) or Grows. */
export type Choice = 'none' | 'stays' | 'grows'
/** Whether an activity counts reps, holds for a time, or neither. */
export type Measure = 'reps' | 'time' | 'neither'
export type GrowsBy = 'add' | 'rate'
/** An exception value: Set to a number, or a percentage of the planned value. */
export type OverrideMode = 'set' | 'percent'
/**
 * The keys added in this session that still follow their name or label (F5). A loaded key is
 * never in it. A key edited by hand leaves it.
 */
export type DraftSession = { followActivities: Set<string>; followParams: Set<string> }
/**
 * Where a server problem shows (F4). `card` null is the foot bar. `index` null with a card is the
 * section as a whole (`activities`, `params`, `overrides`). `fieldId` is the field inside the card:
 * `weight.add` in an activity, `activities.*.sets` or `weeks` in an exception week, `default` in a
 * parameter, `name` in the programme.
 */
export type ProblemPlace = {
  card: 'programme' | 'activity' | 'override' | 'param' | null
  index: number | null
  fieldId: string | null
}

// -- key order --

const DOC_ORDER = [
  'format',
  'name',
  'description',
  'kind',
  'weeks',
  'dailyTarget',
  'params',
  'activities',
  'overrides',
]
const ACTIVITY_ORDER = [
  'key',
  'name',
  'notes',
  'link',
  'target',
  'sets',
  'perSide',
  'reps',
  'duration',
  'weight',
  'distance',
]
const PROGRESSION_ORDER = ['start', 'add', 'rate', 'every', 'max', 'step']
const PARAM_ORDER = ['label', 'unit', 'default', 'min', 'max']
const OVERRIDE_ORDER = ['weeks', 'label', 'activities']
const ENTRY_ORDER = ['target', 'sets', 'reps', 'duration', 'weight', 'distance']

/**
 * Writes `key` on `obj` in place. An existing key keeps its place. A new key goes before the first
 * key the order puts after it. `undefined` removes the key.
 */
function putKey(obj: object, key: string, value: unknown, order: readonly string[]): void {
  const rec = obj as Record<string, unknown>
  if (value === undefined) {
    delete rec[key]
    return
  }
  if (key in rec) {
    rec[key] = value
    return
  }
  const rank = order.indexOf(key)
  const keys = Object.keys(rec)
  const at = keys.findIndex((k) => order.indexOf(k) > rank)
  const after = at < 0 ? [] : keys.slice(at).map((k) => [k, rec[k]] as const)
  for (const [k] of after) delete rec[k]
  rec[key] = value
  for (const [k, v] of after) rec[k] = v
}

/** Renames a key in place, keeping every key's position. */
function renameKey(obj: Record<string, unknown>, old: string, next: string): void {
  const entries = Object.entries(obj)
  for (const [k] of entries) delete obj[k]
  for (const [k, v] of entries) obj[k === old ? next : k] = v
}

export function setDocField<K extends keyof ProgrammeDoc>(
  doc: ProgrammeDoc,
  key: K,
  value: ProgrammeDoc[K] | undefined,
): void {
  putKey(doc, key, value, DOC_ORDER)
}

export function setActivityField<K extends keyof Activity>(
  activity: Activity,
  key: K,
  value: Activity[K] | undefined,
): void {
  putKey(activity, key, value, ACTIVITY_ORDER)
}

export function setProgressionField<K extends keyof Progression>(
  progression: Progression,
  key: K,
  value: Progression[K] | undefined,
): void {
  putKey(progression, key, value, PROGRESSION_ORDER)
}

export function setParamField<K extends keyof Param>(
  param: Param,
  key: K,
  value: Param[K] | undefined,
): void {
  putKey(param, key, value, PARAM_ORDER)
}

export function setOverrideField<K extends keyof Override>(
  override: Override,
  key: K,
  value: Override[K] | undefined,
): void {
  putKey(override, key, value, OVERRIDE_ORDER)
}

// -- loading --

/** A stored document as a draft: a deep copy, keys in the same order. */
export function loadDraft(doc: unknown): ProgrammeDoc {
  return JSON.parse(JSON.stringify(doc)) as ProgrammeDoc
}

/** The draft as a document to send: a deep copy, so later edits don't reach it. */
export function toDocument(doc: ProgrammeDoc): ProgrammeDoc {
  return loadDraft(doc)
}

/** An empty programme for Build a programme. */
export function newProgramme(): ProgrammeDoc {
  return { format: FORMAT, name: '', kind: 'strength', weeks: 8, activities: [] }
}

export function newSession(): DraftSession {
  return { followActivities: new Set(), followParams: new Set() }
}

// -- fields --

/** The plan fields each kind has (programmes.md §2.1), `perSide` included. */
type PlanKey = Field | 'perSide'
const PLAN_KEYS: PlanKey[] = ['target', 'sets', 'perSide', 'reps', 'duration', 'weight', 'distance']
const VALUE_FIELDS: Field[] = ['target', 'sets', 'reps', 'duration', 'weight', 'distance']
const KIND_KEYS: Record<ProgrammeKind, PlanKey[]> = {
  strength: ['target', 'sets', 'perSide', 'reps', 'duration', 'weight'],
  mobility: ['target', 'sets', 'perSide', 'reps', 'duration'],
  cardio: ['target', 'duration', 'distance'],
}
const LABELS: Record<PlanKey, string> = {
  target: 'Times a week',
  sets: 'Sets',
  perSide: 'Sides',
  reps: 'Reps',
  duration: 'Hold',
  weight: 'Weight',
  distance: 'Distance',
}

/** A field's label in the form: "Weight", "Hold" (a cardio session's duration is "Time"). */
export function fieldLabel(kind: ProgrammeKind, field: PlanKey): string {
  return field === 'duration' && kind === 'cardio' ? 'Time' : LABELS[field]
}

/** What a field starts at when it is first given a value. */
const START: Record<Field, number> = {
  target: 3,
  sets: 3,
  reps: 10,
  duration: 30,
  weight: 20,
  distance: 5,
}
/** What a field grows by when it first grows: one of its unit, or a step of it. */
const ADD: Record<Field, number> = {
  target: 1,
  sets: 1,
  reps: 1,
  duration: 5,
  weight: 2.5,
  distance: 0.5,
}
const NEW_ACTIVITY: Record<ProgrammeKind, Partial<Activity>> = {
  strength: { sets: 3, reps: 10 },
  mobility: { sets: 2, duration: 30 },
  cardio: { duration: 1800 },
}

function isRef(v: unknown): v is Ref {
  return typeof v === 'string'
}

function isProgression(v: Value | undefined): v is Progression {
  return typeof v === 'object'
}

// -- shapes --

export function shapeOf(value: Value | undefined): Shape {
  if (value === undefined) return 'absent'
  if (typeof value === 'number') return 'number'
  return isRef(value) ? 'param' : 'progression'
}

export function choiceOf(value: Value | undefined): Choice {
  const shape = shapeOf(value)
  if (shape === 'absent') return 'none'
  return shape === 'progression' ? 'grows' : 'stays'
}

function paramDefault(doc: ProgrammeDoc, ref: Ref): number | undefined {
  return doc.params?.[ref.slice(1)]?.default
}

/**
 * The value switched to another shape, keeping what it can (F2). Growing uses the value as the
 * start. A number keeps a progression's start, or takes a parameter's default. A parameter is the
 * one named, else the one the value already uses, else the first. With no parameters, the value
 * stays as it is.
 */
export function switchShape(
  doc: ProgrammeDoc,
  field: Field,
  value: Value | undefined,
  to: Shape,
  paramKey?: string,
): Value | undefined {
  if (shapeOf(value) === to && paramKey === undefined) return value
  const base = isProgression(value) ? value.start : value
  switch (to) {
    case 'absent':
      return undefined
    case 'number':
      if (typeof base === 'number') return base
      return (base === undefined ? undefined : paramDefault(doc, base)) ?? START[field]
    case 'param': {
      const key = paramKey ?? (isRef(base) ? base.slice(1) : Object.keys(doc.params ?? {})[0])
      return key === undefined ? value : `$${key}`
    }
    case 'progression':
      return { start: base ?? START[field], add: ADD[field] }
  }
}

/** The value for a press on None, Stays the same or Grows. Stays keeps a progression's start. */
export function choose(
  doc: ProgrammeDoc,
  field: Field,
  value: Value | undefined,
  choice: Choice,
): Value | undefined {
  if (choice === 'none') return undefined
  if (choice === 'grows') return switchShape(doc, field, value, 'progression')
  if (isProgression(value)) return value.start
  return value ?? START[field]
}

/** Whether a progression grows by its unit (`add`) or by a percentage (`rate`). */
export function growsBy(p: Progression): GrowsBy {
  return 'rate' in p ? 'rate' : 'add'
}

/** Switches Grows by between the unit and %, moving the amount to the other key. */
export function setGrowsBy(p: Progression, by: GrowsBy): void {
  if (growsBy(p) === by) return
  const amount = by === 'add' ? p.rate : p.add
  delete p[by === 'add' ? 'rate' : 'add']
  setProgressionField(p, by, amount)
}

// -- measure --

export function measureOf(activity: Activity): Measure {
  if ('reps' in activity) return 'reps'
  return 'duration' in activity ? 'time' : 'neither'
}

/**
 * Sets an activity's measure. The field it loses goes, with the activity's own exception values
 * for it. The field it gains starts at a default; one it already has is kept.
 */
export function setMeasure(doc: ProgrammeDoc, activity: Activity, measure: Measure): void {
  const lose: Field[] =
    measure === 'reps' ? ['duration'] : measure === 'time' ? ['reps'] : ['reps', 'duration']
  for (const f of lose) delete activity[f]
  if (measure === 'reps' && activity.reps === undefined) {
    setActivityField(activity, 'reps', START.reps)
  }
  if (measure === 'time' && activity.duration === undefined) {
    setActivityField(activity, 'duration', START.duration)
  }
  dropEntries(doc, (key, field) => key === activity.key && lose.includes(field))
}

// -- exception weeks --

/**
 * Removes the exception values `drop` picks. An entry left empty goes, and so does an exception
 * week left with no values: the server refuses one, and it would change nothing.
 */
function dropEntries(doc: ProgrammeDoc, drop: (key: string, field: Field) => boolean): void {
  const overrides = doc.overrides
  if (!overrides) return
  for (const o of overrides) {
    for (const [key, entry] of Object.entries(o.activities)) {
      for (const f of Object.keys(entry) as Field[]) if (drop(key, f)) delete entry[f]
      if (!Object.keys(entry).length) delete o.activities[key]
    }
  }
  const kept = overrides.filter((o) => Object.keys(o.activities).length > 0)
  if (kept.length === overrides.length) return
  setDocField(doc, 'overrides', kept.length ? kept : undefined)
}

/** Writes one exception value for an activity key or `"*"`; None removes it. */
export function setOverrideValue(
  override: Override,
  key: string,
  field: Field,
  value: OverrideValue | undefined,
): void {
  const entry = override.activities[key] ?? {}
  putKey(entry, field, value, ENTRY_ORDER)
  if (Object.keys(entry).length) override.activities[key] = entry
  else delete override.activities[key]
}

/** A rest (K191): the key's own Times a week Set to 0 in the exception's weeks. */
export function isRest(override: Override, key: string): boolean {
  return override.activities[key]?.target === 0
}

/** Ticks a rest, writing Times a week 0, or unticks it, removing the key's Times a week. */
export function setRest(override: Override, key: string, on: boolean): void {
  setOverrideValue(override, key, 'target', on ? 0 : undefined)
}

const WEEKS_HINT = 'Type the weeks, like 4, 8.'

/** Typed weeks, "4, 8", as `[4, 8]`; a week typed twice counts once. */
export function parseWeeks(text: string): { weeks: number[] } | { error: string } {
  const tokens = text.split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return { error: WEEKS_HINT }
  const bad = tokens.find((t) => !/^\d+$/.test(t))
  if (bad !== undefined) return { error: `“${bad}” isn’t a week number. ${WEEKS_HINT}` }
  return { weeks: [...new Set(tokens.map(Number))] }
}

export function formatWeeks(weeks: number[]): string {
  return weeks.join(', ')
}

export function overrideMode(value: OverrideValue): OverrideMode {
  return typeof value === 'number' ? 'set' : 'percent'
}

/** The number the field shows: the value Set to, or the percentage (`{ scale: 0.9 }` is 90). */
export function overrideNumber(value: OverrideValue): number {
  return typeof value === 'number' ? value : Math.round(value.scale * 100 * 1e6) / 1e6
}

export function overrideValue(mode: OverrideMode, n: number): OverrideValue {
  return mode === 'set' ? n : { scale: n / 100 }
}

// -- kind --

/** The lines a kind change's ConfirmDialog names (F6): "Weight goes from 4 activities." */
export function kindChangeLines(doc: ProgrammeDoc, kind: ProgrammeKind): string[] {
  const keep = KIND_KEYS[kind]
  const lines = PLAN_KEYS.filter((f) => !keep.includes(f)).flatMap((f) => {
    const n = doc.activities.filter((a) => f in a).length
    const what = n === 1 ? 'activity' : 'activities'
    return n ? [`${fieldLabel(doc.kind, f)} goes from ${n} ${what}.`] : []
  })
  if (kind === 'cardio' && doc.dailyTarget !== undefined) lines.push('The daily target goes.')
  return lines
}

/** Changes the kind, dropping the fields the new kind has no place for, exceptions included. */
export function applyKind(doc: ProgrammeDoc, kind: ProgrammeKind): void {
  const keep = KIND_KEYS[kind]
  for (const a of doc.activities) {
    for (const f of PLAN_KEYS) if (!keep.includes(f)) delete a[f]
  }
  dropEntries(doc, (_key, field) => !keep.includes(field))
  if (kind === 'cardio') delete doc.dailyTarget
  doc.kind = kind
}

// -- keys (F5) --

const MAX_KEY = 40

/** A key from a name: lowercase a-z and 0-9, other runs as "-", at most 40 characters. */
export function slugKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KEY)
    .replace(/-+$/, '')
}

/** `base` (or `fallback` when empty), with "-2", "-3" until no key in `taken` has it. */
export function uniqueKey(base: string, taken: Iterable<string>, fallback: string): string {
  const root = base || fallback
  const used = new Set(taken)
  if (!used.has(root)) return root
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const key = `${root.slice(0, MAX_KEY - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!used.has(key)) return key
  }
}

/** Adds an activity of the programme's kind, its key made from its name and following it. */
export function addActivity(doc: ProgrammeDoc, session: DraftSession, name = ''): Activity {
  const key = uniqueKey(
    slugKey(name),
    doc.activities.map((a) => a.key),
    'activity',
  )
  const activity: Activity = { key, name, ...NEW_ACTIVITY[doc.kind] }
  doc.activities.push(activity)
  session.followActivities.add(key)
  return activity
}

/** Gives an activity a new key; its exception entries follow, unless another activity has the old key. */
function moveActivityKey(doc: ProgrammeDoc, activity: Activity, next: string): void {
  const old = activity.key
  activity.key = next
  if (doc.activities.some((a) => a.key === old)) return
  for (const o of doc.overrides ?? []) renameKey(o.activities, old, next)
}

/** Renames an activity. A key added this session and not edited by hand follows the name. */
export function renameActivity(
  doc: ProgrammeDoc,
  session: DraftSession,
  index: number,
  name: string,
): void {
  const activity = doc.activities[index]
  if (!activity) return
  activity.name = name
  if (!session.followActivities.has(activity.key)) return
  const others = doc.activities.filter((a) => a !== activity).map((a) => a.key)
  const next = uniqueKey(slugKey(name), others, 'activity')
  session.followActivities.delete(activity.key)
  session.followActivities.add(next)
  moveActivityKey(doc, activity, next)
}

/** The key edited under More. It stops following the name. Null, or why the key can't be used. */
export function setActivityKey(
  doc: ProgrammeDoc,
  session: DraftSession,
  index: number,
  key: string,
): string | null {
  const activity = doc.activities[index]
  if (!activity) return null
  if (doc.activities.some((a, i) => i !== index && a.key === key)) {
    return `Another activity has the key ${key}.`
  }
  session.followActivities.delete(activity.key)
  moveActivityKey(doc, activity, key)
  return null
}

/** Adds a value chosen at start, its key made from its label and following it. Returns the key. */
export function addParam(
  doc: ProgrammeDoc,
  session: DraftSession,
  label = '',
  unit = '',
  value = 0,
): string {
  const params = doc.params ?? {}
  const key = uniqueKey(slugKey(label), Object.keys(params), 'value')
  params[key] = { label, unit, default: value }
  setDocField(doc, 'params', params)
  session.followParams.add(key)
  return key
}

function refersTo(value: Value | undefined, ref: Ref): boolean {
  if (!isProgression(value)) return value === ref
  return value.start === ref || value.add === ref || value.rate === ref
}

/** Renames a parameter's key in place; every `"$key"` reference follows. */
function moveParamKey(doc: ProgrammeDoc, params: Record<string, Param>, old: string, next: string) {
  renameKey(params, old, next)
  const from: Ref = `$${old}`
  const to: Ref = `$${next}`
  for (const a of doc.activities) {
    for (const f of VALUE_FIELDS) {
      const v = a[f]
      if (v === from) a[f] = to
      if (!isProgression(v)) continue
      if (v.start === from) v.start = to
      if (v.add === from) v.add = to
      if (v.rate === from) v.rate = to
    }
  }
}

/** Relabels a parameter. A key added this session follows the label. Returns the key it has now. */
export function renameParam(
  doc: ProgrammeDoc,
  session: DraftSession,
  key: string,
  label: string,
): string {
  const params = doc.params ?? {}
  const param = params[key]
  if (!param) return key
  param.label = label
  if (!session.followParams.has(key)) return key
  const next = uniqueKey(
    slugKey(label),
    Object.keys(params).filter((k) => k !== key),
    'value',
  )
  session.followParams.delete(key)
  session.followParams.add(next)
  moveParamKey(doc, params, key, next)
  return next
}

/** The key edited under More. It stops following the label. Null, or why the key can't be used. */
export function setParamKey(
  doc: ProgrammeDoc,
  session: DraftSession,
  key: string,
  next: string,
): string | null {
  const params = doc.params ?? {}
  if (!(key in params)) return null
  if (next !== key && next in params) return `Another value has the key ${next}.`
  session.followParams.delete(key)
  moveParamKey(doc, params, key, next)
  return null
}

// -- removing (F7) --

/** Removes an activity, and its exception entries when no other activity has its key. */
export function removeActivity(doc: ProgrammeDoc, session: DraftSession, index: number): void {
  const [gone] = doc.activities.splice(index, 1)
  if (!gone) return
  session.followActivities.delete(gone.key)
  if (doc.activities.some((a) => a.key === gone.key)) return
  dropEntries(doc, (key) => key === gone.key)
}

/** Moves an activity one place up (-1) or down (1). False when it is already at that end. */
export function moveActivity(doc: ProgrammeDoc, index: number, by: -1 | 1): boolean {
  const a = doc.activities[index]
  const b = doc.activities[index + by]
  if (!a || !b) return false
  doc.activities[index] = b
  doc.activities[index + by] = a
  return true
}

/** The fields that use a parameter, by name: "Back squat’s weight". */
export function paramUses(doc: ProgrammeDoc, key: string): string[] {
  const ref: Ref = `$${key}`
  return doc.activities.flatMap((a) =>
    VALUE_FIELDS.filter((f) => refersTo(a[f], ref)).map(
      (f) => `${a.name}’s ${fieldLabel(doc.kind, f).toLowerCase()}`,
    ),
  )
}

function listText(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Removes a parameter. A parameter a field uses stays, and the answer names the fields. Null when
 * it went (or was never there).
 */
export function removeParam(
  doc: ProgrammeDoc,
  key: string,
): { usedBy: string[]; message: string } | null {
  const params = doc.params ?? {}
  const param = params[key]
  if (!param) return null
  const usedBy = paramUses(doc, key)
  if (usedBy.length) {
    const one = usedBy.length === 1
    const message = `${listText(usedBy)} ${one ? 'uses' : 'use'} ${param.label}. Give ${one ? 'that field' : 'those fields'} a number first, then remove it.`
    return { usedBy, message }
  }
  delete params[key]
  if (!Object.keys(params).length) delete doc.params
  return null
}

// -- problems (F4) --

/** A server path's parts: `activities[3].weight.add` is `['activities', 3, 'weight', 'add']`. */
function pathParts(path: string): (string | number)[] {
  const token = /\.?([\w*$-]+)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y
  const parts: (string | number)[] = []
  let m: RegExpExecArray | null
  while (token.lastIndex < path.length && (m = token.exec(path))) {
    parts.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (JSON.parse(m[3]!) as string)))
  }
  return parts
}

/** The card and field a server problem's path belongs to (F4). */
export function problemPlace(doc: ProgrammeDoc, path: string): ProblemPlace {
  const [head, at, ...rest] = pathParts(path)
  const index = typeof at === 'number' ? at : null
  const names = rest.filter((p): p is string => typeof p === 'string')
  switch (head) {
    case undefined:
      return { card: null, index: null, fieldId: null }
    case 'activities':
      return { card: 'activity', index, fieldId: names.slice(0, 2).join('.') || null }
    case 'overrides':
      return { card: 'override', index, fieldId: names.slice(0, 3).join('.') || null }
    case 'params': {
      const i = Object.keys(doc.params ?? {}).indexOf(String(at))
      return { card: 'param', index: i < 0 ? null : i, fieldId: names[0] ?? null }
    }
    default:
      return { card: 'programme', index: null, fieldId: String(head) }
  }
}

// -- words --

/**
 * A number in a field's unit: "40 kg", "3 km"; reps and sets bare, or counted. A hold is in
 * seconds ("90 s"); a cardio session reads as the Chip card does ("1 min 30 s").
 */
function amount(kind: ProgrammeKind, field: Field, n: number, counted: boolean): string {
  switch (field) {
    case 'weight':
      return `${n} kg`
    case 'distance':
      return `${n} km`
    case 'duration':
      return kind === 'cardio' ? durationText(n) : `${n} s`
    default: {
      if (!counted) return String(n)
      const noun = field === 'sets' ? 'set' : 'rep'
      return `${n} ${n === 1 ? noun : `${noun}s`}`
    }
  }
}

/** A number or a parameter in words; a parameter is its default and its label: "40 kg (Squat start)". */
function scalarText(
  doc: ProgrammeDoc,
  field: Field,
  v: Scalar,
  counted: boolean,
  rate = false,
): string {
  const show = (n: number) => (rate ? `${n}%` : amount(doc.kind, field, n, counted))
  if (typeof v === 'number') return show(v)
  const param = doc.params?.[v.slice(1)]
  return param ? `${show(param.default)} (${param.label})` : v
}

/** An increase with its sign: "+2.5 kg", "−10%", "+5% (Weekly increase)". */
function signed(doc: ProgrammeDoc, field: Field, v: Scalar, counted: boolean, rate: boolean) {
  if (typeof v !== 'number') return `+${scalarText(doc, field, v, counted, rate)}`
  return `${v < 0 ? '−' : '+'}${scalarText(doc, field, Math.abs(v), counted, rate)}`
}

/** How a progression grows and its cap: "+5 s every 2 weeks, up to 90 s". */
function growthText(doc: ProgrammeDoc, field: Field, p: Progression, counted: boolean): string {
  const parts: string[] = []
  const every = (p.every ?? 1) > 1 ? `every ${p.every} weeks` : 'a week'
  if (p.add !== undefined) parts.push(`${signed(doc, field, p.add, counted, false)} ${every}`)
  else if (p.rate !== undefined) parts.push(`${signed(doc, field, p.rate, counted, true)} ${every}`)
  if (p.max !== undefined) parts.push(`up to ${amount(doc.kind, field, p.max, counted)}`)
  return parts.join(', ')
}

function valueText(doc: ProgrammeDoc, field: Field, value: Value, counted: boolean): string {
  if (!isProgression(value)) return scalarText(doc, field, value, counted)
  const start = scalarText(doc, field, value.start, counted)
  return [start, growthText(doc, field, value, counted)].filter(Boolean).join(', ')
}

/** One value's line in an open card: "30 s, +5 s every 2 weeks, up to 90 s", or "None". */
export function valueLine(doc: ProgrammeDoc, field: Field, value: Value | undefined): string {
  return value === undefined ? 'None' : valueText(doc, field, value, false)
}

/** A value chosen at start as a Menu shows it: "Squat start · 40 kg". */
export function paramText(doc: ProgrammeDoc, key: string): string {
  const param = doc.params?.[key]
  if (!param) return `$${key}`
  const value = param.unit === '%' ? `${param.default}%` : `${param.default} ${param.unit}`.trim()
  return `${param.label} · ${value}`
}

function startOf(value: Value | undefined): Scalar | undefined {
  return isProgression(value) ? value.start : value
}

/**
 * A closed card's rule line: "5 × 5 · 40 kg, +2.5 kg a week", "3 × 30 s · +5 s every 2 weeks, up
 * to 90 s". Sets and reps (or the hold) lead, then how they grow, then the weight. A cardio
 * session is its time, then its distance. Times a week has its own place on the card.
 */
export function ruleLine(doc: ProgrammeDoc, activity: Activity): string {
  const parts: string[] = []
  if (doc.kind === 'cardio') {
    for (const f of ['duration', 'distance'] as const) {
      const v = activity[f]
      if (v !== undefined) parts.push(valueText(doc, f, v, false))
    }
    return parts.join(' · ') || 'No values yet.'
  }
  const sets = startOf(activity.sets)
  const reps = startOf(activity.reps)
  const per: [Field, Scalar] | null =
    reps !== undefined
      ? ['reps', reps]
      : activity.duration !== undefined
        ? ['duration', startOf(activity.duration)!]
        : null
  let head: string | null = null
  if (sets !== undefined && per) {
    head = `${scalarText(doc, 'sets', sets, false)} × ${scalarText(doc, per[0], per[1], false)}`
  } else if (sets !== undefined) head = scalarText(doc, 'sets', sets, true)
  else if (per) head = scalarText(doc, per[0], per[1], true)
  if (activity.perSide) head = head ? `${head} each side` : 'Each side'
  if (head) parts.push(head)
  for (const f of ['sets', 'reps', 'duration'] as const) {
    const v = activity[f]
    if (!isProgression(v)) continue
    const growth = growthText(doc, f, v, true)
    if (growth) parts.push(growth)
  }
  if (activity.weight !== undefined) parts.push(valueText(doc, 'weight', activity.weight, false))
  return parts.join(' · ') || 'No values yet.'
}
