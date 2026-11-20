// The page header (title + who's signed in) and the bottom tab bar, the same on every page.
// Needs api.js (getSession) and icons.js loaded first.
//   <header class="app-header" data-title="Slots" data-back="slots.html"></header>  (data-back: a back pill instead of the store name;
//   its text is in .back-label; data-back-role="owner": the back pill only for that role)
//   data-help="close": a small ? beside the title that opens Help & FAQ at that section and comes back here
//   <nav class="tabbar" data-active="scan"></nav>
// Tabs are only links: what each role may do is still checked by the server.

const TABS = {
  owner: [
    { id: 'home', label: 'Home', href: 'index.html', icon: 'home' },
    { id: 'scan', label: 'Scan', href: 'close.html', icon: 'scan' },
    { id: 'stock', label: 'Stock', href: 'backstock.html', icon: 'box' },
    { id: 'reports', label: 'Reports', href: 'reports.html', icon: 'chart' },
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
  const forRole = !el.dataset.backRole || (session && session.role === el.dataset.backRole);
  const back = forRole ? el.dataset.back : '';
  const id = (name) => (name ? ` id="${navEscape(name)}"` : '');
  // On several stores (the database): the store's name is how to switch (Your Stores).
  const several = Boolean(session && session.storeId && session.storeCount > 1);
  const top = back
    ? `<a class="back"${id(el.dataset.backId)} href="${navEscape(back)}">${icon('chevronLeft')}<span class="back-label">${navEscape(el.dataset.backLabel || 'Back')}</span></a>`
    : several
      ? `<a class="eyebrow" href="stores.html" aria-label="${navEscape(`${storeName()}. Switch store`)}">${navEscape(storeName())}${icon('swap')}</a>`
      : `<div class="eyebrow">${navEscape(storeName())}</div>`;
  // No name pill before the person is on a store (the setup wizard).
  const pill = session && session.username
    ? `<a class="user-pill" href="more.html"><span class="name">${navEscape(session.username)}</span><span class="avatar">${navEscape(initials(session.username))}</span></a>`
    : '';
  const h1 = `<h1${id(el.dataset.titleId)}>${navEscape(el.dataset.title || 'Smart Scan')}</h1>`;
  // The ? sits in the title's row, so the back pill and the name pill never move (owner's rule 2026-10-13).
  const from = location.pathname.split('/').pop() + location.search;
  const help = el.dataset.help
    ? `<a class="help-link" href="help.html?from=${encodeURIComponent(from)}&amp;section=${encodeURIComponent(el.dataset.help)}" aria-label="Help">?</a>`
    : '';
  // A phone switched to the database before the cutover says so on every page, so a real close isn't done there by
  // mistake (PHONE_ON_DATABASE in api.js).
  const onDatabase = typeof PHONE_ON_DATABASE !== 'undefined' && PHONE_ON_DATABASE;
  const dbChip = onDatabase ? '<span class="chip amber db-chip">Database</span>' : '';
  const title = help || dbChip ? `<div class="title-row">${h1}${dbChip}${help}</div>` : h1;
  // With a back pill, it and the name pill share the top row (level with each other) and the title goes under them.
  el.classList.toggle('with-back', Boolean(back));
  el.innerHTML = back ? `${top}${pill}${title}` : `<div>${top}${title}</div>${pill}`;
}

// The box buttons (Slots, Activate Several's slot picker): one per box the store has, from its slots. A store with
// one box shows none; with many, the row scrolls sideways. Returns the box numbers.
function drawBoxSwitch(el, slots, current, pick) {
  const boxes = [...new Set(slots.map((s) => s.box))].sort((a, b) => a - b);
  el.classList.toggle('hidden', boxes.length < 2);
  el.classList.toggle('many', boxes.length > 4);
  el.innerHTML = '';
  for (const n of boxes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.box = n;
    b.textContent = `Box ${n}`;
    b.classList.toggle('active', n === current);
    b.addEventListener('click', () => pick(n));
    el.append(b);
  }
  const active = el.querySelector('.active');
  if (active && boxes.length > 4 && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  return boxes;
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
// A back pill's text shrinks to fit beside the name pill, so the name pill never moves off the top right.
function fitBackLabels() {
  document.querySelectorAll('.app-header .back-label').forEach(fitText);
}
window.addEventListener('resize', () => { fitNumbers(); fitBackLabels(); });

// Every password field gets an eye button to show or hide what's typed (redesign 2026-10-29).
function addPasswordEyes() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.parentElement.classList.contains('password-field')) return;
    const wrap = document.createElement('div');
    wrap.className = 'password-field';
    input.replaceWith(wrap);
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'eye';
    eye.setAttribute('aria-label', 'Show password');
    eye.innerHTML = icon('eye');
    eye.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      eye.innerHTML = icon(showing ? 'eye' : 'eyeOff');
      eye.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
    wrap.append(input, eye);
  });
}

