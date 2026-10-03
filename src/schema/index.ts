import { z } from 'zod';
import type { AnyKit, Kit } from '../kit';
import type { Condition, JsonValue, Tutorial } from '../types';

/**
 * Validation for tutorial scripts that arrive as DATA (a `.json` file, a
 * docs-site link, another tab) — built from the app's kit, so a name the app
 * didn't register is an error, not a silent no-op. The same schema emits a
 * JSON Schema for editor autocompletion (`tutorialJsonSchema`).
 *
 * Size limits are part of the schema: they are what keeps a script from an
 * untrusted source from being a denial of service.
 */

const MOODS = ['neutral', 'happy', 'excited', 'thinking', 'pointing', 'surprised', 'concerned', 'celebrate'] as const;
const PLACEMENTS = ['auto', 'top', 'bottom', 'left', 'right', 'center'] as const;
const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TUTORIAL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function nameEnum(names: readonly string[]) {
  return names.length > 0 ? z.enum(names as [string, ...string[]]) : z.never();
}

function tutorialSchema(kit: AnyKit) {
  const target = nameEnum(kit.targetNames);
  const event = nameEnum(kit.events);
  const predicate = nameEnum(kit.predicateNames);
  const assist = nameEnum(kit.assistNames);

  const json: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(json).max(100), z.record(z.string().max(64), json)]),
  );
  const args = z.record(z.string().max(64), json).optional();
  const line = z.strictObject({ say: z.string().min(1).max(400), mood: z.enum(MOODS).optional() });
  const lines = z.array(line).min(1).max(6);
  const condition: z.ZodType<Condition> = z.lazy(() =>
    z.union([
      z.strictObject({ pred: predicate, args }),
      z.strictObject({ not: condition }),
      z.strictObject({ all: z.array(condition).min(1).max(20) }),
      z.strictObject({ any: z.array(condition).min(1).max(20) }),
    ]),
  );
  const goto = z.string().min(1).max(64);
  const transition = z.union([
    z.strictObject({
      on: z.strictObject({ event, args, count: z.number().int().min(1).max(100).optional() }),
      goto,
    }),
    z.strictObject({ when: condition, goto }),
  ]);
  const targetRef = z.strictObject({ name: target, args });
  const base = { id: z.string().regex(STEP_ID), skipIf: condition.optional(), checkpoint: z.boolean().optional() };

  const step = z.discriminatedUnion('type', [
    z.strictObject({ ...base, type: z.literal('say'), lines }),
    z.strictObject({
      ...base,
      type: z.literal('point'),
      target: targetRef,
      allow: z.array(targetRef).max(8).optional(),
      lines,
      advance: z.array(transition).min(1).max(10),
      timeoutMs: z.number().int().min(0).max(600_000).optional(),
      hint: lines.optional(),
      assist: z.strictObject({ name: assist, args, label: z.string().max(60).optional() }).optional(),
      placement: z.enum(PLACEMENTS).optional(),
      next: z.boolean().optional(),
    }),
    z.strictObject({
      ...base,
      type: z.literal('choice'),
      lines,
      options: z.array(z.strictObject({ label: z.string().min(1).max(60), goto })).min(1).max(6),
    }),
    z.strictObject({ ...base, type: z.literal('branch'), if: condition, then: goto, else: goto }),
    z.strictObject({ ...base, type: z.literal('end'), lines, outcome: z.enum(['completed', 'aborted']).optional() }),
  ]);

  return z
    .strictObject({
      $schema: z.string().max(500).optional(),
      format: z.literal(1),
      id: z.string().regex(TUTORIAL_ID),
      revision: z.number().int().min(0),
      title: z.string().min(1).max(120),
      summary: z.string().max(400).optional(),
      estimatedMinutes: z.number().min(0).max(120).optional(),
      requires: z.array(z.string().max(64)).max(20).optional(),
      steps: z.array(step).min(1).max(60),
    })
    .superRefine((tutorial, context) => {
      // Step ids are unique, and every goto names a real step.
      const ids = new Set<string>();
      tutorial.steps.forEach((candidate, index) => {
        if (ids.has(candidate.id)) {
          context.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: `duplicate step id "${candidate.id}"` });
        }
        ids.add(candidate.id);
      });
      const check = (value: string, path: (string | number)[]) => {
        if (value !== 'next' && value !== 'prev' && value !== 'end' && !ids.has(value)) {
          context.addIssue({ code: 'custom', path, message: `goto "${value}" is not a step` });
        }
      };
      tutorial.steps.forEach((candidate, index) => {
        if (candidate.type === 'point') {
          candidate.advance.forEach((transition, t) => check(transition.goto, ['steps', index, 'advance', t, 'goto']));
        } else if (candidate.type === 'choice') {
          candidate.options.forEach((option, o) => check(option.goto, ['steps', index, 'options', o, 'goto']));
        } else if (candidate.type === 'branch') {
          check(candidate.then, ['steps', index, 'then']);
          check(candidate.else, ['steps', index, 'else']);
        }
      });
    });
}

