function ensureToolbarLayout(){
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return

  const topbar=document.querySelector('.topbar')
  const userActions=topbar?.querySelector('.user')
  if(!topbar||!userActions)return

  const brand=topbar.querySelector('.brand')
  const brandCopy=brand?.querySelector(':scope > div:last-child')
  const dateText=brandCopy?.querySelector('p')?.textContent?.trim()||''

  if(dateText){
    const heroCopy=document.querySelector('.hero .hero-head > div:first-child')
    if(heroCopy){
      let dateNode=heroCopy.querySelector('.energy-card-date')
      if(!dateNode){
        dateNode=document.createElement('p')
        dateNode.className='energy-card-date'
        const heading=heroCopy.querySelector('h2')
        heroCopy.insertBefore(dateNode,heading||null)
      }
      dateNode.textContent=dateText
    }
  }
  if(brandCopy)brandCopy.remove()

  const workoutButton=userActions.querySelector('button.lift-nav-button')
  if(workoutButton){
    workoutButton.querySelectorAll('span').forEach((span)=>span.remove())
    workoutButton.classList.add('icon-only-nav-button')
    workoutButton.setAttribute('aria-label','Open workouts')
    workoutButton.setAttribute('title','Workouts')
  }

  let recipeLink=userActions.querySelector('[data-recipe-nav]')
  if(!recipeLink){
    recipeLink=document.createElement('a')
    recipeLink.href='/recipes.html'
    recipeLink.dataset.recipeNav='true'
    recipeLink.className='lift-nav-button recipe-nav-button icon-only-nav-button'
    recipeLink.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7a3 3 0 0 0 3 3h1V2"/><path d="M5 2v10"/><path d="M7 2v10"/><path d="M6 12v10"/><path d="M19 2v20"/><path d="M15 2c0 5 1.5 8 4 8"/></svg>`
    userActions.insertBefore(recipeLink,userActions.firstChild)
  }else{
    recipeLink.classList.add('icon-only-nav-button')
    recipeLink.querySelectorAll('span').forEach((span)=>span.remove())
    if(!recipeLink.querySelector('svg')){
      recipeLink.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7a3 3 0 0 0 3 3h1V2"/><path d="M5 2v10"/><path d="M7 2v10"/><path d="M6 12v10"/><path d="M19 2v20"/><path d="M15 2c0 5 1.5 8 4 8"/></svg>`
    }
  }
  recipeLink.setAttribute('aria-label','Open recipes')
  recipeLink.setAttribute('title','Recipes')

  let mealPlanLink=userActions.querySelector('[data-meal-plan-nav]')
  if(!mealPlanLink){
    mealPlanLink=document.createElement('a')
    mealPlanLink.href='/meal-plan.html'
    mealPlanLink.dataset.mealPlanNav='true'
    mealPlanLink.className='lift-nav-button recipe-nav-button icon-only-nav-button'
    mealPlanLink.innerHTML=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.7 4.3L6 9l4.3 1.7L12 15l1.7-4.3L18 9l-4.3-1.7L12 3Z"/><path d="m5 15-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15Z"/></svg>`
    userActions.insertBefore(mealPlanLink,recipeLink)
  }
  mealPlanLink.setAttribute('aria-label','Open meal planner')
  mealPlanLink.setAttribute('title','Meal planner')
}

new MutationObserver(ensureToolbarLayout).observe(document.documentElement,{childList:true,subtree:true})
addEventListener('DOMContentLoaded',ensureToolbarLayout)
ensureToolbarLayout()