// ---- Subscriptions: the Upgrade to Pro pop-up and the plan banner (design: smart-scan-subscriptions-design.md) ----

// 'YYYY-MM-DD' → 'Dec 20'.
function planDay(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A Pro-only feature (needs_pro) or the plan ended (subscription_ended): why, what Pro adds, and what to do.
// The owner gets See Plans; an employee is told to ask the owner (employees never see prices).
function showPlanPopup(code, message) {
  const session = getSession();
  const owner = Boolean(session && session.role === 'owner');
  const old = document.getElementById('planPopup');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'planPopup';
  wrap.className = 'overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const pro = code === 'needs_pro';
  const list = pro ? `<ul class="plan-list">${PRO_FEATURES.map((f) => `<li>${icon('check')}<span>${navEscape(f)}</span></li>`).join('')}</ul>` : '';
  const ask = owner ? '' : `<p class="plan-ask">${pro ? 'Ask the owner about Pro.' : ''}</p>`;
  wrap.innerHTML = `<div class="dialog plan-dialog">
      <div class="dialog-title">${pro ? 'Upgrade to Pro' : 'Subscription Ended'}</div>
      <p class="plan-why"></p>${list}${ask}
      <div class="dialog-buttons">${owner
        ? '<button type="button" data-close>Not Now</button><button type="button" class="save" data-plans>See Plans</button>'
        : '<button type="button" class="save" data-close>OK</button>'}</div>
    </div>`;
  wrap.querySelector('.plan-why').textContent = message || '';
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => wrap.remove()));
  const plans = wrap.querySelector('[data-plans]');
  if (plans) plans.addEventListener('click', () => { location.href = 'plans.html'; });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  document.body.append(wrap);
}

// One line about the plan when something needs attention, or null. The owner's lines lead to Plans or Subscription.
function planBanner(sub, owner) {
  if (!sub || sub.status === 'comp') return null;
  if (sub.access === 'read_only') {
    return owner ? { text: 'Your subscription has ended. Saving is off.', action: 'See Plans', href: 'plans.html', kind: 'red' }
      : { text: 'Your store\'s subscription has ended. Ask the owner.', kind: 'red' };
  }
  if (!owner) return null;
  if (sub.status === 'billing_issue') return { text: 'Payment problem. Update your payment.', action: 'Fix', href: 'subscription.html', kind: 'amber' };
  if (sub.status === 'trialing' && sub.trialEndsOn) {
    const days = Math.round((new Date(`${sub.trialEndsOn}T12:00:00`) - new Date()) / 86400000);
    if (days <= 3) return { text: `Free trial ends ${planDay(sub.trialEndsOn)}.`, action: 'Plans', href: 'plans.html', kind: 'amber' };
  }
  if (sub.status === 'active' && !sub.willRenew && sub.renewsOn) {
    return { text: `Subscription ends ${planDay(sub.renewsOn)}.`, action: 'Renew', href: 'plans.html', kind: 'amber' };
  }
  return null;
}
function drawPlanBanner(el, sub) {
  const session = getSession();
  const b = planBanner(sub || storePlan(), Boolean(session && session.role === 'owner'));
  el.classList.toggle('hidden', !b);
  if (!b) return;
  el.className = `plan-banner ${b.kind}`;
  el.innerHTML = '<span class="plan-banner-text"></span>' + (b.href ? `<a class="plan-banner-action" href="${b.href}"></a>` : '');
  el.querySelector('.plan-banner-text').textContent = b.text;
  if (b.href) el.querySelector('.plan-banner-action').textContent = b.action;
}

(function renderNav() {
  const session = getSession();
  document.querySelectorAll('header.app-header').forEach((el) => renderHeader(el, session));
  fitBackLabels();
  if (session && session.username) document.querySelectorAll('nav.tabbar').forEach((el) => renderTabBar(el, session));
  addPasswordEyes();
  fillIcons();
})();