type ParseIssue = { path: string; message: string };
type ParseResult<K extends AnyKit> =
  | { ok: true; tutorial: K extends Kit<infer T, infer E, infer P, infer A> ? Tutorial<T, E, P, A> : Tutorial }
  | { ok: false; issues: ParseIssue[] };

/**
 * Validate a script: an object, or JSON text (checked against `maxBytes`
 * BEFORE parsing). Never throws.
 */
function parseTutorial<K extends AnyKit>(kit: K, input: unknown, options: { maxBytes?: number } = {}): ParseResult<K> {
  let value = input;
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input).length;
    if (options.maxBytes !== undefined && bytes > options.maxBytes) {
      return { ok: false, issues: [{ path: '', message: `script is ${bytes} bytes; the limit is ${options.maxBytes}` }] };
    }
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { ok: false, issues: [{ path: '', message: `not JSON: ${error instanceof Error ? error.message : 'parse error'}` }] };
    }
  }
  const result = tutorialSchema(kit).safeParse(value) as
    | { success: true; data: unknown }
    | { success: false; error: { issues: RawIssue[] } };
  if (result.success) {
    return { ok: true, tutorial: result.data as ParseResult<K> extends { ok: true; tutorial: infer X } ? X : never } as ParseResult<K>;
  }
  return { ok: false, issues: result.error.issues.flatMap((issue) => flattenIssue(issue, [])).slice(0, 20) };
}

type RawIssue = { path: PropertyKey[]; message: string; code?: string; errors?: RawIssue[][] };

/**
 * A failed union ("a transition is an `on` OR a `when`") is reported by zod
 * at the union itself. Authors need the exact field, so descend into the
 * branch that got FURTHEST (its deepest issue path) and report from there.
 */
function flattenIssue(issue: RawIssue, prefix: PropertyKey[]): ParseIssue[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === 'invalid_union' && issue.errors && issue.errors.length > 0) {
    const depth = (branch: RawIssue[]) => Math.max(...branch.map((inner) => inner.path.length));
    const best = [...issue.errors].sort((a, b) => depth(b) - depth(a))[0];
    if (best.length > 0) return best.flatMap((inner) => flattenIssue(inner, path));
  }
  return [{ path: path.map(String).join('.'), message: issue.message }];
}

/** A JSON Schema (draft 2020-12) of this kit's scripts — point a script's
 *  `"$schema"` at it for autocompletion in editors. */
function tutorialJsonSchema(kit: AnyKit): Record<string, unknown> {
  return z.toJSONSchema(tutorialSchema(kit), { unrepresentable: 'any' }) as Record<string, unknown>;
}

export { parseTutorial, tutorialJsonSchema, tutorialSchema };
export type { ParseIssue, ParseResult };
