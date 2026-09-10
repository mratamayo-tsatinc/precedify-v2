// ============================================================================
// ASSIGNMENT STATEMENT PLUGIN
// ----------------------------------------------------------------------------
// Evaluates an assignment RHS through the existing flat-expression service,
// then writes the result through Program Core memory. No DOM logic lives here.
// ============================================================================

function assignmentRhsResolved(statement){
  const runtime = statement.runtime;
  return !!(runtime && runtime.workingFlat && runtime.workingFlat.operands.length===1
    && isFlatOperandReady(runtime.workingFlat.operands[0]));
}

function isCompoundAssignment(statement){
  return !!(statement && statement.operator && statement.operator!=='=');
}

function assignmentTargetRevealed(statement){
  return !isCompoundAssignment(statement) || !!(statement.runtime && statement.runtime.targetRevealed);
}

function assignmentReadyToApply(statement){
  return assignmentRhsResolved(statement) && assignmentTargetRevealed(statement);
}

function assignmentTargetTokenId(statement){
  return `assignment-target-${statement.id}`;
}

function assignmentResultTokenId(statement){
  return `assignment-result-${statement.id}`;
}

function assignmentDependenciesReady(statement,program){
  const target = program.memory[statement.target];
  if(!target || !target.initialized || target.mutable===false) return false;
  return (statement.dependencies||[]).every(name=>{
    const binding = program.memory[name];
    return binding && binding.initialized;
  });
}

function syncAssignmentOperandsFromMemory(statement,program){
  const runtime = statement.runtime;
  if(!runtime || runtime.trace.length>0) return;
  runtime.workingFlat.operands.forEach(function sync(operand){
    if(operand.kind==='unary') return sync(operand.inner);
    if(operand.kind==='variable' || operand.kind==='constant'){
      const memory = program.memory[operand.name];
      if(memory && memory.initialized) operand.declaredValue = memory.value;
    }
  });
  runtime.history[0] = deepCloneFlat(runtime.workingFlat);
}

function applyAssignmentOperator(operator,currentValue,rhsValue){
  if(operator==='=') return rhsValue;
  return evalOp(operator.slice(0,-1),currentValue,rhsValue);
}

