const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('tv_token');
let shareId = null;
const msg = (t) => ($('msg').textContent = t || '');

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401 && token) showLogin();
  return res;
}
const json = (o) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
function btn(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  return b;
}
function showLogin() {
  token = null;
  shareId = null;
  sessionStorage.removeItem('tv_token');
  $('app').hidden = true;
  $('login').hidden = false;
  $('share').hidden = true;
  $('shareTitle').textContent = '';
  $('grants').replaceChildren();
  $('docs').replaceChildren();
  $('gemail').value = '';
  $('password').value = '';
}

$('loginBtn').onclick = async () => {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    ...json({ email: $('email').value, password: $('password').value }),
  });
  const d = await res.json();
  if (!res.ok) return msg(d.error);
  token = d.token;
  sessionStorage.setItem('tv_token', token);
  msg('');
  start();
};
$('logout').onclick = async () => {
  await api('/auth/logout-all', { method: 'POST' });
  showLogin();
};

async function start() {
  const res = await api('/auth/me');
  if (!res.ok) return showLogin();
  const me = await res.json();
  $('login').hidden = true;
    $('share').hidden = true;
  $('app').hidden = false;
  $('who').textContent = `${me.email} (${me.role})`;
  $('ownerTools').hidden = me.role !== 'owner';
  load(me.role);
}

async function load(role) {
  const p = new URLSearchParams();
  if ($('q').value) p.set('q', $('q').value);
  if ($('cat').value) p.set('category', $('cat').value);
  const res = await api('/documents?' + p);
  if (!res.ok) return msg('Could not load documents');
  const rows = await res.json();
  const body = $('docs');
  body.replaceChildren();
  for (const d of rows) {
    const tr = body.insertRow();
    for (const v of [d.name, d.owner_email, d.category, d.my_permission]) tr.insertCell().textContent = v;
    const c = tr.insertCell();
    c.append(btn('Download', () => download(d)));
    if (d.my_permission === 'owner') c.append(btn('Access', () => openShare(d)));
  }
  if (role === 'admin') msg('Admin accounts have no access to document content.');
}

async function download(d) {
  const res = await api(`/documents/${d.id}/download`);
  if (!res.ok) return msg('Download refused');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = d.name;
  a.click();
  URL.revokeObjectURL(url);
}

$('upload').onclick = async () => {
  const f = $('file').files[0];
  if (!f) return msg('Choose a file first');
  const fd = new FormData();
  fd.append('category', $('category').value);
  fd.append('file', f);
  const res = await api('/documents', { method: 'POST', body: fd });
  const d = await res.json();
  msg(res.ok ? '' : d.error);
  if (res.ok) load('owner');
};
$('search').onclick = () => load();

function openShare(d) {
  shareId = d.id;
  $('share').hidden = false;
  $('shareTitle').textContent = d.name;
  loadGrants();
}
async function loadGrants() {
  const res = await api(`/documents/${shareId}/grants`);
  if (!res.ok) return msg('Could not load access list');
  const ul = $('grants');
  ul.replaceChildren();
  for (const g of await res.json()) {
    const li = document.createElement('li');
    li.append(`${g.email} (${g.permission}) `);
    li.append(btn('Revoke', async () => {
      await api(`/documents/${shareId}/grants/${g.user_id}`, { method: 'DELETE' });
      loadGrants();
    }));
    ul.append(li);
  }
}
$('grant').onclick = async () => {
  const res = await api(`/documents/${shareId}/grants`, {
    method: 'POST',
    ...json({ email: $('gemail').value, permission: $('gperm').value }),
  });
  const d = await res.json();
  msg(res.ok ? '' : d.error);
  loadGrants();
};

if (token) start();