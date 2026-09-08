# How to Create a Profile

A profile is one JavaScript object added to the `PROFILES_RAW` array in
`profiles.js`. This file holds *only* profile data — operators, shape,
templates — with zero generation logic in it; everything that actually
builds and validates expressions lives in `generator.js`, which you never
need to open just to add or edit a profile. This guide builds one from
the simplest possible version
up to full atomic control, with a working example at every step. Each
level only adds ONE new idea on top of the last — skip ahead if you
already know the basics.

Every profile has five parts:

```js
{
  meta:      { id, name, description },        // display text
  shape:     { operandSources, operandRange, allowNegativeOperands },
  operators: { allowed, exclude, constraints }, // which operators, and rules on picking them
  extras:    { unaryWrap },                     // ++/--/! behavior (optional, omit if unused)
  scoring:   { itemCount, pointsPerItem },       // how many items, how much each is worth
  template:  '...',                              // the shape of the generated expression
}
```

`template` is the part that actually determines what the student sees.
Everything else configures what fills it in.

---

## Level 1 — The simplest possible profile

Every new profile starts from this shape. Nothing here is optional —
these are the minimum fields a profile needs to generate anything.

```js
{
  meta: {
    id: 'division-practice',
    name: 'Division Practice',
    description: 'Straightforward left-to-right division and subtraction.',
  },
  shape: {
    operandSources: { literal: 4 },
    operandRange: { min: 1, max: 20 },
    allowNegativeOperands: false,
  },
  operators: {
    allowed: ['-', '/'],
  },
  template: 'operand op operand op operand op operand',
  scoring: { itemCount: 5, pointsPerItem: 1 },
}
```

Walking through it:

- **`meta.id`** must be unique — used everywhere else (sidebar, saved
  progress, scoring) to refer to this profile. Lowercase, hyphenated, no
  spaces.
- **`shape.operandSources: { literal: 4 }`** — 4 plain number operands,
  no variables or constants. The count here must always match how many
  *unpinned* operand slots the template has (more on "pinned" in Level 6)
  — 4 in this case.
- **`operators.allowed`** — a plain array of operator symbols. No named
  constant needed; see Level 7 for when a name is worth introducing.
- **`template`** — 4 operand slots joined by 3 operator slots. `op` means
  "pick freely from whatever `operators.allowed` contains" — no
  precedence steering at all. This is the right default any time the
  lesson isn't specifically about controlling operator order.
- **`scoring.itemCount`** — how many generated items this profile
  produces per session. **`pointsPerItem`** — the point value each item
  is worth (explicit here; Level 8 covers letting this be computed
  instead).

That's the whole profile. Add it to `PROFILES_RAW` in `profiles.js` and
it works —
`validateProfiles()` runs automatically at load and will throw a clear
error if anything doesn't line up (see the checklist at the end).

---

## Level 2 — Mixing operand kinds

Real lessons often want variables and constants, not just plain numbers.
Change `operandSources` to a mix, and the pool is drawn randomly from it
in whatever proportion you specify:

```js
shape: {
  operandSources: { literal: 2, variable: 1, constant: 1 },
  operandRange: { min: 1, max: 20 },
  allowNegativeOperands: false,
},
```

The total (`2+1+1 = 4`) must still match the template's operand-slot
count. Nothing about the template changes — `operand` slots don't care
what kind fills them; the kind is decided per-slot at generation time
from this pool, shuffled fresh for every item.

`allowNegativeOperands: true` lets literal operands occasionally roll
negative (about 30% of the time) — only affects `literal`-kind operands,
never variables or constants.

---

## Level 3 — Deliberately controlling precedence

`op` (used so far) draws freely from `allowed` with no steering — fine
when you don't care which specific operator ends up where. When the
*lesson itself* is about precedence (a higher-tier operator must resolve
before a lower one, regardless of position), name the tier explicitly:

```js
operators: {
  allowed: ['+', '-', '*'],
  constraints: { requireMultipleTiers: true },
},
template: 'operand op operand op operand',
```

