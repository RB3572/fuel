function addRecipeTab(){
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return
  const userActions=document.querySelector('.topbar .user')
  if(!userActions||userActions.querySelector('[data-recipe-nav]'))return
  const link=document.createElement('a')
  link.href='/recipes.html'
  link.dataset.recipeNav='true'
  link.className='lift-nav-button recipe-nav-button'
  link.innerHTML='<span aria-hidden="true">⌑</span><span>Recipes</span>'
  userActions.insertBefore(link,userActions.firstChild)
}
new MutationObserver(addRecipeTab).observe(document.documentElement,{childList:true,subtree:true})
addEventListener('DOMContentLoaded',addRecipeTab)
addRecipeTab()
