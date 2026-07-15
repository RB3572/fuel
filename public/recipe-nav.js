function ensureToolbarLabels(){
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return
  const userActions=document.querySelector('.topbar .user')
  if(!userActions)return

  const workoutButton=userActions.querySelector('button.lift-nav-button')
  if(workoutButton){
    const workoutLabel=workoutButton.querySelector('span:last-child')
    if(workoutLabel&&workoutLabel.textContent!=='Workouts')workoutLabel.textContent='Workouts'
    workoutButton.setAttribute('aria-label','Open workouts')
    workoutButton.setAttribute('title','Workouts')
  }

  let recipeLink=userActions.querySelector('[data-recipe-nav]')
  if(!recipeLink){
    recipeLink=document.createElement('a')
    recipeLink.href='/recipes.html'
    recipeLink.dataset.recipeNav='true'
    recipeLink.className='lift-nav-button recipe-nav-button'
    recipeLink.innerHTML='<span aria-hidden="true">⌑</span><span>Recipes</span>'
    userActions.insertBefore(recipeLink,userActions.firstChild)
  }
  const recipeLabel=recipeLink.querySelector('span:last-child')
  if(recipeLabel&&recipeLabel.textContent!=='Recipes')recipeLabel.textContent='Recipes'
  recipeLink.setAttribute('aria-label','Open recipes')
  recipeLink.setAttribute('title','Recipes')
}
new MutationObserver(ensureToolbarLabels).observe(document.documentElement,{childList:true,subtree:true})
addEventListener('DOMContentLoaded',ensureToolbarLabels)
ensureToolbarLabels()