`requireMultipleTiers: true` rejects any generated instance that
accidentally used only one precedence tier (e.g. `3 + 5 - 2`, no
multiplication at all) — the generator silently retries until it gets a
genuine precedence-mixing example instead. Use this constraint whenever
`allowed` spans more than one tier and the lesson depends on that mix
actually showing up.

The six tier keywords, each filtering `allowed` down to one specific
precedence level:

| Keyword | Matches | Precedence |
|---|---|---|
| `op` | everything in `allowed` | (no filtering) |
| `low` | `+` `-` | 5 |
| `high` | `*` `/` `%` | 6 |
| `cmp` | `<` `>` `<=` `>=` | 4 |
| `eq` | `==` `!=` | 3 |
| `and` | `&&` | 2 |
| `or` | `\|\|` | 1 |

**Rule:** only use a specific tier keyword (`low`/`high`/etc.) when it
narrows `allowed` to a strict subset. If `allowed` is already single-tier
(e.g. `['+', '-']`), writing `low` there filters nothing — use `op`
instead. `validateProfiles()` warns if you use a tier keyword that isn't
actually narrowing anything, so this mistake won't go unnoticed.

---

## Level 4 — Forcing required parentheses

This is the first place templates do something a flat operator list
can't. **A flat run of tier tokens (no explicit grouping) can never
produce required parentheses** — precedence-climbing always builds the
one tree that already prints correctly without them, no matter what
operators or order it picks. To make a lesson specifically about
grouping overriding precedence, you need explicit `(` `)` in the
template:

```js
{
  meta: { id: 'basic-override', name: 'Basic Override',
    description: 'Explicit grouping overrides normal precedence.' },
  shape: { operandSources: { literal: 3 }, operandRange: { min: 1, max: 15 }, allowNegativeOperands: false },
  operators: { allowed: ['+', '-', '*'] },
  template: '(operand low operand) high operand',
  scoring: { itemCount: 5, pointsPerItem: 2 },
}
```

What happens: `(operand low operand)` is built *first*, as its own
complete piece — say `2 + 5` — then handed to the outer level as one
opaque unit, wrapped by `high`: `(2 + 5) * 3`. Because `+` (precedence 5)
sits where `*` (precedence 6) would normally expect something at least
as tight-binding, the parens are structurally *required* — not
decorative — and this happens on **every single generated instance**,
deterministically, because it's a mathematical fact about the two
operators' precedence, not a coin flip.

Nesting works the same way, recursively — a group can contain another
group:

```js
template: '(operand low (operand high operand)) high operand'
```

builds the inner `(operand high operand)` first, embeds it inside the
outer low-then-high group, then wraps the whole thing again.

**Checking your work:** always verify a parens-forcing template actually
produces parens before shipping it — it's easy to get the nesting
direction backwards and accidentally build something that never needs
grouping (see Level 6's worked example, where this exact mistake is
caught and fixed).

---

## Level 5 — Unary operators (`++`, `--`, `!`)

Unary wrap is configured in `extras`, and only applies to slots the
template explicitly tags `:unary`:

```js
extras: {
  unaryWrap: { enabled: true, operators: ['++', '--'], forms: ['prefix', 'postfix'], fraction: 0.6 },
},
template: 'operand:unary op operand:unary op operand:unary',
```

- **`fraction`** — the probability *each* `:unary`-tagged variable slot
  independently gets wrapped. `1.0` means always; `0.6` means roughly
  60% of the time, so some items have every variable wrapped and others
  don't.
- **`:unary` is load-bearing** — only tagged operand slots are ever
  eligible, even if they resolve to a `variable` kind. An untagged
  `operand` slot that happens to land on a variable is never wrapped,
  regardless of `fraction`. Tag every slot you want eligible; leave
  untagged the ones you never want wrapped.
- `!` is different from `++`/`--`: it's the *only* unary operator that
  can wrap a **boolean** variable (see Level 6), and its `forms` is
  always just `['prefix']` — there's no postfix `!`.

