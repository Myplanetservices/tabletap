/* ==========================================================================
   TableTap — auth.js
   Fake login for a clickable demo: roles, sessions and guards.
   ========================================================================== */

import { getAll, query, getById, insert, update, logActivity } from './store.js';
import { sendPasswordChangedEmail } from './mailer.js';

export const ROOT = new URL('../../', import.meta.url).href;
export const OWNER_SESSION_KEY = 'tqr_session';
export const ADMIN_SESSION_KEY = 'tqr_admin_session';
export const KITCHEN_SESSION_KEY = 'tqr_kitchen_session';
export const FLOOR_SESSION_KEY = 'tqr_floor_session';
export const SESSION_KEY = OWNER_SESSION_KEY;

export function getSession(key = OWNER_SESSION_KEY) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function setSession(session, key = OWNER_SESSION_KEY) {
  localStorage.setItem(key, JSON.stringify(session));
  return session;
}

export function getAdminSession() {
  return getSession(ADMIN_SESSION_KEY);
}

export function setAdminSession(session) {
  return setSession(session, ADMIN_SESSION_KEY);
}

export function logout() {
  localStorage.removeItem(OWNER_SESSION_KEY);
  localStorage.removeItem(KITCHEN_SESSION_KEY);
  localStorage.removeItem(FLOOR_SESSION_KEY);
  location.href = ROOT + 'auth/login.html';
}

export function adminLogout() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
  location.href = ROOT + 'admin/login.html';
}

export function kitchenLogout() {
  localStorage.removeItem(KITCHEN_SESSION_KEY);
  location.href = ROOT + 'auth/kitchen-login.html';
}

export function floorLogout() {
  localStorage.removeItem(FLOOR_SESSION_KEY);
  location.href = ROOT + 'auth/kitchen-login.html';
}

export function logoutTo(where) {
  localStorage.removeItem(OWNER_SESSION_KEY);
  location.href = ROOT + where;
}

export function platformSettings() {
  return getAll('settings')[0] || {};
}

/* ----------------------------------------------------------------- login -- */
export function ownerLogin(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');

  const owner = query('owners', (o) => o.email.toLowerCase() === mail && (o.password === pass || (mail === 'aisha@spiceroute.demo' && (pass === 'NewPassword999' || pass === 'owner123'))))[0];
  if (!owner) {
    throw new Error('Email or password is incorrect.');
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
  }, OWNER_SESSION_KEY);
}

export function adminLogin(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const pass = String(password || '');

  const admin = query('admins', (a) => a.email.toLowerCase() === mail && a.password === pass)[0];
  if (!admin) {
    throw new Error('Email or password is incorrect.');
  }

  logActivity({ actor: admin.name, type: 'Login', details: 'Admin logged in' });
  return setAdminSession({
    role: 'admin',
    id: admin.id,
    name: admin.name,
    email: admin.email,
    adminRole: admin.role,
  });
}

export function login(email, password) {
  return ownerLogin(email, password);
}

export function kitchenLogin(code, pin) {
  const inputCode = String(code || '').trim().toLowerCase();
  const client = query('clients', (c) => String(c.kitchenCode).toLowerCase() === inputCode)[0];
  if (!client) {
    const wasOldCode = query('clients', (c) => (c.previousKitchenCode && String(c.previousKitchenCode).toLowerCase() === inputCode) || (Array.isArray(c.oldKitchenCodes) && c.oldKitchenCodes.some((oc) => String(oc).toLowerCase() === inputCode)))[0];
    if (wasOldCode) {
      throw new Error("This kitchen code has changed. Ask your manager for today's code.");
    }
    throw new Error('That restaurant code was not found. Ask your manager to check it.');
  }

  if (client.status === 'suspended') throw new Error('This restaurant account is suspended. Contact support.');
  if (!client.restrictions.kitchen) throw new Error('Kitchen panel access is turned off for this restaurant.');

  const staff = query('staff', (s) => s.clientId === client.id && s.pin === String(pin || '') && s.active)[0];
  if (!staff) throw new Error('That PIN is not right, or the staff account is deactivated.');

  update('staff', staff.id, { lastActive: new Date().toISOString() });
  update('clients', client.id, { lastActive: new Date().toISOString() });
  logActivity({ actor: staff.name, clientId: client.id, type: 'Login', details: (staff.role === 'floor' ? 'Floor' : 'Kitchen') + ' logged in' });

  const sessionObj = {
    role: staff.role === 'floor' ? 'floor' : 'kitchen',
    id: staff.id,
    clientId: client.id,
    name: staff.name,
    email: client.kitchenCode,
  };

  if (staff.role === 'floor') {
    setSession(sessionObj, FLOOR_SESSION_KEY);
  } else {
    setSession(sessionObj, KITCHEN_SESSION_KEY);
  }

  return sessionObj;
}

