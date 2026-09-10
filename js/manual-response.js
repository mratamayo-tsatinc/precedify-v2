// Optional student-derived values. This module is deliberately orthogonal to
// readiness/sequence policy: it only replaces automatic value production after
// an otherwise executable token has been selected.

function effectiveManualResponseConfig(profile){
  const policy=state.mode==='exam'?activeExamPolicy():activePracticePolicy();
  const modeConfig=(policy&&policy.manualResponses)||{mode:'profile'};
  if(modeConfig.mode==='off') return {enabled:false,namedValueRate:0,operatorRate:0};
  if(modeConfig.mode==='custom') return {enabled:true,
    namedValueRate:modeConfig.namedValueRate,operatorRate:modeConfig.operatorRate};
  return profile&&profile.manualResponses&&profile.manualResponses.enabled
    ? Object.assign({namedValueRate:0,operatorRate:0},profile.manualResponses)
    : {enabled:false,namedValueRate:0,operatorRate:0};
}

function manualStatementEntries(item){
  if(item.program&&Array.isArray(item.program.statements)) return item.program.statements.map(statement=>({
    statement,runtime:statement.kind==='legacy-expression'?item:statement.runtime
  }));
  return [{statement:{id:'final-expression',kind:'legacy-expression'},runtime:item}];
}

function namedManualKeys(item){
  const keys=[];
  manualStatementEntries(item).forEach(({statement,runtime})=>{
    if(!runtime||!runtime.originalFlat) return;
    runtime.originalFlat.operands.forEach(operand=>{
      const inner=operand.kind==='unary'?operand.inner:operand;
      if(inner&&(inner.kind==='variable'||inner.kind==='constant')) keys.push(`${statement.id}:named:${operand.id}`);
    });
    if(statement.kind==='assignment'&&statement.operator!=='=') keys.push(`${statement.id}:target`);
  });
  return keys;
}

function operatorManualKeys(item){
  const keys=[];
  manualStatementEntries(item).forEach(({statement,runtime})=>{
    const steps=runtime&&runtime.canonicalTrace&&runtime.canonicalTrace.steps||[];
    let ordinal=0;
    steps.forEach(step=>{
      if(step.action==='EVALUATE'||step.action==='UNARY') keys.push(`${statement.id}:operator:${ordinal++}`);
    });
    // Writes reuse their existing score check. When selected for a manual
    // response, the student supplies the value that reaches the destination
    // card; no extra scoring check is introduced.
    if(statement.kind==='declaration'||statement.kind==='assignment') keys.push(`${statement.id}:commit`);
  });
  return keys;
}

function seededShuffle(values){
  const result=values.slice();
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(seededRandom()*(i+1));
    const temp=result[i];result[i]=result[j];result[j]=temp;
  }
  return result;
}

function selectExactManualQuota(entries,rate){
  const count=Math.round(entries.length*Math.max(0,Math.min(100,Number(rate)||0))/100);
  return new Set(seededShuffle(entries).slice(0,count).map(entry=>entry.key));
}

function assignManualResponsePlans(profile,items){
  const config=effectiveManualResponseConfig(profile);
  const named=[],operators=[];
  items.forEach((item,itemIndex)=>{
    namedManualKeys(item).forEach(key=>named.push({key:`${itemIndex}|${key}`,itemIndex,local:key}));
    operatorManualKeys(item).forEach(key=>operators.push({key:`${itemIndex}|${key}`,itemIndex,local:key}));
  });
  const selectedNamed=config.enabled?selectExactManualQuota(named,config.namedValueRate):new Set();
  const selectedOperators=config.enabled?selectExactManualQuota(operators,config.operatorRate):new Set();
  items.forEach((item,itemIndex)=>{
    item.manualResponsePlan={enabled:!!config.enabled,
      namedValueRate:config.namedValueRate||0,operatorRate:config.operatorRate||0,
      namedKeys:{},operatorKeys:{}};
    named.filter(entry=>entry.itemIndex===itemIndex).forEach(entry=>{
      if(selectedNamed.has(entry.key)) item.manualResponsePlan.namedKeys[entry.local]=true;
    });
    operators.filter(entry=>entry.itemIndex===itemIndex).forEach(entry=>{
      if(selectedOperators.has(entry.key)) item.manualResponsePlan.operatorKeys[entry.local]=true;
    });
  });
}

function manualOperatorOrdinal(runtime){
  return (runtime&&runtime.trace||[]).filter(step=>step.action==='EVALUATE'||step.action==='UNARY').length;
}

