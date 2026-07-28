import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const navCss = read('../public/fuel-nav.css')
const app = read('../src/App.tsx')
const profileCss = read('../src/ProfileMenu.css')
const staticPages = ['../public/recipes.html', '../public/meal-plan.html']

// The config ("More") dropdown broke twice on real phones. Both times the cause was the
// panel living inside .topbar .user, which below 900px is a horizontal overflow
// container: absolute positioning got clipped, and the `fixed` workaround is
// mispositioned by iOS Safari inside a -webkit-overflow-scrolling container.

test('the menu is a sibling of the scrolling pill row, not a child of it', () => {
  // React: the panel closes the <nav> before it renders.
  assert.match(app, /<\/nav>\{menuOpen&&menu\}<\/header>/)
  assert.doesNotMatch(app, /profile-shell[^>]*>[\s\S]{0,400}?\{menuOpen&&menu\}[\s\S]{0,40}?<\/div>/)
  for (const page of staticPages) {
    const html = read(page)
    const navEnd = html.indexOf('</nav>')
    const menuAt = html.indexOf('id="fuel-menu"')
    assert.ok(menuAt > navEnd, `${page}: the menu must come after </nav>, not inside the row`)
    assert.ok(menuAt < html.indexOf('</header>'), `${page}: the menu must stay inside <header class="topbar">`)
  }
})

test('the dropdown is anchored to the header, never positioned fixed', () => {
  assert.match(navCss, /\.topbar \.fuel-menu, \.topbar \.profile-menu \{[\s\S]*?position: absolute;/)
  // A fixed panel is what iOS Safari mispositions; there must be none left in the nav.
  assert.doesNotMatch(navCss, /position: fixed/)
  // And no leftover measurement contract.
  assert.doesNotMatch(navCss, /--fuel-menu-top|--fuel-menu-right/)
  assert.doesNotMatch(read('../public/fuel-nav.js'), /--fuel-menu-top|getBoundingClientRect/)
  assert.doesNotMatch(app, /--fuel-menu-top/)
})

test('.topbar stays a containing block with visible overflow', () => {
  const block = navCss.slice(navCss.indexOf('.topbar {'), navCss.indexOf('}', navCss.indexOf('.topbar {')))
  // position: sticky is what makes .topbar the containing block for the absolute panel.
  assert.match(block, /position: sticky;/)
  // Any overflow other than visible here would clip the panel, which is the whole bug.
  assert.doesNotMatch(block, /overflow/)
})

test('no stale rule outside fuel-nav.css can reposition the menu', () => {
  // ProfileMenu.css loads later in the bundle, so an equally specific rule there wins.
  // It may style the panel but must not place it.
  assert.doesNotMatch(profileCss, /\.profile-menu\{position:fixed/)
  assert.doesNotMatch(read('../src/DashEdit.css'), /profile-menu|fuel-menu/)
})

test('the dashboard menu dismisses on an outside tap and on Escape', () => {
  // The trigger and the panel are siblings now, so containment must match either.
  assert.match(app, /closest\?\.\('\.profile-menu, \.profile-shell'\)/)
  assert.match(app, /document\.addEventListener\('pointerdown',away\)/)
  assert.match(app, /event\.key==='Escape'/)
})
