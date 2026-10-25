const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('tv_token');
let me = null;
let mode = 'all';
let rows = [];
let shareId = null;

// Demo accounts only (these are the same ones listed in the README)
const DEMO = [
  ['Admin', 'admin@trustvault.test', 'Admin-Demo-2026!'],
  ['Alice (owner)', 'alice@trustvault.test', 'Alice-Demo-2026!'],
  ['Bob (owner)', 'bob@trustvault.test', 'Bob-Demo-2026!'],
  ['Carol (viewer)', 'carol@trustvault.test', 'Carol-Demo-2026!'],
  ['Dave (viewer)', 'dave@trustvault.test', 'Dave-Demo-2026!'],
];
for (const [label, email, pw] of DEMO) {
  const b = document.createElement('button');
  b.className = 'demo-chip';
  b.textContent = label;
  b.onclick = () => {
    $('email').value = email;
    $('password').value = pw;
  };
  $('demoChips').append(b);
}

function toast(text, type = 'err') {
  if (!text) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = text;
  $('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}

function badge(text) {
  const s = document.createElement('span');
  s.className = 'badge b-' + text;
  s.textContent = text;
  return s;
}
function btn(label, fn, cls = '') {
  const b = document.createElement('button');
  b.className = 'btn small ' + cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}
const fmt = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const icon = (name) => {
  const e = name.split('.').pop().toLowerCase();
  return e === 'pdf' ? '📄' : ['png', 'jpg', 'jpeg'].includes(e) ? '🖼️' : e === 'txt' ? '📝' : '📁';
};
const json = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401 && token) {
    showLogin();
    toast('Session ended. Please sign in again.');
  }
  return res;
}

function setStats(items) {
  items.forEach(([label, value, ic], i) => {
    $('stL' + (i + 1)).textContent = label;
    $('stV' + (i + 1)).textContent = value;
    $('stI' + (i + 1)).textContent = ic;
  });
}

// Wipes everything from the screen so the next person sees nothing from the previous session
function showLogin() {
  token = null;
  me = null;
  shareId = null;
  rows = [];
  sessionStorage.removeItem('tv_token');
  $('app').hidden = true;
  $('modal').hidden = true;
  $('login').hidden = false;
  for (const id of ['docs', 'audit', 'grants']) $(id).replaceChildren();
  for (const id of ['summary', 'verifyResult', 'shareTitle']) $(id).textContent = '';
  $('summary').hidden = true;
  $('gemail').value = '';
  $('password').value = '';
}

async function doLogin() {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    ...json({ email: $('email').value, password: $('password').value }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error);
  token = d.token;
  sessionStorage.setItem('tv_token', token);
  start();
}
$('loginBtn').onclick = doLogin;
$('password').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
$('logout').onclick = async () => {
  await api('/auth/logout-all', { method: 'POST' });
  showLogin();
  toast('Signed out everywhere', 'ok');
};

async function start() {
  const res = await api('/auth/me');
  if (!res.ok) return showLogin();
  me = await res.json();
  $('login').hidden = true;
  $('app').hidden = false;
  $('avatar').textContent = me.email[0].toUpperCase();
  $('whoEmail').textContent = me.email;
  $('whoRole').textContent = me.role;
  const admin = me.role === 'admin';
  $('navDocs').hidden = admin;
  $('navActivity').hidden = !admin;
  $('ownerTools').hidden = me.role !== 'owner';
  setView(admin ? 'activity' : 'docs');
}

function setView(v) {
  $('navDocs').classList.toggle('active', v === 'docs');
  $('navActivity').classList.toggle('active', v === 'activity');
  $('viewDocs').hidden = v !== 'docs';
  $('viewActivity').hidden = v !== 'activity';
  if (v === 'docs') {
    $('viewTitle').textContent = 'My documents';
    $('viewSub').textContent = 'Only documents you own or were granted appear here.';
    load();
  } else {
    $('viewTitle').textContent = 'Activity';
    $('viewSub').textContent = 'Who did what, including refused attempts. Admins never see document contents.';
    loadAdmin();
  }
}
for (const b of document.querySelectorAll('.nav-btn')) b.onclick = () => setView(b.dataset.view);