function manualResponseDescriptor(item,statement,runtime,action){
  const plan=item&&item.manualResponsePlan;
  if(!plan||!plan.enabled||!statement||!runtime||!action||action.manualResponse) return null;
  let key=null,expected,label='',presentation={};
  if(action.type==='substitute'){
    const node=findFlatOperandById(runtime.workingFlat,action.id);
    if(!node||node.resolved||(node.kind==='unary'&&node.substituted)) return null;
    const inner=node.kind==='unary'?node.inner:node;
    if(inner.kind!=='variable'&&inner.kind!=='constant') return null;
    key=`${statement.id}:named:${node.id}`;
    expected=node.kind==='unary'?unaryBaseValue(node):node.declaredValue;
    label='Read';
    presentation={visualType:'read',bindingName:inner.name,bindingKind:inner.kind,
      inputLabel:`Enter the current value of ${inner.name}`};
    if(!plan.namedKeys[key]) return null;
  } else if(action.type==='reveal-assignment-target'){
    if(statement.kind!=='assignment'||statement.operator==='='||runtime.targetRevealed) return null;
    const binding=item.program.memory[statement.target];
    if(!binding||!binding.initialized) return null;
    key=`${statement.id}:target`; expected=binding.value; label='Read';
    presentation={visualType:'read',bindingName:statement.target,bindingKind:'variable',
      inputLabel:`Enter the current value of ${statement.target}`};
    if(!plan.namedKeys[key]) return null;
  } else if(action.type==='evaluate'){
    const flat=runtime.workingFlat;
    let pair=null;
    for(let i=0;i<flat.operators.length;i++) if(flat.operands[i].id===action.leftId&&flat.operands[i+1].id===action.rightId){
      pair={left:flat.operands[i],right:flat.operands[i+1],operator:flat.operators[i]};break;
    }
    if(!pair||!pairReady(pair.left,pair.right,pair.operator)) return null;
    if(!strictSequenceEnabled()&&collectUnresolvedFlat(flat,[]).length) return null;
    expected=evalOp(pair.operator,flatOperandValue(pair.left),flatOperandValue(pair.right));
    key=`${statement.id}:operator:${manualOperatorOrdinal(runtime)}`; label='Evaluate';
    presentation={visualType:'evaluate',leftOperand:pair.left,rightOperand:pair.right,
      displayOperator:pair.operator,inputLabel:'Enter the result'};
    if(!plan.operatorKeys[key]) return null;
  } else if(action.type==='apply-unary'){
    const node=findFlatOperandById(runtime.workingFlat,action.id);
    if(!node||node.kind!=='unary'||!node.substituted||node.resolved) return null;
    expected=node.op==='!'?!unaryBaseValue(node):unaryBaseValue(node)+(node.op==='++'?1:-1);
    key=`${statement.id}:operator:${manualOperatorOrdinal(runtime)}`;
    label=node.op==='!'?'Evaluate':'Update';
    presentation={visualType:node.op==='!'?'evaluate-unary':'update-unary',unaryNode:node,
      bindingName:node.inner.name,bindingKind:node.inner.kind,inputLabel:node.op==='!'
        ?'Choose the result':`Enter the new value of ${node.inner.name}`};
    if(!plan.operatorKeys[key]) return null;
  } else if(action.type==='commit-assignment'){
    key=`${statement.id}:commit`;
    if(!plan.operatorKeys[key]) return null;
    if(statement.kind==='declaration'){
      if(!declarationInitializerResolved(statement)) return null;
      expected=flatOperandValue(runtime.workingFlat.operands[0]);label='Assign';
      presentation={visualType:'assign',bindingName:statement.binding.name,
        bindingKind:statement.binding.kind,inputLabel:`Enter the value to store in ${statement.binding.name}`};
    }else if(statement.kind==='assignment'){
      if(!assignmentReadyToApply(statement)) return null;
      const before=statement.operator==='='?item.program.memory[statement.target].value:runtime.targetReadValue;
      expected=applyAssignmentOperator(statement.operator,before,flatOperandValue(runtime.workingFlat.operands[0]));
      label=statement.operator==='='?'Assign':'Update';
      presentation=statement.operator==='='
        ?{visualType:'assign',bindingName:statement.target,bindingKind:'variable',
          inputLabel:`Enter the value to store in ${statement.target}`}
        :{visualType:'update',bindingName:statement.target,bindingKind:'variable',
          currentValue:before,rightOperand:runtime.workingFlat.operands[0],
          displayOperator:statement.operator.slice(0,-1),inputLabel:`Enter the new value of ${statement.target}`};
    } else return null;
  } else return null;
  return Object.assign({key,expected,label,isBoolean:typeof expected==='boolean',action,
    operationColor:stepColor((runtime.trace||[]).length)},presentation);
}