---

## Level 6 — Pinned operands, booleans, and comparisons

Everything so far used *unpinned* `operand` slots — kind decided
randomly from the pool. Sometimes a lesson needs a **specific** slot to
be a specific kind, not left to chance. Pin it with `:lit`, `:var`, or
`:const`:

```js
template: '(operand:lit cmp operand:lit) and operand:var:bool or operand:var:bool'
```

- `operand:lit` — this exact slot is always a literal, generated
  directly — **not** counted in `shape.operandSources`, since it never
  draws from the free pool.
- `operand:var:bool` — always a variable, and always boolean-valued
  (`true`/`false`), not numeric.
- `shape.operandSources` only needs to size the *remaining* unpinned
  slots. If every slot in a template is pinned, `operandSources` can be
  omitted entirely.

**Comparisons need care**, because `<`/`>`/`<=`/`>=` only accept numeric
operands, while `==`/`!=` accept *either* two numerics or two booleans —
mixing types is a genuine Java/C compile error the generator actively
prevents (`inferType`, a generation-time safety check — see the checklist).
`constraints.maxComparisons` caps how many comparison-tier operators
(`cmp` *and* `eq` combined) may appear in one item — start at `1` unless
you specifically need more, and if you do, `maxComparisons: 2`+ is safe
precisely because `inferType` rejects anything that wouldn't actually
compile.

### Full worked example: building a comparison-and-boolean profile from scratch

Say the goal is: one comparison, combined with a boolean variable via
`&&`/`||`, where the comparison result gets grouped with one connective
before the other — a genuine required-parens teaching moment.

**First attempt** — looks reasonable, but doesn't actually do what it
promises:

```js
template: '(operand:lit cmp operand:lit) and operand:var:bool or operand:var:bool'
```

Trace it: this template has **no nested grouping** — it's one flat chain
(the outer parens just wrap the comparison alone, which was already
going to bind tightest anyway). Precedence-climbing this produces
`(cmp && var0) || var1` — and because `&&` naturally outranks `||`,
**this never needs parens at all**. The explicit `(` here was decorative,
not structural. This is the single most common mistake when writing a
parens-forcing template: adding parens somewhere that precedence would
already have put there for free changes nothing.

**Fix** — force the *lower*-precedence operator (`or`) to sit where the
*higher*-precedence one (`and`) would normally be expected, by grouping
the comparison together with `or`, not `and`:

```js
template: '(operand:lit cmp operand:lit or operand:var:bool) and operand:var:bool'
```

Now the group `(cmp || var0)` is built first as its own subtree, then
wrapped by `and`. Since `||` (precedence 1) is lower than what `&&`'s
left-hand context requires (precedence 2), the parens are now
structurally required — every time. Verify it actually works before
trusting it (see the checklist below) — don't just eyeball the template
string, run it.

Full profile:

```js
{
  meta: { id: 'compare-and-boolean', name: 'Compare + Boolean',
    description: 'A comparison combined with a boolean via && / ||, requiring explicit grouping.' },
  shape: { operandRange: { min: 1, max: 20 }, allowNegativeOperands: false },
  operators: { allowed: ['<', '>', '<=', '>=', '==', '!=', '&&', '||'] },
  template: '(operand:lit cmp operand:lit or operand:var:bool) and operand:var:bool',
  scoring: { itemCount: 5, pointsPerItem: 3 },
}
```

---

## Level 7 — Full atomic control over operators

`operators.allowed` accepts three forms, cheapest to most bespoke:

**1. A named constant**, for a standard, recognizable, reusable group:

```js
operators: { allowed: OPS.ARITH_ALL }   // + - * /
```

**2. A plain literal array**, for a one-off combination that doesn't
deserve a name:

```js
operators: { allowed: ['*', '%'] }
```

**3. Spread composition**, to reuse a common group plus one exception:

```js
operators: { allowed: [...OPS.ARITH_ALL, '%'] }   // + - * / %
```

