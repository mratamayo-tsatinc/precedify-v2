// ============================================================================
// STANDALONE UNARY UPDATE STATEMENT PLUGIN
// ----------------------------------------------------------------------------
// Reuses the legacy expression service for the existing two-step unary flow:
// retrieve the target value, then apply ++/--. The only new semantic work is
// committing the side effect to sequential program memory. For a standalone
// statement the expression result is discarded, so both prefix and postfix
// display the observable updated memory value.
// ============================================================================

function unaryUpdateDependenciesReady(statement,program){
  const target=program&&program.memory&&program.memory[statement.target];
  return !!(target&&target.initialized&&target.mutable!==false);
}

function unaryUpdateDelta(statement){
  return statement.operator==='++'?1:-1;
}

function unaryUpdateSource(statement){
  return statement.form==='prefix'
    ? `${statement.operator}${statement.target};`
    : `${statement.target}${statement.operator};`;
}

function syncUnaryUpdateFromMemory(statement,program){
  const runtime=statement.runtime;
  if(!runtime||runtime.trace.length>0) return;
  const operand=runtime.workingFlat&&runtime.workingFlat.operands[0];
  const target=program.memory[statement.target];
  if(operand&&operand.kind==='unary'&&operand.inner&&target){
    operand.inner.declaredValue=target.value;
    runtime.history[0]=deepCloneFlat(runtime.workingFlat);
  }
}

function normalizeUnaryUpdateResult(runtime,value){
  const operand=runtime.workingFlat&&runtime.workingFlat.operands[0];
  if(operand&&operand.kind==='unary') operand.resultValue=value;
  if(runtime.history&&runtime.history.length){
    const last=runtime.history[runtime.history.length-1];
    const historical=last&&last.operands&&last.operands[0];
    if(historical&&historical.kind==='unary') historical.resultValue=value;
  }
  const step=runtime.trace&&runtime.trace[runtime.trace.length-1];
  if(step&&step.action==='UNARY'){
    step.result=value;
    step.expressionAfter=flatToString(runtime.workingFlat);
  }
}

registerStatementPlugin({
  kind:'unary-update',
  scoresCommit:true,

  classifyRejectedAction(ctx){
    if(!ctx.action) return null;
    if(!unaryUpdateDependenciesReady(ctx.statement,ctx.program)) return 'unary-target-unavailable';
    return null;
  },

  applyAction(ctx){
    const {statement,program,item,action}=ctx;
    const runtime=statement.runtime;
    if(!runtime||runtime.checked||!unaryUpdateDependenciesReady(statement,program)){
      return {applied:false};
    }
    syncUnaryUpdateFromMemory(statement,program);
    const apply=ctx.services&&ctx.services.applyExpressionAction;
    const applied=typeof apply==='function'&&!!apply(runtime,action);
    if(!applied) return {applied:false};
    if(action.type!=='apply-unary') return {applied:true};

    const target=program.memory[statement.target];
    const beforeValue=target.value;
    const assignedValue=beforeValue+unaryUpdateDelta(statement);
    normalizeUnaryUpdateResult(runtime,assignedValue);
    runtime.checked=true;
    runtime.beforeMemory=Object.assign({},target);
    runtime.beforeValue=beforeValue;
    runtime.assignedValue=assignedValue;
    runtime.wasCorrectAssignment=assignedValue===runtime.expectedAfter;
    runtime.correctSteps=0;
    runtime.totalOpSteps=0;
    program.memory[statement.target]=Object.assign({},target,{
      value:assignedValue,initialized:true,lastStatementId:statement.id
    });
    if(Array.isArray(item._bindings)){
      const binding=item._bindings.find(candidate=>candidate.name===statement.target);
      if(binding) binding._flashed=false;
    }
    return {applied:true,completed:true,event:{
      type:'UNARY_UPDATE',action:'ASSIGN',statementId:statement.id,
      target:statement.target,operator:statement.operator,form:statement.form,
      beforeValue,value:assignedValue,expectedValue:runtime.expectedAfter,
      wasCorrect:runtime.wasCorrectAssignment
    }};
  },

  canUndo(ctx){
    const runtime=ctx.statement.runtime;
    return !!(runtime&&!runtime.checked&&runtime.history&&runtime.history.length>1);
  },

  undo(ctx){
    const undo=ctx.services&&ctx.services.undoExpressionAction;
    return typeof undo==='function'
      ? {applied:!!undo(ctx.statement.runtime)} : {applied:false};
  },

  rollbackCompletion(ctx){
    const runtime=ctx.statement.runtime;
    if(!runtime||!runtime.checked||!runtime.beforeMemory) return {applied:false};
    ctx.program.memory[ctx.statement.target]=Object.assign({},runtime.beforeMemory);
    runtime.checked=false;
    runtime.beforeMemory=null;
    runtime.beforeValue=null;
    runtime.assignedValue=null;
    runtime.wasCorrectAssignment=null;
    runtime.correctSteps=0;
    runtime.totalOpSteps=0;
    if(runtime.trace.length&&runtime.trace[runtime.trace.length-1].action==='UNARY'){
      runtime.trace.pop();
      if(runtime.history.length>1) runtime.history.pop();
      runtime.workingFlat=deepCloneFlat(runtime.history[runtime.history.length-1]);
    }
    if(Array.isArray(ctx.item._bindings)){
      const binding=ctx.item._bindings.find(candidate=>candidate.name===ctx.statement.target);
      if(binding) binding._flashed=true;
    }
    for(let i=ctx.program.events.length-1;i>=0;i--){
      if(ctx.program.events[i].statementId===ctx.statement.id){
        ctx.program.events.splice(i,1);
        break;
      }
    }
    return {applied:true};
  },

  reset(ctx){
    const runtime=ctx.statement.runtime;
    if(!runtime) return {applied:false};
    const changed=runtime.checked||runtime.trace.length>0||runtime.history.length>1;
    runtime.workingFlat=deepCloneFlat(runtime.originalFlat);
    runtime.history=[deepCloneFlat(runtime.originalFlat)];
    runtime.trace=[];
    runtime.checked=false;
    runtime.beforeMemory=null;
    runtime.beforeValue=null;
    runtime.assignedValue=null;
    runtime.wasCorrectAssignment=null;
    runtime.correctSteps=0;
    runtime.totalOpSteps=0;
    return {applied:changed};
  },

  buildCanonicalTrace(ctx){
    const runtime=ctx.statement.runtime;
    if(!runtime||!runtime.canonicalTrace) return [];
    return runtime.canonicalTrace.steps.map(step=>Object.assign({statementId:ctx.statement.id},step));
  }
});