/* ---------- Documents ---------- */
async function load() {
  const p = new URLSearchParams();
  if ($('q').value) p.set('q', $('q').value);
  if ($('cat').value) p.set('category', $('cat').value);
  const res = await api('/documents?' + p);
  if (!res.ok) return toast('Could not load documents');
  rows = await res.json();
  render();
}

function render() {
  const owned = rows.filter((d) => d.my_permission === 'owner').length;
  const bytes = rows.reduce((s, d) => s + Number(d.size_bytes), 0);
  setStats([
    ['Documents', rows.length, '📚'],
    ['Owned by me', owned, '👑'],
    ['Shared with me', rows.length - owned, '🤝'],
    ['Total size', fmt(bytes), '💾'],
  ]);

  const shown = rows.filter((d) => mode === 'all' || (mode === 'owner') === (d.my_permission === 'owner'));
  const body = $('docs');
  body.replaceChildren();
  $('docsEmpty').hidden = shown.length > 0;
  for (const d of shown) {
    const tr = body.insertRow();
    const name = tr.insertCell();
    const wrap = document.createElement('div');
    wrap.className = 'fname';
    const ic = document.createElement('div');
    ic.className = 'ficon';
    ic.textContent = icon(d.name);
    const label = document.createElement('span');
    label.textContent = d.name;
    wrap.append(ic, label);
    name.append(wrap);
    tr.insertCell().textContent = d.owner_email;
    tr.insertCell().textContent = d.category;
    tr.insertCell().textContent = fmt(Number(d.size_bytes));
    tr.insertCell().append(badge(d.my_permission));
    const c = tr.insertCell();
    // The server decides what is really allowed. These buttons only mirror it.
    c.append(btn('Download', () => download(d)));
    if (d.my_permission === 'owner' || d.my_permission === 'edit') {
      c.append(' ', btn('Rename', () => editDoc(d), 'btn-ghost'));
    }
    if (d.my_permission === 'owner') {
      c.append(' ', btn('Access', () => openShare(d), 'btn-ghost'));
      c.append(' ', btn('Delete', () => removeDoc(d), 'btn-danger'));
    }
  }
}
for (const c of document.querySelectorAll('.chip')) {
  c.onclick = () => {
    mode = c.dataset.mode;
    for (const x of document.querySelectorAll('.chip')) x.classList.toggle('active', x === c);
    render();
  };
}
$('search').onclick = load;
$('q').addEventListener('keydown', (e) => e.key === 'Enter' && load());

async function download(d) {
  const res = await api(`/documents/${d.id}/download`);
  if (!res.ok) return toast('Download refused');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = d.name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Rename and delete ---------- */
async function editDoc(d) {
  const name = prompt('File name (keep the same extension):', d.name);
  if (name === null) return;
  const category = prompt('Category:', d.category);
  if (category === null) return;
  const res = await api(`/documents/${d.id}`, { method: 'PATCH', ...json({ name, category }) });
  const out = await res.json();
  if (!res.ok) return toast(out.error);
  toast('Document updated', 'ok');
  load();
}

async function removeDoc(d) {
  if (!confirm(`Delete "${d.name}"? It will disappear for everyone who has access.`)) return;
  const res = await api(`/documents/${d.id}`, { method: 'DELETE' });
  if (!res.ok) return toast('Delete refused');
  toast('Document deleted', 'ok');
  load();
}

/* ---------- Upload ---------- */
const drop = $('drop');
drop.onclick = () => $('file').click();
$('file').onchange = () => ($('fileName').textContent = $('file').files[0] ? $('file').files[0].name : 'PDF, PNG, JPG or TXT, up to 5 MB');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files.length) {
    $('file').files = e.dataTransfer.files;
    $('file').onchange();
  }
};
$('upload').onclick = async () => {
  const f = $('file').files[0];
  if (!f) return toast('Choose a file first');
  const fd = new FormData();
  fd.append('category', $('category').value);
  fd.append('file', f);
  const res = await api('/documents', { method: 'POST', body: fd });
  const d = await res.json();
  if (!res.ok) return toast(d.error);
  toast('Uploaded and encrypted', 'ok');
  $('file').value = '';
  $('fileName').textContent = 'PDF, PNG, JPG or TXT, up to 5 MB';
  load();
};