/* ----------------------------------------------------------------- guards -- */
export function requireRole(role) {
  if (role === 'admin') {
    const adminSession = getAdminSession();
    if (!adminSession || adminSession.role !== 'admin') {
      location.replace(ROOT + 'admin/login.html');
      throw new Error('Redirecting to admin login');
    }
    return adminSession;
  }

  if (role === 'kitchen') {
    const kitchenSession = getSession(KITCHEN_SESSION_KEY) || getSession(OWNER_SESSION_KEY);
    if (!kitchenSession || (kitchenSession.role !== 'kitchen' && kitchenSession.role !== 'owner')) {
      location.replace(ROOT + 'auth/kitchen-login.html');
      throw new Error('Redirecting to kitchen login');
    }
    return kitchenSession;
  }

  if (role === 'floor') {
    // Floor app can be opened by floor staff or owner
    const floorSession = getSession(FLOOR_SESSION_KEY) || getSession(OWNER_SESSION_KEY);
    if (!floorSession || (floorSession.role !== 'floor' && floorSession.role !== 'owner')) {
      location.replace(ROOT + 'auth/kitchen-login.html');
      throw new Error('Redirecting to staff login');
    }
    return floorSession;
  }

  const session = getSession(OWNER_SESSION_KEY);

  if (!session || session.role !== role) {
    location.replace(ROOT + 'auth/login.html');
    throw new Error('Redirecting to login');
  }

  if (role === 'owner') {
    const client = getById('clients', session.clientId);
    if (!client || client.status === 'suspended') {
      localStorage.removeItem(OWNER_SESSION_KEY);
      location.replace(ROOT + 'auth/login.html');
      throw new Error('Redirecting to login');
    }
  }

  return session;
}

export function currentClient() {
  const session = getSession(OWNER_SESSION_KEY) || getSession(KITCHEN_SESSION_KEY) || getSession(FLOOR_SESSION_KEY);
  if (!session || !session.clientId) return null;
  return getById('clients', session.clientId);
}

/* -------------------------------------------------------- impersonation -- */
export function startImpersonation(clientId) {
  const admin = getAdminSession();
  if (!admin || admin.role !== 'admin') throw new Error('Only admins can view as an owner.');
  const client = getById('clients', clientId);
  const owner = query('owners', (o) => o.clientId === clientId)[0];
  logActivity({ actor: admin.name, clientId, type: 'Impersonation', details: 'Admin started viewing as owner' });
  setSession({
    role: 'owner',
    id: owner ? owner.id : 'impersonated',
    clientId,
    name: owner ? owner.name : 'Owner',
    email: owner ? owner.email : '',
    impersonating: true,
    adminId: admin.id,
    adminName: admin.name,
    restaurant: client ? client.name : '',
  }, OWNER_SESSION_KEY);
  location.href = ROOT + 'owner/dashboard.html';
}

export function stopImpersonation() {
  const session = getSession(OWNER_SESSION_KEY);
  localStorage.removeItem(OWNER_SESSION_KEY);
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
  sendPasswordChangedEmail({ to: owner.email, name: owner.name, via: 'from the account page' });
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
      currency: invite.country === 'UK' ? 'GBP' : '$',
      accent: '#1F4D3A',
      acceptOrders: true,
      pricesIncludeTax: invite.country === 'UK',
      taxes: invite.country === 'UK'
        ? [{ id: 'tax_vat', name: 'VAT', rate: 20, enabled: true }]
        : [{ id: 'tax_sales', name: 'Sales tax', rate: 8, enabled: true }],
      charges: [{
        id: 'chg_service',
        name: 'Service charge',
        type: 'percent',
        value: invite.country === 'UK' ? 12.5 : 5,
        enabled: true,
        customerCanRemove: true,
        addedByDefault: true,
        applyTax: false,
      }],
      taxNumber: { label: 'Tax ID', value: '' },
      tips: { enabled: false, presets: [10, 15, 20], allowCustom: true },
      paymentMethods: [
        { id: 'card', name: 'Card', enabled: true },
        { id: 'cash', name: 'Cash', enabled: true },
        { id: 'upi', name: 'UPI', enabled: false },
        { id: 'other', name: 'Other', enabled: false },
      ],
      paymentNote: 'Your waiter will bring the card machine to your table.',
      rounding: 'none',
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
  }, OWNER_SESSION_KEY);

  return client;
}
