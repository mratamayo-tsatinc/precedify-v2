function renderDone(container){
  if(state.mode==='exam'&&state.examSubmitted){
    const policy=activeExamPolicy();
    const summary=examAttemptSummary();
    const card=h('div',{class:'card exam-submission-card'});
    card.appendChild(h('div',{class:'summary-hero'},
      h('div',{class:'exam-submitted-icon'},h('i',{class:'fa-solid fa-circle-check'})),
      h('div',{class:'summary-score'},'Exam submitted'),
      h('div',{class:'summary-sub'},`${summary.answered} answered · ${summary.unattempted+summary.inProgress} not submitted as answers`)
    ));
    if(policy.feedbackRelease==='after-submit'){
      const total=computeGrandTotalScore();
      card.appendChild(h('div',{class:'exam-result-total'},
        h('span',{},'Total score'),h('strong',{},`${total.earned} / ${total.max}`)));
      const list=h('div',{class:'summary-list exam-profile-results'});
      PROFILES.forEach(profile=>{
        const items=state.itemsByProfile[profile.id]||[];
        const earned=roundPoints(items.reduce((sum,item)=>sum+(item.points||0),0));
        const answered=items.filter(item=>item.checked).length;
        const correct=items.filter(item=>item.wasCorrectFinal).length;
        list.appendChild(h('div',{class:'sumrow'},
          h('span',{class:'si'},profile.name),
          h('span',{class:'sr'},`${earned}/${items.length*profile.pointsPerItem} · ${correct}/${answered} correct`)));
      });
      card.appendChild(list);
    } else {
      card.appendChild(h('div',{class:'exam-results-withheld'},h('i',{class:'fa-solid fa-lock'}),
        ' Your attempt is saved. Results are not configured for release on this device.'));
    }
    card.appendChild(h('button',{class:'start-btn',onclick:logout,style:'margin-top:26px;'},
      h('i',{class:'fa-solid fa-right-from-bracket'}),' Log out'));
    container.appendChild(card);
    return;
  }
  const total = state.items.length;
  // Session total is the raw sum of each item's earned/possible points from
  // whichever ITEM_SCORE_MODELS policy is configured (SCORING_CONFIG.model) —
  // shown as an honest [Student Score]/[Max Score], not a percentage.
  // roundPoints() (state.js) strips the floating-point noise that summing
  // several already-rounded decimal points produces (PER_CHECK's default
  // scores are 1-decimal fractions, e.g. 0.6, 1.8, 2.4 — see state.js).
  const totalPoints = roundPoints(state.items.reduce((s,i)=>s+(i.points||0),0));
  const totalMaxPoints = state.items.reduce((s,i)=>s+(i.maxPoints||0),0);
  const correctCount = state.items.filter(i=>i.wasCorrectFinal).length;

  const card = h('div',{class:'card'});
  card.appendChild(h('div',{class:'summary-hero'},
    h('div',{class:'summary-score'}, `${totalPoints}/${totalMaxPoints}`),
    h('div',{class:'summary-sub'}, `${correctCount}/${total} items correct  ·  ${currentProfile().name}  ·  ${state.mode}`)
  ));
  const list = h('div',{class:'summary-list'});
  state.items.forEach((it,i)=>{
    list.appendChild(h('div',{class:'sumrow'},
      h('span',{class:'si'}, `Item ${i+1}  ·  ${it.correctSteps}/${it.totalOpSteps} steps  ·  ${it.points}/${it.maxPoints} pts`),
      h('span',{class:'sr '+(it.wasCorrectFinal?'ok':'no')}, it.wasCorrectFinal ? 'Correct' : 'Incorrect')
    ));
  });
  card.appendChild(list);
  card.appendChild(h('button',{class:'start-btn', onclick:restart, style:'margin-top:26px;'}, 'New session'));
  container.appendChild(card);
  // Additive hook for the juice/feel module (js/juice.js) — entirely
  // optional. card is already attached to the live DOM at this point.
  // Silent no-op if the script isn't loaded or fails for any reason.
  if(typeof renderSessionCelebration === 'function'){
    try{
      const heroEl = card.querySelector('.summary-hero') || card;
      renderSessionCelebration(heroEl);
    }catch(e){ /* silent no-op */ }
  }
}