registerStatementPlugin({
  kind:'assignment',
  scoresCommit:true,

  classifyRejectedAction(ctx){
    if(!ctx.action||ctx.action.type!=='commit-assignment') return null;
    if(!assignmentRhsResolved(ctx.statement)) return 'assignment-value-unresolved';
    if(isCompoundAssignment(ctx.statement)&&!assignmentTargetRevealed(ctx.statement)){
      return 'assignment-target-unread';
    }
    return null;
  },

  applyAction(ctx){
    const {statement,program,action,item} = ctx;
    const runtime = statement.runtime;
    if(!runtime || runtime.checked || !assignmentDependenciesReady(statement,program)) return {applied:false};
    syncAssignmentOperandsFromMemory(statement,program);

    if(action.type==='reveal-assignment-target'){
      if(!isCompoundAssignment(statement) || runtime.targetRevealed) return {applied:false};
      const target=program.memory[statement.target];
      runtime.targetRevealed=true;
      runtime.targetReadValue=action.manualResponse?action.manualResponse.value:target.value;
      runtime.trace.push({
        action:'READ_TARGET',target:statement.target,targetKind:'variable',
        sourceValue:runtime.targetReadValue,resultNodeId:assignmentTargetTokenId(statement),
        expressionBefore:flatToString(runtime.workingFlat),
        expressionAfter:flatToString(runtime.workingFlat),manualResponse:!!action.manualResponse,
        manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,
        manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect
      });
      runtime.history.push(deepCloneFlat(runtime.workingFlat));
      if(!Array.isArray(runtime.assignmentActionOrder)) runtime.assignmentActionOrder=[];
      runtime.assignmentActionOrder.push('target');
      return {applied:true};
    }

    if(action.type==='commit-assignment'){
      if(!assignmentReadyToApply(statement)) return {applied:false};
      const target = program.memory[statement.target];
      const beforeValue = isCompoundAssignment(statement) ? runtime.targetReadValue : target.value;
      const rhsValue = flatOperandValue(runtime.workingFlat.operands[0]);
      const computedValue = applyAssignmentOperator(statement.operator,beforeValue,rhsValue);
      const assignedValue = action.manualResponse ? action.manualResponse.value : computedValue;
      const evalSteps = runtime.trace.filter(step=>step.action==='EVALUATE');
      runtime.checked = true;
      runtime.beforeMemory = Object.assign({},target);
      runtime.beforeValue = beforeValue;
      runtime.rhsValue = rhsValue;
      runtime.assignedValue = assignedValue;
      runtime.manualCommitResponse=action.manualResponse||null;
      runtime.assignmentResultNodeId = isCompoundAssignment(statement)
        ? assignmentResultTokenId(statement) : null;
      runtime.assignmentMergePending = isCompoundAssignment(statement);
      runtime.correctSteps = evalSteps.filter(step=>step.wasCorrect).length;
      runtime.totalOpSteps = evalSteps.length;
      runtime.wasCorrectAssignment = assignedValue===runtime.expectedAfter;
      program.memory[statement.target] = Object.assign({},target,{
        value:assignedValue,
        initialized:true,
        lastStatementId:statement.id
      });
      if(Array.isArray(item._bindings)){
        const binding = item._bindings.find(b=>b.name===statement.target);
        if(binding) binding._flashed = false;
      }
      return {applied:true,completed:true,event:{
        type:'ASSIGN',action:'ASSIGN',statementId:statement.id,
        target:statement.target,operator:statement.operator,
        beforeValue,rhsValue,value:assignedValue,
        expectedValue:runtime.expectedAfter,
        wasCorrect:runtime.wasCorrectAssignment
      }};
    }

    const apply = ctx.services && ctx.services.applyExpressionAction;
    const applied=typeof apply==='function' && !!apply(runtime,action);
    if(applied){
      if(!Array.isArray(runtime.assignmentActionOrder)) runtime.assignmentActionOrder=[];
      runtime.assignmentActionOrder.push('expression');
    }
    return {applied};
  },

  canUndo(ctx){
    const runtime = ctx.statement.runtime;
    return !!(runtime && !runtime.checked && (
      (runtime.assignmentActionOrder && runtime.assignmentActionOrder.length)
      || runtime.targetRevealed
      || (runtime.history && runtime.history.length>1)));
  },

  undo(ctx){
    const runtime=ctx.statement.runtime;
    const order=runtime && runtime.assignmentActionOrder;
    const last=order && order.length ? order.pop() : null;
    if(last==='target'){
      if(runtime.trace.length&&runtime.trace[runtime.trace.length-1].action==='READ_TARGET'){
        runtime.trace.pop();
        if(runtime.history.length>1) runtime.history.pop();
      }
      runtime.targetRevealed=false;
      runtime.targetReadValue=null;
      return {applied:true};
    }
    const undo = ctx.services && ctx.services.undoExpressionAction;
    if(last==='expression') return typeof undo==='function' ? {applied:!!undo(runtime)} : {applied:false};
    if(runtime && runtime.targetRevealed && runtime.trace.length
      && runtime.trace[runtime.trace.length-1].action==='READ_TARGET'){
      runtime.trace.pop();
      if(runtime.history.length>1) runtime.history.pop();
      runtime.targetRevealed=false;
      runtime.targetReadValue=null;
      return {applied:true};
    }
    if(runtime && runtime.history && runtime.history.length>1){
      return typeof undo==='function' ? {applied:!!undo(runtime)} : {applied:false};
    }
    if(runtime && runtime.targetRevealed){
      const readIndex=runtime.trace.findIndex(step=>step.action==='READ_TARGET');
      if(readIndex===runtime.trace.length-1){
        runtime.trace.pop();
        if(runtime.history.length>1) runtime.history.pop();
      }
      runtime.targetRevealed=false;
      runtime.targetReadValue=null;
      return {applied:true};
    }
    return {applied:false};
  },

  rollbackCompletion(ctx){
    const runtime = ctx.statement.runtime;
    if(!runtime || !runtime.checked) return {applied:false};
    if(runtime.beforeMemory) ctx.program.memory[ctx.statement.target]=Object.assign({},runtime.beforeMemory);
    runtime.checked=false;
    runtime.beforeMemory=null;
    runtime.rhsValue=null;
    runtime.assignedValue=null;
    runtime.manualCommitResponse=null;
    runtime.assignmentMergePending=false;
    runtime.wasCorrectAssignment=null;
    runtime.correctSteps=0;
    runtime.totalOpSteps=0;
    if(Array.isArray(ctx.item._bindings)){
      const binding=ctx.item._bindings.find(b=>b.name===ctx.statement.target);
      if(binding) binding._flashed=true;
    }
    for(let i=ctx.program.events.length-1;i>=0;i--){
      if(ctx.program.events[i].statementId===ctx.statement.id){ctx.program.events.splice(i,1);break;}
    }
    return {applied:true};
  },

  reset(ctx){
    const runtime=ctx.statement.runtime;
    if(!runtime) return {applied:false};
    const changed=runtime.checked || runtime.targetRevealed || runtime.trace.length>0 || runtime.history.length>1;
    runtime.workingFlat=deepCloneFlat(runtime.originalFlat);
    runtime.history=[deepCloneFlat(runtime.originalFlat)];
    runtime.trace=[];
    runtime.checked=false;
    runtime.beforeMemory=null;
    runtime.beforeValue=null;
    runtime.rhsValue=null;
    runtime.assignedValue=null;
    runtime.manualCommitResponse=null;
    runtime.targetRevealed=false;
    runtime.targetReadValue=null;
    runtime.assignmentActionOrder=[];
    runtime.assignmentResultNodeId=null;
    runtime.assignmentMergePending=false;
    runtime.wasCorrectAssignment=null;
    runtime.correctSteps=0;
    runtime.totalOpSteps=0;
    return {applied:changed};
  },

  buildCanonicalTrace(ctx){
    const runtime=ctx.statement.runtime;
    if(!runtime || !runtime.canonicalTrace) return [];
    const steps=runtime.canonicalTrace.steps.map(step=>Object.assign({statementId:ctx.statement.id},step));
    steps.push({type:'ASSIGN',action:'ASSIGN',statementId:ctx.statement.id,
      target:ctx.statement.target,operator:ctx.statement.operator,
      beforeValue:runtime.expectedBefore,rhsValue:runtime.expectedRhs,
      value:runtime.expectedAfter,expectedValue:runtime.expectedAfter,wasCorrect:true});
    return steps;
  }
});
