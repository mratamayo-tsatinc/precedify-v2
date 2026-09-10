// Standalone ++/-- statements deliberately use the same expression timeline
// as legacy unary operands. This adapter only removes the assignment-style
// prefix and supplies program-statement controls.

function unaryUpdateRuntimeResolved(runtime){
  const operand=runtime&&runtime.workingFlat&&runtime.workingFlat.operands[0];
  return !!(runtime&&runtime.workingFlat&&runtime.workingFlat.operands.length===1
    &&operand&&operand.kind==='unary'&&operand.resolved);
}

// A standalone ++/-- statement does not leave behind an anonymous numeric
// expression result: its observable outcome is a changed named memory slot.
// Keep the existing variable-card identity while using the unary step color
// only for the arrival pulse. The inner card retains the unary node's token id
// so the shared connector and memory-transfer lookup terminate here exactly as
// they do on the legacy expression result.
function renderUnaryUpdateStoredResult(statement,runtime,context){
  if(!unaryUpdateRuntimeResolved(runtime)) return null;
  const operand=runtime.workingFlat.operands[0];
  const value=runtime.assignedValue!=null
    ? runtime.assignedValue : flatOperandValue(operand);
  const card=renderValueCard({
    id:operand.id,name:statement.target,value,kind:'variable',
    color:context&&context.color,isFlash:!!(context&&context.flashId===operand.id)
  });
  return h('span',{class:'unary-update-stored-result'},card);
}

function renderUnaryUpdateStatement(ctx){
  const {container,item,statement,statementIndex,isActive}=ctx;
  const runtime=statement.runtime;
  const expanded=statement.status==='complete'&&!!(statement._uiExpanded||statement._uiJustCompleted);
  const card=h('section',{class:`program-statement unary-update-statement ${statement.status}${state.mode==='practice'&&invalidExecutionBelongsToStatement(item,statement)?' practice-paused':''}`,
    'data-statement-id':statement.id});
  if(!isActive&&!expanded){
    card.appendChild(renderProgramStatementSummary(statement,statementIndex,programStatementSource(statement,item)));
    container.appendChild(card);
    return;
  }
  card.classList.add('expanded');
  card.appendChild(renderExpressionEvaluationPanel({
    runtime,labelText:'',labelCh:0,title:null,
    panelClass:'unary-update-eval-panel program-expression-panel',
    statementId:statement.id,statementNumber:statementIndex+1,
    continuationStyle:true,
    interactive:isActive&&!runtime.checked&&!item.checked&&!item.practiceInvalidExecution,
    revealCorrectness:runtime.checked&&state.mode!=='exam',
    isFullyResolved:()=>unaryUpdateRuntimeResolved(runtime),
    renderFinalValue:context=>renderUnaryUpdateStoredResult(statement,runtime,context),
    renderPrefix:()=>[],
    renderTrailingActions:()=>isActive
      ? renderInlineEvaluationActions({canUndo:canUndoForCurrentMode(item)&&!item.practiceInvalidExecution})
      : renderCollapseStatementAction(statement,statementIndex)
  }));

  const invalidExecutionAlert=renderInvalidExecutionAlert(item,statement);
  if(invalidExecutionAlert) card.appendChild(invalidExecutionAlert);
  if(isActive&&!item.checked){
    if(!item.practiceInvalidExecution&&(state.mode!=='exam'||activeExamPolicy().showNeutralGuidance)){
      const operand=runtime.workingFlat.operands[0];
      const message=operand&&operand.substituted
        ? `Click ${statement.operator} to update ${statement.target} in program memory.`
        : `Retrieve ${statement.target}'s current value from program memory.`;
      card.appendChild(renderContextHelp(message));
    }
    const canReset=state.mode==='practice'&&(ctx.program.cursor>0||runtime.trace.length>0);
    const resetControl=renderItemResetControl(canReset);
    if(resetControl) card.appendChild(resetControl);
  }
  container.appendChild(card);
}

registerStatementRenderer('unary-update',renderUnaryUpdateStatement);
