// Assignment presentation is a thin adapter over the shared legacy expression
// timeline. Only the target/operator label and statement controls are unique.
function renderAssignmentOperator(statement,ready,context,item){
  const strictCandidate=typeof strictSequenceEnabled==='function'&&strictSequenceEnabled()
    &&context&&context.isCurrent&&item&&!item.checked&&!item.practiceInvalidExecution;
  if(!ready&&!strictCandidate) return isCompoundAssignment(statement)
    ? h('span',{class:'tok tok-op-muted assignment-operator-static',
        'data-assignment-op-id':statement.id},statement.operator)
    : statement.operator;
  return h('button',{class:'declaration-equals tok tok-op-active tok-colored assignment-operator'+(statement.operator.length>1?' compound':'')+' ready'+(strictCandidate?' strict-sequence-candidate':''),
    'data-assignment-op-id':statement.id,
    title:`Apply ${statement.operator} to ${statement.target}`,
    'aria-label':`apply ${statement.operator} to ${statement.target}`,
    onclick:()=>handleTokenClick({type:'commit-assignment'})},statement.operator);
}

function renderCompoundAssignmentPrefix(statement,context,isActive,item){
  const runtime=statement.runtime;
  const tokenId=assignmentTargetTokenId(statement);
  const readIndex=runtime.trace.findIndex(step=>step.action==='READ_TARGET');
  const revealedForRow=readIndex>=0&&readIndex<context.stepCount;
  let targetNode;
  if(revealedForRow){
    targetNode=renderValueCard({id:tokenId,name:statement.target,value:runtime.targetReadValue,
      kind:'variable',color:stepVisualColor(runtime.trace[readIndex],readIndex),isFlash:context.flashId===tokenId});
    targetNode.classList.add('compound-target-card');
  } else {
    const interactive=isActive&&!runtime.checked&&!item.checked&&context.isCurrent;
    const pendingRead=context.pendingStep&&context.pendingStep.action==='READ_TARGET';
    const highlighted=interactive||pendingRead;
    const attrs={class:'tok tok-var binding-identity '+(highlighted?'tok-colored':'tok-static')+(interactive?' compound-target-ready':''),
      'data-token-id':tokenId,'data-binding-name':statement.target,
      style:bindingIdentityStyle(statement.target,'variable',highlighted?context.activeColor:null)};
    if(interactive){
      attrs.tabindex='0'; attrs.role='button';
      attrs['aria-label']=`read the current value of ${statement.target}`;
      attrs.onclick=()=>handleTokenClick({type:'reveal-assignment-target'});
      attrs.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handleTokenClick({type:'reveal-assignment-target'});}};
    }
    targetNode=h('span',attrs,statement.target);
  }
  const ready=isActive&&!runtime.checked&&context.isCurrent&&assignmentReadyToApply(statement);
  return h('span',{class:'compound-assignment-prefix'},targetNode,' ',renderAssignmentOperator(statement,ready,context,item),' ');
}

const COMPOUND_MERGE_DURATION_MS=2200;
const COMPOUND_WRITEBACK_DELAY_MS=2400;

function compoundOperationInstruction(statement){
  const target=statement.target;
  const rhs=formatValue(statement.runtime.rhsValue);
  const instructions={
    '+=':`Add ${rhs} to ${target}'s current value`,
    '-=':`Subtract ${rhs} from ${target}'s current value`,
    '*=':`Multiply ${target}'s current value by ${rhs}`,
    '/=':`Divide ${target}'s current value by ${rhs}`,
    '%=':`Divide ${target}'s current value by ${rhs}; keep the remainder`
  };
  return instructions[statement.operator]||`Apply ${statement.operator} to ${target}`;
}

function compoundArithmeticOperator(operator){
  return operator==='=' ? '=' : operator.slice(0,-1);
}

