# Precedify — Extensible Program Foundation

This rewrite preserves the current Precedify expression activity and adds
opt-in declaration and assignment-statement chains.

## What remains unchanged

- The 18 current profiles and seeded expression generation
- Student-controlled substitution and operator selection
- Precedence checking and canonical playback
- Practice/exam rules, timer, persistence and score formulas
- Drawers, connector lines, variable-state display and animations

Existing generated items are automatically wrapped as one
`legacy-expression` statement. Their original fields remain authoritative, so
the compatibility layer does not translate or duplicate active expression
state.

## Profiles

The original 18 profiles are unchanged and still use one
`legacy-expression` statement. `declaration-chain` teaches executable
declarations. Eight additive assignment profiles progress through `=`, `+=`,
`-=`, `*=`, `/=`, `%=` and dependent mixed chains before unlocking the same
final-expression evaluator.

Compound assignments use an explicit read–modify–write interaction: the
student reveals the target's current memory value, resolves the RHS, then
applies the compound operator. The two values converge into one updated target
card before the existing expression-to-memory animation writes it back. Plain
`=` assignments keep the original compact destination-and-RHS behavior.

For a dependent declaration such as `int y = x + 5;`, the student substitutes
the initialized value of `x`, evaluates the initializer, and clicks `=` to
commit `y` to program memory. Declaration evaluation and assignment checks are
included in the same per-item point budget.

## Extensible foundation

- `js/program-ir.js` defines language-neutral statement/expression shapes.
- `js/program-core.js` owns ordered programs and statement/renderer registries.
- `js/legacy-expression-plugin.js` adapts the existing activity to the new
  dispatch contract.
- `renderProgramItem()` is now the main rendering entry point.
- Existing saved items without a program envelope are upgraded in memory when
  restored.
- `js/declaration-statement-plugin.js` implements declaration semantics.
- `js/assignment-statement-plugin.js` implements assignment semantics.
- `js/program-item-builder.js` adapts generated operands into dependency chains.
- `js/render-declaration.js` and `js/render-assignment.js` are thin adapters
  over the shared legacy expression timeline.

See `docs/statement-plugin-guide.md` for the extension boundary and planned
declaration and assignment flow.

## Run

Serve this directory over HTTP. The existing login loader expects
`data/students.csv` with two columns:

```csv
email,studentNumber
student@example.edu,2026-0001
```

The real student list is intentionally not included.

## Tests

Run:

```sh
node tests/run-tests.js
```

The suite checks syntax/load ordering, deterministic generation parity against
the original supplied files, compatibility-envelope behavior, plugin dispatch,
statement advancement, all assignment operators, immutable-target rejection,
multi-statement scoring, and preservation of legacy generated output.