**4. `exclude`**, to start broad and carve one operator back out:

```js
operators: { allowed: OPS.ARITH_ALL, exclude: ['/'] }   // + - *
```

**When to name a constant vs. inline it:** only add to `OPS` if the group
is either (a) a real, recognizable domain concept a teacher would know by
name (e.g. "comparison operators"), or (b) reused verbatim by 2+
profiles. A one-off combination invented for a single profile should be a
literal array or spread — inventing a name for it just adds an
indirection the next reader has to go look up.

`ENGINE_OPERATORS` (in `generator.js`) is the full list of operators the
engine actually recognizes — anything in `allowed` outside that set is
rejected at load time with a clear error, not a mysterious failure deep
in generation.

---

## Level 8 — Scoring: explicit or derived

`scoring.pointsPerItem` can be left out entirely, in which case it's
computed from the profile's own complexity (operator count, parens
usage, unary usage, how many distinct operand kinds are involved):

```js
scoring: { itemCount: 5 }   // pointsPerItem auto-derived
```

Specify it explicitly any time you want a specific value regardless of
what the formula would produce:

```js
scoring: { itemCount: 5, pointsPerItem: 3 }   // always exactly 3, no matter what
```

---

## Level 9 — Interactive declaration chains

Profiles remain single-expression activities unless they explicitly opt into
interactive declarations:

```js
program: {
  declarations: 'interactive',
  dependencyMode: 'previous',
  scoreAssignments: true,
}
```

The generated variable and constant operands become executable declarations.
The first receives its seeded value directly. Each later declaration uses the
previous declaration in its initializer while preserving its own seeded value.
Only after the declarations are committed does the existing final-expression
activity unlock.

For a clear declaration-chain lesson, use named operands in
`shape.operandSources`:

```js
shape: {
  operandSources: { variable: 3, constant: 1 },
  operandRange: { min: 2, max: 15 },
  allowNegativeOperands: false,
}
```

Profiles that omit `program`, including the original profiles, keep their
declarations preinitialized and retain the previous scoring behavior.

To select one of the built-in progressive assignment generators, add
`assignmentLesson` while retaining interactive declarations:

```js
program: {
  declarations: 'interactive',
  assignmentLesson: 'add-sub',
  scoreAssignments: true,
}
```

Available lesson keys are `basic-set`, `add-sub`, `multiply`,
`divide-remainder`, `rhs-expression`, `sequential`, `dependent`, and
`advanced`. These generate ordinary `assignment` IR statements; evaluation,
rendering, memory animation, undo, scoring, and persistence are supplied by
the registered capabilities rather than duplicated in the profile.

---

## Checklist before shipping a new profile

1. **Does `shape.operandSources` sum to exactly the template's unpinned
   (free) operand-slot count?** `validateProfiles()` checks this
   automatically at load — if it's wrong, you'll get an error naming the
   profile and the exact mismatch, not a silent bug.
2. **Does every tier keyword you used actually narrow `allowed`?** A
   warning (not an error) prints if a tier keyword resolves to the same
   set `allowed` already was.
3. **If the profile needs required parens, does it actually produce
   them?** Generate a handful of instances and check by eye — or better,
   automate it:

   ```js
   initializeSeededRandom(1);
   for (let i = 0; i < 20; i++) {
     const inst = generateInstance(myProfile);
     console.log(renderString(inst.tree));
   }
   resetRandomGenerator();
   ```

   If none of the samples show parens but you expected them, the
   template's grouping is in the wrong place — see Level 6's worked
   example for the most common way this goes wrong.
4. **If mixing `cmp`/`eq` operators, is `maxComparisons` set high enough
   for what the template actually needs?** Count total comparison-tier
   operators in the template (not just how many *kinds* of comparison
   keyword appear) — `(cmp) eq (cmp)` is 3 operators total (2 relational
   + 1 equality), not 2.
5. **Every operator in `allowed` recognized?** Checked automatically —
   a typo like `'=+'` fails immediately at load, not 300 retries deep in
   generation.