function appendCompoundAssignmentResult(timeline,statement,options){
  options=options||{};
  const runtime=statement.runtime;
  if(!runtime.checked || !isCompoundAssignment(statement)) return;
  const color=stepVisualColor({action:'APPLY_ASSIGNMENT'},runtime.trace.length);
  const animate=typeof flyAnimEnabled==='boolean'&&flyAnimEnabled&&runtime.assignmentMergePending;
  if(!animate&&runtime.assignmentMergePending) runtime.assignmentMergePending=false;
  const source=h('span',{class:'compound-merge-source'},
    h('span',{class:'compound-merge-left'},
      renderValueCard({id:null,name:statement.target,value:runtime.beforeValue,kind:'variable',color,isFlash:false})),
    ' ',h('span',{class:'tok tok-op-muted compound-merge-operator'},compoundArithmeticOperator(statement.operator)),' ',
    h('span',{class:'tok tok-lit compound-merge-right'},formatValue(runtime.rhsValue)));
  const cue=h('span',{class:'compound-operation-cue'},compoundOperationInstruction(statement));
  const result=renderValueCard({id:runtime.assignmentResultNodeId||assignmentResultTokenId(statement),
    name:statement.target,value:runtime.assignedValue,kind:'variable',color,isFlash:!animate});
  result.classList.add('compound-merge-result');
  const stage=h('span',{class:'compound-merge-stage'+(animate?' is-animating':''),
    style:`--compound-merge-duration:${COMPOUND_MERGE_DURATION_MS}ms;`},source,cue,result);
  const row=h('div',{class:`tl-row ${options.historical?'done':'current'} compound-result-row`});
  row.appendChild(h('div',{class:'tl-dot',style:`background:${color};${options.historical?'':`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`}`,
    title:`${statement.target} now stores ${formatValue(runtime.assignedValue)}`}));
  row.appendChild(h('div',{class:'code-out'+(options.historical?'':' row-enter')},renderBadgeSlot(null),stage));
  timeline.appendChild(row);
}

function renderAssignmentStatement(ctx){
  const {container,item,program,statement,statementIndex,isActive}=ctx;
  const runtime=statement.runtime;
  const expanded=statement.status==='complete'&&!!(statement._uiExpanded||statement._uiJustCompleted);
  const card=h('section',{class:`program-statement assignment-statement ${statement.status}${state.mode==='practice'&&invalidExecutionBelongsToStatement(item,statement)?' practice-paused':''}`,'data-statement-id':statement.id});
  if(!isActive&&!expanded){
    card.appendChild(renderProgramStatementSummary(statement,statementIndex,
      programStatementSource(statement,item)));
    container.appendChild(card);
    return;
  }
  card.classList.add('expanded');
  const labelText=statement.target;
  const compound=isCompoundAssignment(statement);
  card.appendChild(renderExpressionEvaluationPanel({runtime,labelText,labelCh:labelText.length+1,
    title:null,panelClass:'assignment-eval-panel program-expression-panel',
    statementId:statement.id,interactive:isActive&&!runtime.checked&&!item.checked&&!item.practiceInvalidExecution,revealCorrectness:runtime.checked&&state.mode!=='exam',
    statementNumber:statementIndex+1,continuationStyle:true,
    isFullyResolved:()=>compound?assignmentReadyToApply(statement):assignmentRhsResolved(statement),
    renderEquals:(ready,context)=>renderAssignmentOperator(statement,ready,context,item),
    renderPrefix:compound?(context=>renderCompoundAssignmentPrefix(statement,context,isActive,item)):null,
    renderAfterRows:compound?(timeline=>appendCompoundAssignmentResult(timeline,statement)):null,
    renderTrailingActions:()=>isActive
      ? renderInlineEvaluationActions({canUndo:canUndoForCurrentMode(item)&&!item.practiceInvalidExecution})
      : renderCollapseStatementAction(statement,statementIndex)}));
  const invalidExecutionAlert=renderInvalidExecutionAlert(item,statement);
  if(invalidExecutionAlert) card.appendChild(invalidExecutionAlert);
  if(isActive&&!item.checked){
    const unresolved=collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
    const ready=assignmentRhsResolved(statement);
    let guidance;
    if(compound&&!runtime.targetRevealed) guidance=`Click ${statement.target} to read its current value from memory.`;
    else if(unresolved) guidance='Substitute initialized values from program memory before evaluating the assignment value.';
    else if(!ready) guidance='Evaluate the highlighted operator.';
    else guidance=`Both values are ready. Click ${statement.operator} to update ${statement.target}.`;
    if(!item.practiceInvalidExecution&&(state.mode!=='exam'||activeExamPolicy().showNeutralGuidance)){
      card.appendChild(renderContextHelp(guidance));
    }
    const canReset=state.mode==='practice'&&(program.cursor>0||runtime.trace.length>0||runtime.targetRevealed);
    const resetControl=renderItemResetControl(canReset);
    if(resetControl) card.appendChild(resetControl);
  }
  container.appendChild(card);
}

registerStatementRenderer('assignment',renderAssignmentStatement);
