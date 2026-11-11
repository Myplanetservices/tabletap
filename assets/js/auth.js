/* ==========================================================================
   TableTap — auth.js
   Fake login for a clickable demo: roles, sessions and guards.
   ========================================================================== */

import { getAll, query, getById, insert, update, logActivity } from './store.js';

export const ROOT = new URL('../../', import.meta.url).href;
export const SESSION_KEY = 'tqr_session';

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  location.href = ROOT + 'auth/login.html';
}

export function logoutTo(where) {
  localStorage.removeItem(SESSION_KEY);
  location.href = ROOT + where;
}

export function platformSettings() {
  return getAll('settings')[0] || {};
}

/* ----------------------------------------------------------------- login -- */
export function login(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');

  const admin = query('admins', (a) => a.email.toLowerCase() === mail && a.password === pass)[0];
  if (admin) {
    logActivity({ actor: admin.name, type: 'Login', details: 'Admin logged in' });
    return setSession({
      role: 'admin',
      id: admin.id,
      name: admin.name,
      email: admin.email,
      adminRole: admin.role,
    });
  }

  const owner = query('owners', (o) => o.email.toLowerCase() === mail && o.password === pass)[0];
  if (!owner) {
    throw new Error('That email and password do not match. Try the demo details below.');
  }

  const client = getById('clients', owner.clientId);
  if (!client) throw new Error('This account is no longer linked to a restaurant.');

  if (client.status === 'suspended') {
    throw new Error('Your account is suspended. Contact support.');
  }

  const settings = platformSettings();
  if (settings.maintenance) {
    throw new Error(settings.maintenanceMessage || 'TableTap is in maintenance mode. Please try again later.');
  }

  update('owners', owner.id, { lastLogin: new Date().toISOString() });
  update('clients', client.id, { lastActive: new Date().toISOString() });
  logActivity({ actor: owner.name, clientId: client.id, type: 'Login', details: 'Owner logged in' });

  return setSession({
    role: 'owner',
    id: owner.id,
    clientId: client.id,
    name: owner.name,
    email: owner.email,
  });
}

export function kitchenLogin(code, pin) {
  const client = query('clients', (c) => String(c.kitchenCode).toLowerCase() === String(code || '').trim().toLowerCase())[0];
  if (!client) throw new Error('That restaurant code was not found. Ask your manager to check it.');

  if (client.status === 'suspended') throw new Error('This restaurant account is suspended. Contact support.');
  if (!client.restrictions.kitchen) throw new Error('Kitchen panel access is turned off for this restaurant.');

  const staff = query('staff', (s) => s.clientId === client.id && s.pin === String(pin || '') && s.active)[0];
  if (!staff) throw new Error('That PIN is not right, or the staff account is deactivated.');

  update('staff', staff.id, { lastActive: new Date().toISOString() });
  update('clients', client.id, { lastActive: new Date().toISOString() });
  logActivity({ actor: staff.name, clientId: client.id, type: 'Login', details: 'Kitchen logged in' });

  return setSession({
    role: 'kitchen',
    id: staff.id,
    clientId: client.id,
    name: staff.name,
    email: client.kitchenCode,
  });
}

/* ----------------------------------------------------------------- guards -- */
export function requireRole(role) {
  const session = getSession();

  if (!session || session.role !== role) {
    const target = role === 'kitchen' ? 'auth/kitchen-login.html'
      : role === 'admin' ? 'auth/login.html?role=admin'
        : 'auth/login.html';
    location.replace(ROOT + target);
    throw new Error('Redirecting to login');
  }

  if (role === 'owner') {
    const client = getById('clients', session.clientId);
    if (!client || client.status === 'suspended') {
      localStorage.removeItem(SESSION_KEY);
      location.replace(ROOT + 'auth/login.html');
      throw new Error('Redirecting to login');
    }
  }

  return session;
}

export function currentClient() {
  const session = getSession();
  if (!session || !session.clientId) return null;
  return getById('clients', session.clientId);
}

/* -------------------------------------------------------- impersonation -- */
export function startImpersonation(clientId) {
  const admin = getSession();
  if (!admin || admin.role !== 'admin') throw new Error('Only admins can view as an owner.');
  const client = getById('clients', clientId);
  const owner = query('owners', (o) => o.clientId === clientId)[0];
  logActivity({ actor: admin.name, clientId, type: 'Impersonation', details: 'Admin started viewing as owner' });
  return setSession({
    role: 'owner',
    id: owner ? owner.id : 'impersonated',
    clientId,
    name: owner ? owner.name : 'Owner',
    email: owner ? owner.email : '',
    impersonating: true,
    adminId: admin.id,
    adminName: admin.name,
    restaurant: client ? client.name : '',
  });
}

export function stopImpersonation() {
  const session = getSession();
  if (!session || !session.impersonating) return logout();
  const admin = getById('admins', session.adminId);
  setSession({
    role: 'admin',
    id: session.adminId,
    name: admin ? admin.name : session.adminName,
    email: admin ? admin.email : '',
    adminRole: admin ? admin.role : 'super',
  });
  location.href = ROOT + 'admin/clients.html';
}

/* ------------------------------------------------------------- password -- */
export function changePassword(sessionId, currentPassword, nextPassword) {
  const owner = getById('owners', sessionId);
  if (!owner) throw new Error('Account not found.');
  if (owner.password !== currentPassword) throw new Error('That current password is not right.');
  if (!nextPassword || nextPassword.length < 8) throw new Error('Use at least 8 characters.');
  update('owners', owner.id, { password: nextPassword });
  logActivity({ actor: owner.name, clientId: owner.clientId, type: 'Password', details: 'Owner changed password' });
  return true;
}

export function createOwnerFromInvite(invite, password) {
  const plan = getById('plans', invite.planId) || getAll('plans')[0];
  const slug = String(invite.clientName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const clientId = 'cli_' + slug + '-' + Math.random().toString(36).slice(2, 5);

  const client = insert('clients', {
    id: clientId,
    name: invite.clientName,
    slug,
    country: invite.country,
    planId: plan.id,
    status: 'active',
    kitchenCode: invite.clientName.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase() + '1',
    ownerId: null,
    limits: { ...plan.limits },
    restrictions: { ordering: true, readOnly: false, kitchen: true, reports: true },
    settings: {
      currency: '$', tax: 8, service: 5, accent: '#1F4D3A', acceptOrders: true,
      approval: false, sound: true,
      address: '', phone: '', tagline: invite.country,
      logo: '', cover: '',
      hours: {
        mon: ['12:00', '23:00'], tue: ['12:00', '23:00'], wed: ['12:00', '23:00'],
        thu: ['12:00', '23:00'], fri: ['12:00', '23:00'], sat: ['12:00', '23:00'],
        sun: ['12:00', '22:00'],
      },
    },
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
  });

  const owner = insert('owners', {
    clientId: client.id,
    name: invite.ownerName,
    email: invite.email,
    password,
    phone: '',
    lastLogin: new Date().toISOString(),
  });

  update('clients', client.id, { ownerId: owner.id });
  insert('categories', { clientId: client.id, name: 'Starters', position: 0 });
  insert('categories', { clientId: client.id, name: 'Mains', position: 1 });
  insert('categories', { clientId: client.id, name: 'Drinks', position: 2 });
  update('invites', invite.id, { status: 'accepted', acceptedAt: new Date().toISOString() });

  logActivity({ actor: invite.ownerName, clientId: client.id, type: 'Invite', details: 'Invite accepted and account created' });

  setSession({
    role: 'owner',
    id: owner.id,
    clientId: client.id,
    name: owner.name,
    email: owner.email,
  });

  return client;
}