function manualResponseSourceElement(action){
  if(!action||typeof document==='undefined') return null;
  if(action.type==='substitute'||action.type==='apply-unary') return document.querySelector(`[data-token-id="${action.id}"]`);
  if(action.type==='evaluate') return document.querySelector(`[data-op-left="${action.leftId}"][data-op-right="${action.rightId}"]`);
  return document.activeElement;
}

function manualResponseBindingCard(name,kind,body,isDestination){
  return h('span',{class:'tok-card binding-identity '+(kind==='constant'?'tok-card-const':'tok-card-var')+' manual-response-binding-card',
    style:bindingIdentityStyle(name,kind),title:name,'aria-label':`${kind==='constant'?'constant':'variable'} ${name}`},
    h('span',{class:'tok-card-head'},name),h('span',{class:'tok-card-body'},body));
}

function markManualDestination(node,isDestination){
  if(isDestination) node.setAttribute('data-manual-connector-dest','');
  return node;
}

function manualResponseOperand(operand){
  if(!operand) return h('span',{class:'tok tok-lit'},'—');
  if(operand.kind==='variable'||operand.kind==='constant'){
    return manualResponseBindingCard(operand.name,operand.kind,formatValue(operand.declaredValue));
  }
  if(operand.kind==='unary'){
    if(operand.inner&&(operand.inner.kind==='variable'||operand.inner.kind==='constant')){
      return manualResponseBindingCard(operand.inner.name,operand.inner.kind,formatValue(unaryBaseValue(operand)));
    }
    return h('span',{class:'tok tok-lit'},formatValue(flatOperandValue(operand)));
  }
  return h('span',{class:'tok tok-lit'},formatValue(flatOperandValue(operand)));
}

function manualResponseResultBox(control,color){
  return h('div',{class:'manual-response-result-box',style:color?`--manual-operation-color:${color};`:null,
    'data-manual-connector-dest':''},control);
}

function manualResponseOperationRow(){
  return h('div',{class:'manual-response-operation-row'},...arguments);
}

function renderManualResponseVisual(descriptor,control){
  if(descriptor.visualType==='read'){
    return h('div',{class:'manual-response-flow read-flow'},
      manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,control));
  }
  if(descriptor.visualType==='evaluate'){
    return h('div',{class:'manual-response-flow connector-flow'},
      manualResponseOperationRow(manualResponseOperand(descriptor.leftOperand),
        h('span',{class:'tok manual-response-operator',style:`color:${descriptor.operationColor};`,
          'data-manual-connector-source':'','aria-hidden':'true'},descriptor.displayOperator),
        manualResponseOperand(descriptor.rightOperand)),
      manualResponseResultBox(control,descriptor.operationColor));
  }
  if(descriptor.visualType==='evaluate-unary'){
    const node=descriptor.unaryNode;
    return h('div',{class:'manual-response-flow connector-flow'},
      manualResponseOperationRow(h('span',{class:'tok manual-response-operator',style:`color:${descriptor.operationColor};`,
        'data-manual-connector-source':'','aria-hidden':'true'},node.op),
        manualResponseBindingCard(node.inner.name,node.inner.kind,formatValue(unaryBaseValue(node)))),
      manualResponseResultBox(control,descriptor.operationColor));
  }
  if(descriptor.visualType==='assign'){
    return h('div',{class:'manual-response-flow read-flow'},
      markManualDestination(manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,control),true));
  }
  if(descriptor.visualType==='update'){
    return h('div',{class:'manual-response-flow connector-flow'},
      manualResponseOperationRow(manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,
        formatValue(descriptor.currentValue)),h('span',{class:'tok manual-response-operator',style:`color:${descriptor.operationColor};`,
          'data-manual-connector-source':'','aria-hidden':'true'},descriptor.displayOperator),
        manualResponseOperand(descriptor.rightOperand)),
      markManualDestination(manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,control),true));
  }
  if(descriptor.visualType==='update-unary'){
    const node=descriptor.unaryNode;
    const baseCard=manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,formatValue(unaryBaseValue(node)));
    const operator=h('span',{class:'tok manual-response-operator',style:`color:${descriptor.operationColor};`,
      'data-manual-connector-source':'','aria-hidden':'true'},node.op);
    return h('div',{class:'manual-response-flow connector-flow'},manualResponseOperationRow(...(node.form==='prefix'?[operator,baseCard]:[baseCard,operator])),
      markManualDestination(manualResponseBindingCard(descriptor.bindingName,descriptor.bindingKind,control),true));
  }
  return manualResponseResultBox(control,descriptor.operationColor);
}

