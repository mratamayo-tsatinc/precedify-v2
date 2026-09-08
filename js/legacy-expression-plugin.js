// ============================================================================
// LEGACY EXPRESSION STATEMENT PLUGIN
// ----------------------------------------------------------------------------
// Routes today's expression activity through Program Core without changing
// the expression data shape, interaction rules, scoring or canonical trace.
// ============================================================================

registerStatementPlugin({
  kind: 'legacy-expression',

  applyAction(ctx){
    if(itemHasInteractiveProgram(ctx.item) && ctx.item.trace.length===0){
      ctx.item.workingFlat.operands.forEach(function sync(operand){
        if(operand.kind==='unary') return sync(operand.inner);
        if(operand.kind==='variable'||operand.kind==='constant'){
          const memory=ctx.program.memory[operand.name];
          if(memory&&memory.initialized) operand.declaredValue=memory.value;
        }
      });
      ctx.item.history[0]=deepCloneFlat(ctx.item.workingFlat);
    }
    const fn = ctx.services && ctx.services.applyExpressionAction;
    return typeof fn === 'function'
      ? {applied: !!fn(ctx.item, ctx.action)}
      : {applied:false, reason:'expression-service-unavailable'};
  },

  check(ctx){
    const fn = ctx.services && ctx.services.checkExpressionItem;
    return typeof fn === 'function'
      ? {applied: !!fn(ctx.item)}
      : {applied:false, reason:'expression-service-unavailable'};
  },

  canUndo(ctx){
    return !!(ctx.item && !ctx.item.checked && Array.isArray(ctx.item.history) && ctx.item.history.length>1);
  },

  undo(ctx){
    const fn = ctx.services && ctx.services.undoExpressionAction;
    return typeof fn === 'function'
      ? {applied: !!fn(ctx.item)}
      : {applied:false};
  },

  reset(ctx){
    const fn = ctx.services && ctx.services.resetExpressionAction;
    return typeof fn === 'function'
      ? {applied:!!fn(ctx.item)}
      : {applied:false};
  },

  buildCanonicalTrace(ctx){
    return ctx.item && ctx.item.canonicalTrace && Array.isArray(ctx.item.canonicalTrace.steps)
      ? ctx.item.canonicalTrace.steps.slice()
      : [];
  }
});
