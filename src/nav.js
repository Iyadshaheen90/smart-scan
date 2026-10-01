// The page header (title + who's signed in) and the bottom tab bar, the same on every page.
// Needs api.js (getSession) and icons.js loaded first.
//   <header class="app-header" data-title="Slots" data-back="slots.html"></header>  (data-back: a back pill instead of the store name;
//   its text is in .back-label)
//   <nav class="tabbar" data-active="scan"></nav>
// Tabs are only links: what each role may do is still checked by the server.

const TABS = {
  owner: [
    { id: 'home', label: 'Home', href: 'index.html', icon: 'home' },
    { id: 'scan', label: 'Scan', href: 'close.html', icon: 'scan' },
    { id: 'stock', label: 'Stock', href: 'backstock.html', icon: 'box' },
    { id: 'reports', label: 'Reports', href: 'month.html', icon: 'chart' },
    { id: 'more', label: 'More', href: 'more.html', icon: 'more' },
  ],
  // Employees scan with the big green button on home, so their middle tab is Slots (owner's choice 2026-09-28).
  employee: [
    { id: 'home', label: 'Home', href: 'index.html', icon: 'home' },
    { id: 'slots', label: 'Slots', href: 'slots.html', icon: 'grid' },
    { id: 'more', label: 'More', href: 'more.html', icon: 'more' },
  ],
};

function navEscape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "ishaheen" → "IS", as in the mockup.
function initials(username) {
  return String(username || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
}

// data-back-id / data-title-id give the back link and the title an id, for pages that change them (the slot page).
function renderHeader(el, session) {
  const back = el.dataset.back;
  const id = (name) => (name ? ` id="${navEscape(name)}"` : '');
  const top = back
    ? `<a class="back"${id(el.dataset.backId)} href="${navEscape(back)}">${icon('chevronLeft')}<span class="back-label">${navEscape(el.dataset.backLabel || 'Back')}</span></a>`
    : '<div class="eyebrow">Route 66 Liquor</div>';
  const pill = session
    ? `<a class="user-pill" href="more.html"><span class="name">${navEscape(session.username)}</span><span class="avatar">${navEscape(initials(session.username))}</span></a>`
    : '';
  const title = `<h1${id(el.dataset.titleId)}>${navEscape(el.dataset.title || 'Smart Scan')}</h1>`;
  // With a back pill, it and the name pill share the top row (level with each other) and the title goes under them.
  el.classList.toggle('with-back', Boolean(back));
  el.innerHTML = back ? `${top}${pill}${title}` : `<div>${top}${title}</div>${pill}`;
}

function renderTabBar(el, session) {
  const tabs = TABS[session.role === 'owner' ? 'owner' : 'employee'];
  el.innerHTML = tabs.map((t) => `<a href="${t.href}" data-tab="${t.id}" class="${t.id === el.dataset.active ? 'active' : ''}">`
    + `${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  document.body.classList.add('has-tabbar');
}

// Shows a number (or a row of numbers) whole: if it's too wide for its box, the text gets smaller
// instead of being cut off or pushing past the screen (owner's rule 2026-09-28). Give the box class "fit".
function fitText(el) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth && size > 10) {
    size -= 1;
    el.style.fontSize = `${size}px`;
  }
}
function fitNumbers(root = document) {
  root.querySelectorAll('.fit').forEach(fitText);
}
window.addEventListener('resize', () => fitNumbers());

(function renderNav() {
  const session = getSession();
  document.querySelectorAll('header.app-header').forEach((el) => renderHeader(el, session));
  if (session) document.querySelectorAll('nav.tabbar').forEach((el) => renderTabBar(el, session));
  fillIcons();
})();