function requestManualResponse(descriptor,onConfirm){
  const modal=document.getElementById('manualResponseModal');
  if(!modal) return;
  const title=document.getElementById('manualResponseTitle');
  const visual=document.getElementById('manualResponseVisual');
  const confirm=document.getElementById('manualResponseConfirm');
  const source=manualResponseSourceElement(descriptor.action);
  modal.classList.toggle('no-motion',typeof flyAnimEnabled==='boolean'&&!flyAnimEnabled);
  title.textContent=descriptor.label;
  const icon=document.getElementById('manualResponseIcon');
  const iconByTitle={Read:'fa-memory',Evaluate:'fa-calculator',Assign:'fa-arrow-right-to-bracket',Update:'fa-rotate'};
  icon.className=`fa-solid ${iconByTitle[descriptor.label]||'fa-pen-to-square'}`;
  visual.textContent='';confirm.disabled=true;
  let chosen;
  const setValue=value=>{chosen=value;confirm.disabled=false;};
  let number=null;
  let control;
  if(descriptor.isBoolean){
    const trueButton=h('button',{type:'button','data-value':'true'},'TRUE');
    const falseButton=h('button',{type:'button','data-value':'false'},'FALSE');
    control=h('div',{class:'manual-response-boolean','aria-label':'Choose a boolean value'},trueButton,falseButton);
    [trueButton,falseButton].forEach(button=>button.onclick=()=>{
      [trueButton,falseButton].forEach(other=>other.classList.toggle('selected',other===button));
      setValue(button.dataset.value==='true');
    });
  }else{
    number=h('input',{class:'manual-response-number',type:'text',inputmode:'numeric',autocomplete:'off',
      'aria-label':descriptor.inputLabel||'Enter the derived value'});
    number.oninput=()=>{
      const valid=/^-?\d+$/.test(number.value.trim());
      confirm.disabled=!valid;if(valid) chosen=Number(number.value.trim());
    };
    control=number;
  }
  visual.appendChild(renderManualResponseVisual(descriptor,control));
  if(typeof scheduleManualResponseConnector==='function') scheduleManualResponseConnector(descriptor.operationColor);
  const close=()=>{if(typeof clearManualResponseConnector==='function') clearManualResponseConnector();modal.classList.remove('open');setTimeout(()=>{modal.style.display='none';},180);};
  document.getElementById('manualResponseCancel').onclick=close;
  confirm.onclick=()=>{
    const response={value:chosen,expectedValue:descriptor.expected,wasCorrect:chosen===descriptor.expected,key:descriptor.key};
    close();setTimeout(()=>onConfirm(response),180);
  };
  if(source&&source.getBoundingClientRect){
    const rect=source.getBoundingClientRect();
    modal.style.setProperty('--manual-origin-x',`${rect.left+rect.width/2}px`);
    modal.style.setProperty('--manual-origin-y',`${rect.top+rect.height/2}px`);
  }
  modal.style.display='flex';requestAnimationFrame(()=>modal.classList.add('open'));
  if(number) setTimeout(()=>{number.focus();number.scrollIntoView({block:'nearest',behavior:'smooth'});},80);
}

function manualResponseFacts(item){
  let correct=0,total=0;
  manualStatementEntries(item).forEach(({runtime})=>{
    (runtime&&runtime.trace||[]).forEach(step=>{
      if(step.manualResponse&&!step.manualResponseCountsAsWrite){total++;if(step.manualWasCorrect) correct++;}
    });
  });
  return {correct,total};
}

function plannedManualScoredCheckCount(item){
  if(!item||!item.manualResponsePlan||!item.manualResponsePlan.enabled) return 0;
  const unaryStatementIds=new Set((item.program&&item.program.statements||[])
    .filter(statement=>statement.kind==='unary-update').map(statement=>statement.id));
  return Object.keys(item.manualResponsePlan.namedKeys||{}).length+
    Object.keys(item.manualResponsePlan.operatorKeys||{}).filter(key=>{
      if(/:commit$/.test(key)) return false;
      const statementId=key.split(':operator:')[0];
      return !unaryStatementIds.has(statementId);
    }).length;
}
