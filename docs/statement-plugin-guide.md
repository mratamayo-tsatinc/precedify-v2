# Statement Plugin Guide

## Architectural rule

An activity item is a program. A program contains statements. Program Core
coordinates statement order but never implements the meaning or appearance of
a statement.

Three responsibilities stay separate:

1. A source adapter or generator produces Program IR.
2. A statement plugin validates and applies semantic actions.
3. A statement renderer displays state and emits semantic commands.

Canonical solving and scoring consume semantic events, never DOM clicks.

## Program shape

```js
const program = createProgram([
  declarationStatement({
    id: 's1',
    name: 'x',
    dataType: 'int',
    initializer: literalExpression(10)
  }),
  declarationStatement({
    id: 's2',
    name: 'y',
    dataType: 'int',
    initializer: binaryExpression(
      '+', identifierExpression('x'), literalExpression(5)
    )
  }),
  assignmentStatement({
    id: 's3',
    target: 'x',
    operator: '+=',
    value: identifierExpression('y')
  })
]);
```

The IR is language-neutral. A Java parser, C parser, profile generator or
external importer may all produce the same shape.

## Semantic plugin

```js
registerStatementPlugin({
  kind: 'declaration',

  validate({statement, program}) {},

  applyAction({statement, program, item, action, services}) {
    // Return {applied:false} when the action is unavailable.
    // Return {applied:true, event} after a valid state transition.
    // Add completed:true only when Program Core should advance.
  },

  check(context) {},

  buildCanonicalTrace(context) {
    return [];
  }
});
```

Plugins should emit normalized events such as `SUBSTITUTE`, `EVALUATE`,
`ASSIGN`, `READ_INPUT`, `WRITE_OUTPUT`, `BRANCH` or `LOOP_TEST`. A plugin may
add event-specific details, but shared features should depend on stable event
names and fields.

## Renderer

```js
registerStatementRenderer('declaration', ({container, statement, program}) => {
  // Build DOM and dispatch semantic actions. Do not directly change memory,
  // score, cursor or statement status here.
});
```

CSS and animation remain renderer concerns. Assignment semantics remain plugin
concerns. The program runner owns only sequencing.

`renderExpressionEvaluationPanel` also owns row-local actions. Its trailing
action hook places an icon-only Undo control on the latest active line for
legacy expressions, declarations, and assignments. Only the final-expression
caller supplies Check, and only when its value is fully resolved. Reset remains
a separate low-emphasis item action because it affects the whole program rather
than the visible row.

## Declaration execution

The first implementation is available in `declaration-statement-plugin.js`,
`program-item-builder.js`, and `render-declaration.js`. It is enabled only by
the `declaration-chain` profile.

For `int y = x + 5;`, a declaration plugin should:

1. Require `x` to be initialized in program memory.
2. Let the expression capability substitute and evaluate the initializer.
3. Enable `COMMIT_ASSIGNMENT` when the initializer is one resolved value.
4. Store that value in `program.memory.y`.
5. Emit an `ASSIGN` event.
6. Return `completed:true` so Program Core unlocks the next statement.

A literal initializer such as `int x = 10;` begins at step 3.

## Assignment operators

`program-ir.js` and `assignment-statement-plugin.js` support:

```text
=  +=  -=  *=  /=  %=
```

The assignment plugin normalizes compound assignment semantically. For
example, `x += y` reads the current `x`, evaluates `x + y`, then commits the
result back to `x`. The parser and renderer preserve `+=` for source fidelity;
the evaluator may use the existing binary-operation service internally.

The learner performs that read–modify–write sequence explicitly. A compound
target starts as a clickable name; `reveal-assignment-target` reads its current
memory value into the shared variable-card UI. The compound operator activates
only after that target value and the RHS are resolved. Applying it produces one
updated target card, which is then written back through the existing
expression-to-memory animation. Plain `=` assignments retain the original
destination-and-RHS interaction and do not require a target read.

That target read is recorded as a `READ_TARGET` trace entry with a matching
history snapshot. It therefore creates the same visible timeline progression
as an RHS substitution: preserved source row, new value-card row, step dot,
step color, connector line, memory-to-expression flight, and single-step Undo.
It remains a navigation/substitution action rather than an operator-order score.

The compound calculation uses a fixed instructional sequence—operand hold,
operator emphasis, convergence, result formation, and result hold—before the
write-back flight begins. Its timing is intentionally independent of the
memory-flight speed selector; that selector continues to control only travel
between the expression and memory panel.

During convergence, the source-faithful compound symbol changes only in the
temporary calculation view (`+=` to `+`, `-=` to `-`, and so on). The source
statement and clickable operator remain compound. The calculation and its
updated target card stay left-aligned with the evaluation rows rather than
moving to the center of the panel.

Assignments reject writes to immutable bindings and reads from
uninitialized bindings.

## Future statements

Input/output, selection and looping should be separate registrations. Program
IR may later allow statement-owned blocks (`then`, `else`, `body`) while
Program Core grows a program-counter stack. Do not embed those semantics in the
declaration or expression plugins.

Input plugins should read from a deterministic runtime input queue. Output
plugins should append to a runtime output buffer. This keeps student execution
and canonical execution reproducible.

## Compatibility promise

The original profiles use `legacy-expression`; they do not receive interactive
declarations or new scoring checks automatically. A profile selects the
multi-statement capability with `program.declarations: 'interactive'`. This
prevents the extension from changing deployed activities or saved scores.