/* ---------- Sharing ---------- */
function openShare(d) {
  shareId = d.id;
  $('shareTitle').textContent = d.name;
  $('modal').hidden = false;
  loadGrants();
}
function closeShare() {
  $('modal').hidden = true;
  shareId = null;
}
$('closeModal').onclick = closeShare;
$('modal').addEventListener('click', (e) => e.target === $('modal') && closeShare());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeShare());

async function loadGrants() {
  const res = await api(`/documents/${shareId}/grants`);
  if (!res.ok) return toast('Could not load access list');
  const ul = $('grants');
  ul.replaceChildren();
  const list = await res.json();
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = 'Nobody else has access yet.';
    ul.append(li);
  }
  for (const g of list) {
    const li = document.createElement('li');
    const em = document.createElement('span');
    em.className = 'em';
    em.textContent = g.email;
    li.append(em, badge(g.permission), btn('Revoke', async () => {
      await api(`/documents/${shareId}/grants/${g.user_id}`, { method: 'DELETE' });
      toast('Access revoked', 'ok');
      loadGrants();
    }, 'btn-danger'));
    ul.append(li);
  }
}
$('grant').onclick = async () => {
  const res = await api(`/documents/${shareId}/grants`, {
    method: 'POST',
    ...json({ email: $('gemail').value, permission: $('gperm').value }),
  });
  const d = await res.json();
  if (!res.ok) return toast(d.error);
  toast('Access granted', 'ok');
  $('gemail').value = '';
  loadGrants();
};

/* ---------- Admin activity ---------- */
async function loadAdmin() {
  const s = await api('/admin/summary');
  if (s.ok) {
    const d = await s.json();
    setStats([
      ['Refused (24h)', d.denied, '🚫'],
      ['Failed logins', d.failed_logins, '🔑'],
      ['Grants', d.grants, '✅'],
      ['Revokes', d.revokes, '↩️'],
    ]);
    const note = $('summary');
    note.hidden = !d.repeated_refusals.length;
    note.textContent = '⚠️ Worth noticing, repeated refusals: ' + d.repeated_refusals.map((r) => `${r.who} (${r.count})`).join(', ');
  }
  const p = new URLSearchParams();
  if ($('fOutcome').value) p.set('outcome', $('fOutcome').value);
  if ($('fAction').value) p.set('action', $('fAction').value);
  const res = await api('/admin/audit?' + p);
  if (!res.ok) return toast('Could not load activity');
  const body = $('audit');
  body.replaceChildren();
  for (const r of await res.json()) {
    const tr = body.insertRow();
    if (r.outcome === 'denied') tr.className = 'denied';
    const cells = [
      new Date(r.ts).toLocaleString(), r.actor_email || '-', r.action, null,
      r.document_name || '-', r.target_email || '-', r.ip || '-',
      Object.keys(r.details || {}).length ? JSON.stringify(r.details) : '',
    ];
    cells.forEach((v) => {
      const td = tr.insertCell();
      if (v === null) td.append(badge(r.outcome));
      else td.textContent = v;
    });
  }
}
$('fSearch').onclick = loadAdmin;
$('verify').onclick = async () => {
  const res = await api('/admin/verify');
  if (!res.ok) return toast('Verify failed');
  const d = await res.json();
  const out = $('verifyResult');
  out.className = d.intact ? 'ok-text' : 'bad-text';
  out.textContent = d.intact ? `✔ Chain intact (${d.total} records)` : `✖ TAMPERING DETECTED at record ${d.first_bad_id}`;
};

if (token) start();