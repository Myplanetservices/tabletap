/* ==========================================================================
   TableTap — store.js
   The app's database, as one in-memory object of collections. Neon Postgres
   (through /api/db) is the source of truth: on import this module loads the
   whole store from the server before any page code runs, pushes every change
   back, and polls for changes made on other devices (see "cloud sync" at the
   end). localStorage ("tqr_db") is only a cache, and the fallback when the
   API is unreachable (then the page runs locally and nothing syncs).
   Vanilla ES module. No build step.
   ========================================================================== */

import { computeBill } from './billing.js';
import { DEMO_MODE, logger } from './config.js';

const KEY = 'tqr_db';
const VERSION = 8;

let cache = null;
let writeTimer = null;
// Set once the cloud-sync section at the end of this module has initialised;
// writes made by top-level code before that (kitchen-code rotation) skip the push.
let cloudReady = false;

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

function persistToStorage(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    if (DEMO_MODE) console.warn('TableTap: storage full or blocked.', err);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (cache && writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
      persistToStorage(cache);
    }
  });
}

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__version === VERSION) {
        let modified = false;

        // Auto-freshen timestamps only in DEMO_MODE
        if (DEMO_MODE && parsed.orders && Array.isArray(parsed.orders)) {
          const now = Date.now();
          parsed.orders.forEach((o) => {
            if (['new', 'preparing', 'ready'].includes(o.status)) {
              const ageMin = (now - new Date(o.createdAt).getTime()) / 60000;
              if (ageMin > 180) {
                const freshMin = o.number === 1046 ? 2 : o.number === 1045 ? 5 : o.number === 1040 ? 21 : o.number === 1041 ? 9 : 10;
                o.createdAt = new Date(now - freshMin * 60000).toISOString();
                o.updatedAt = new Date(now - Math.max(0, freshMin - 2) * 60000).toISOString();
                modified = true;
              }
            }
          });
        }

        // Part 3, item 3: One-time clean-up on load for orders with closed/paid sessions
        if (parsed.orders && parsed.sessions) {
          const closedSessionIds = new Set(
            parsed.sessions
              .filter((s) => s.status === 'paid' || s.status === 'closed')
              .map((s) => s.id)
          );
          const activeStatuses = ['new', 'preparing', 'ready', 'picked_up'];
          parsed.orders.forEach((o) => {
            if (o.sessionId && closedSessionIds.has(o.sessionId) && activeStatuses.includes(o.status)) {
              o.status = 'served';
              o.autoClosed = true;
              modified = true;
              if (parsed.activity) {
                parsed.activity.push({
                  id: uid('act'),
                  actor: 'System',
                  clientId: o.clientId,
                  type: 'Order',
                  details: `Auto-closed order #${o.number} after payment`,
                  at: new Date().toISOString(),
                });
              }
            }
          });
        }

        if (parsed.staff && Array.isArray(parsed.staff)) {
          parsed.staff.forEach((s) => {
            if (s.name && s.name.toLowerCase().includes('maya') && s.role !== 'floor') {
              s.role = 'floor';
              modified = true;
            }
          });
        }
        cache = parsed;
        if (modified) write(cache, true);
        return cache;
      }
    }
  } catch (err) {
    if (DEMO_MODE) console.warn('TableTap: could not read demo data, reseeding.', err);
  }
  cache = seed();
  write(cache, true);
  return cache;
}

function write(db, immediate = false) {
  db.__version = VERSION;
  cache = db;
  if (immediate) {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    persistToStorage(db);
  } else {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      persistToStorage(cache || db);
      writeTimer = null;
    }, 200);
  }
  scheduleCloudFlush();
}

export function db() {
  return read();
}

export function save() {
  write(read());
}

/* ---------------------------------------------------------------- CRUD --- */
export function getAll(collection) {
  return read()[collection] || [];
}

export function getById(collection, id) {
  return getAll(collection).find((row) => row.id === id) || null;
}

export function query(collection, filterFn) {
  return getAll(collection).filter(filterFn);
}

export function insert(collection, row) {
  const data = read();
  data[collection] = data[collection] || [];
  const record = { id: row.id || uid(collection.slice(0, 3)), ...row };
  data[collection].push(record);
  write(data);
  return record;
}

export function update(collection, id, patch) {
  const data = read();
  const list = data[collection] || [];
  const index = list.findIndex((row) => row.id === id);
  if (index === -1) return null;
  list[index] = { ...list[index], ...patch };
  write(data);
  return list[index];
}

export function remove(collection, id) {
  const data = read();
  data[collection] = (data[collection] || []).filter((row) => row.id !== id);
  write(data);
  return true;
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  localStorage.removeItem('tqr_session');
  localStorage.removeItem('tqr_kitchen_sound');
  cache = null;
  read();
}

export function logActivity({ actor = 'System', clientId = null, type = 'Other', details = '' }) {
  return insert('activity', {
    actor,
    clientId,
    type,
    details,
    at: new Date().toISOString(),
  });
}

/* ------------------------------------------------ kitchen code rotation -- */
const ROTATION_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRandomKitchenCode() {
  let res = '';
  for (let i = 0; i < 6; i++) {
    res += ROTATION_CHARS.charAt(Math.floor(Math.random() * ROTATION_CHARS.length));
  }
  return res;
}

export function computeNextChangeAt(schedule, timeStr, timeZone) {
  if (schedule === 'permanent') return null;
  const [hh, mm] = (timeStr || '04:00').split(':').map((n) => parseInt(n, 10) || 0);

  // Calculate next target time in UTC based on restaurant time zone or local
  const now = new Date();
  let candidate = new Date();
  candidate.setHours(hh, mm, 0, 0);

  if (candidate <= now) {
    if (schedule === 'daily') {
      candidate.setDate(candidate.getDate() + 1);
    } else if (schedule.startsWith('days:')) {
      const days = parseInt(schedule.split(':')[1], 10) || 1;
      candidate.setDate(candidate.getDate() + days);
    } else if (schedule.startsWith('months:')) {
      const months = parseInt(schedule.split(':')[1], 10) || 1;
      candidate.setMonth(candidate.getMonth() + months);
    } else {
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  return candidate.toISOString();
}

export function rotateKitchenCodeForClient(clientId, forcedNewCode = null) {
  const client = getById('clients', clientId);
  if (!client) return null;

  const currentCode = client.kitchenCode;
  const rot = (client.settings && client.settings.kitchenRotation) || {
    schedule: 'permanent',
    time: '04:00',
    autoLogout: false,
    nextChangeAt: null,
  };

  const newCode = forcedNewCode || generateRandomKitchenCode();
  const oldCodes = Array.isArray(client.oldKitchenCodes) ? [...client.oldKitchenCodes] : [];
  if (currentCode && !oldCodes.includes(currentCode)) {
    oldCodes.push(currentCode);
  }

  const nextChangeAt = computeNextChangeAt(rot.schedule, rot.time, client.settings?.timezone);
  const updatedRotation = {
    ...rot,
    nextChangeAt,
  };

  const updatedSettings = {
    ...(client.settings || {}),
    kitchenRotation: updatedRotation,
  };

  update('clients', client.id, {
    kitchenCode: newCode,
    previousKitchenCode: currentCode,
    oldKitchenCodes: oldCodes,
    settings: updatedSettings,
  });

  logActivity({
    actor: 'System',
    clientId: client.id,
    type: 'Security',
    details: 'Kitchen code changed to ' + newCode,
  });

  // If autoLogout is on, terminate kitchen sessions of this restaurant
  if (rot.autoLogout) {
    try {
      const curSession = JSON.parse(localStorage.getItem('tqr_session') || 'null');
      if (curSession && curSession.role === 'kitchen' && curSession.clientId === client.id) {
        localStorage.removeItem('tqr_session');
      }
    } catch (e) {}
  }

  try {
    const bus = new BroadcastChannel('tqr');
    bus.postMessage({ event: 'kitchen:code_changed', data: { clientId: client.id, code: newCode, autoLogout: rot.autoLogout } });
    bus.close();
  } catch (e) {}

  return newCode;
}

export function checkKitchenCodeRotations() {
  const allClients = getAll('clients');
  const now = Date.now();
  allClients.forEach((client) => {
    const rot = client.settings && client.settings.kitchenRotation;
    if (rot && rot.schedule !== 'permanent' && rot.nextChangeAt) {
      if (now >= new Date(rot.nextChangeAt).getTime()) {
        rotateKitchenCodeForClient(client.id);
      }
    }
  });
}

// Run check on load and every 60 seconds (browser only; the seed script imports this module in Node)
if (typeof window !== 'undefined') {
  try {
    // Deferred so it runs after the cloud sync at the end of this module has loaded the store.
    setTimeout(() => { try { checkKitchenCodeRotations(); } catch (e) {} }, 0);
    setInterval(checkKitchenCodeRotations, 60000);
  } catch (e) {}
}

/* --------------------------------------------------------------- seed ---- */
const IMG = (id) => 'https://images.unsplash.com/photo-' + id + '?auto=format&fit=crop&w=240&q=70';

const ITEM_SEED = [
  // category, name, price, tags, available, image, description, sizes, addons
  ['starters', 'Crispy halloumi', 9.5, ['veg', 'gf'], true, '1541529086526-db283c563270',
    'Golden-fried halloumi with thyme honey, chilli flakes and a squeeze of lemon.', [], []],
  ['starters', 'Charred octopus', 14, ['gf', 'spicy'], true, '1467003909585-2f8a72700288',
    'Grilled over charcoal, smoked paprika oil, salsa verde and confit potato.',
    [{ name: 'Regular', price: 14 }, { name: 'Large (2 pieces)', price: 19 }],
    [{ name: 'Extras', min: 0, max: 3, options: [{ name: 'Extra salsa verde', price: 1.5 }, { name: 'Grilled pita', price: 2 }, { name: 'Extra lemon', price: 0.5 }] }]],
  ['starters', 'Warm olive & rosemary bread', 6, ['vegan'], true, '1509440159596-0249088772ff',
    'Baked in-house every service, sea salt, and olive oil for dipping.', [], []],
  ['starters', 'Whipped feta & honey', 8.5, ['veg'], true, '1546069901-ba9599a7e63c',
    'With pistachio dukkah, mint and warm pita straight from the oven.', [], []],
  ['starters', 'Crispy calamari', 11, ['spicy'], true, '1476224203421-9ac39bcb3327',
    'Light semolina crust, lemon aioli and pickled chilli.', [], []],

  ['mains', 'Slow-braised lamb shoulder', 24, [], true, '1544025162-d76694265947',
    'Six hours in the oven, served on orzo with gremolata and pan juices.', [], []],
  ['mains', 'Pan-seared sea bass', 22.5, ['gf'], true, '1519708227418-c8fd9a32b7a2',
    'Crisp skin, shaved fennel, blood orange and salsa verde.', [], []],
  ['mains', 'Wild mushroom risotto', 18, ['veg'], true, '1476124369491-e7addf5db371',
    'Porcini and chestnut mushrooms, thyme, aged parmesan, truffle oil.', [], []],
  ['mains', 'Charcoal chicken', 19, ['spicy'], true, '1504674900247-0877df9cc836',
    'Half chicken marinated in smoked paprika and yoghurt, lemon potatoes.', [], []],
  ['mains', 'Olive Table burger', 16.5, [], true, '1550547660-d9450f859349',
    'Beef patty, aged cheddar, house pickles and rosemary fries.', [], []],

  ['pizza', 'Margherita', 13, ['veg'], true, '1513104890138-7c749659a591',
    'San Marzano tomato, fior di latte and basil on a 48-hour dough.',
    [{ name: 'Regular', price: 13 }, { name: 'Large', price: 17 }],
    [{ name: 'Extra toppings', min: 0, max: 2, options: [{ name: 'Buffalo mozzarella', price: 3 }, { name: 'Basil oil', price: 1 }] }]],
  ['pizza', 'Olive & anchovy', 15.5, [], true, '1565299624946-b28f40a0ae38',
    'Taggiasca olives, white anchovy, chilli and oregano.', [], []],
  ['pizza', 'Truffle mushroom', 17, ['veg'], true, '1574071318508-1cdbab80d002',
    'Wild mushrooms, truffle cream, mozzarella and fresh thyme.', [], []],
  ['pizza', 'Spicy nduja', 16, ['spicy'], true, '1593560708920-61dd98c46a4e',
    'Calabrian nduja, stracciatella, hot honey and basil.', [], []],

  ['desserts', 'Olive oil cake', 8, ['veg'], true, '1578985545062-69928b1d9587',
    'Orange blossom cream and crushed pistachio.', [], []],
  ['desserts', 'Dark chocolate tart', 9, ['veg'], true, '1551024506-0bccd828d307',
    '70% chocolate, sea salt and crème fraîche.', [], []],
  ['desserts', 'Lemon sorbet', 6.5, ['vegan', 'gf'], true, '1488477181946-6428a0291777',
    'Amalfi lemon with mint and a splash of prosecco.', [], []],
  ['desserts', 'Baklava cheesecake', 9.5, ['veg'], false, '1519676867240-f03562e64548',
    'Pistachio, filo and honey syrup. Back tomorrow.', [], []],

  ['drinks', 'House lemonade', 4.5, ['vegan'], true, '1513558161293-cdaf765ed2fd',
    'Pressed lemon, rosemary syrup and pink peppercorn.', [], []],
  ['drinks', 'Cold brew', 4, ['vegan'], true, '1509042239860-f550ce710b93',
    'Eighteen-hour steep, single origin, orange zest.', [], []],
  ['drinks', 'Greek frappé', 4.5, ['veg'], true, '1461023058943-07fcbe16d735',
    'Whipped iced coffee, condensed milk optional.', [], []],
  ['drinks', 'Olive leaf spritz', 11, ['vegan'], true, '1514933651103-005eec06c04b',
    'Vermouth, soda and a brine-cured olive. Contains alcohol.', [], []],
  ['drinks', 'Mint & cucumber cooler', 5, ['vegan'], true, '1497534446932-c925b458314e',
    'No alcohol. Cucumber, mint, lime and soda.', [], []],
];

const CLIENTS = [
  // name, slug, owner, email, country, plan, status, tables, kitchenCode
  ['The Olive Table', 'olive-table', 'Ananya Rao', 'owner@olivetable.demo', 'India', 'pro', 'active', 12, 'OLIVE7'],
  ['The Copper Kettle', 'copper-kettle', 'James Whitfield', 'james@copperkettle.co.uk', 'United Kingdom', 'pro', 'active', 24, 'KETTLE3'],
  ['Blue Fig Bistro', 'blue-fig', 'Sarah Mokoena', 'sarah@bluefig.co.za', 'South Africa', 'starter', 'active', 8, 'BLUEFIG'],
  ['Harbor & Rye', 'harbor-rye', 'Daniel Brooks', 'dan@harborrye.com', 'United States', 'pro', 'suspended', 18, 'HARBOR1'],
  ['Spice Route', 'spice-route', 'Aisha Khan', 'aisha@spiceroute.demo', 'United Kingdom', 'pro', 'active', 4, 'SPICER1'],
  ['The Daily Grind', 'daily-grind', 'Emily Carter', 'emily@dailygrind.us', 'United States', 'starter', 'restricted', 10, 'GRIND9'],
  ['Casa Verde', 'casa-verde', 'Marco Rossi', 'marco@casaverde.co.uk', 'United Kingdom', 'pro', 'active', 15, 'VERDE44'],
  ['Ndlovu Grill', 'ndlovu-grill', 'Thabo Ndlovu', 'thabo@ndlovugrill.co.za', 'South Africa', 'pro', 'active', 21, 'NDLOVU5'],
  ['Tiffin & Chai', 'tiffin-chai', 'Rohan Mehta', 'rohan@tiffinchai.in', 'India', 'starter', 'invited', 0, 'TIFFIN8'],
  ['The Salt Room', 'salt-room', 'Olivia Bennett', 'olivia@saltroom.co.uk', 'United Kingdom', 'pro', 'active', 9, 'SALT77'],
  ['Ember Pizza Co.', 'ember-pizza', 'Marcus Lee', 'marcus@emberpizza.com', 'United States', 'pro', 'active', 27, 'EMBER12'],
  ['Curry Leaf Cafe', 'curry-leaf', 'Aditi Sharma', 'aditi@curryleaf.in', 'India', 'starter', 'active', 6, 'CURRY33'],
];

const mins = (n) => new Date(Date.now() - n * 60000).toISOString();
const days = (n) => new Date(Date.now() - n * 86400000).toISOString();

function seed() {
  const data = {
    plans: [
      { id: 'starter', name: 'Lifetime Starter', price: 29, limits: { tables: 10, items: 80, staff: 2 } },
      { id: 'pro', name: 'Lifetime Pro', price: 49, limits: { tables: 30, items: 200, staff: 5 } },
    ],
    admins: [
      { id: 'adm_1', name: 'Vivek Kumar', email: 'admin@tabletap.demo', password: 'admin123', role: 'super', phone: '+91 80 4718 2200' },
      ...(DEMO_MODE ? [{ id: 'adm_1b', name: 'Vivek Kumar', email: 'vivek@tabletap.demo', password: 'admin1234', role: 'super', phone: '+91 80 4718 2200' }] : []),
      { id: 'adm_2', name: 'Neha Iyer', email: 'neha@myplanetservices.com', password: 'support123', role: 'support', phone: '+91 80 4718 2211' },
    ],
    clients: [],
    owners: [],
    staff: [],
    tables: [],
    categories: [],
    items: [],
    orders: [],
    waiterCalls: [],
    sessions: [],
    invites: [],
    activity: [],
    notes: [],
    settings: [{
      id: 'set_1',
      maintenance: false,
      maintenanceMessage: 'TableTap is being updated. We will be back by 6:00 PM IST — orders already placed are safe.',
      defaultPlan: 'pro',
      inviteExpiryDays: 7,
      inviteSubject: 'You’re invited to TableTap, {{owner_name}}',
      inviteBody: 'Hi {{owner_name}},\n\n{{restaurant_name}} is ready to set up on TableTap — QR menus, live kitchen tickets and daily reports on the {{plan_name}} plan.\n\nSet your password and open your dashboard: {{invite_link}}\n\nThis link expires in {{expiry_days}} days.\n\n— {{sender_name}}, TableTap',
    }],
    __version: VERSION,
  };

  const planLimits = (planId) => (planId === 'starter' ? { tables: 10, items: 80, staff: 2 } : { tables: 30, items: 200, staff: 5 });

  CLIENTS.forEach((c, i) => {
    const [name, slug, ownerName, email, country, planId, status, tableCount, code] = c;
    const clientId = 'cli_' + slug;
    data.clients.push({
      id: clientId,
      name,
      slug,
      country,
      planId,
      status,
      kitchenCode: code,
      ownerId: 'own_' + slug,
      limits: planLimits(planId),
      restrictions: {
        ordering: status !== 'suspended',
        readOnly: status === 'restricted',
        kitchen: status !== 'suspended',
        reports: true,
      },
      settings: slug === 'spice-route' ? {
        currency: 'GBP',
        pricesIncludeTax: true,
        taxes: [
          { id: 'tax_vat', name: 'VAT', rate: 20, enabled: true },
        ],
        charges: [
          {
            id: 'chg_service', name: 'Service charge', type: 'percent', value: 12.5, enabled: true,
            customerCanRemove: true, addedByDefault: true, applyTax: false,
          },
        ],
        taxNumber: { label: 'VAT', value: 'GB987654321' },
        tips: { enabled: false, presets: [10, 15, 20], allowCustom: true },
        paymentMethods: [
          { id: 'card', name: 'Credit / Debit Card', enabled: true },
          { id: 'cash', name: 'Cash to Waiter', enabled: true },
        ],
        payments: {
          policy: 'post_pay',
          inPerson: { cash: true, cardMachine: true },
        },
        payAtOrder: {
          enabled: false,
        },
        useWaiterApp: true,
        rounding: 'none',
        accent: '#D97706',
        acceptOrders: true,
        approval: false,
        sound: true,
        address: '14 Brick Lane, London E1 6RF',
        phone: '+44 20 7946 0192',
        tagline: 'Modern Indian Dining',
        hours: {
          mon: ['08:00', '02:00'], tue: ['08:00', '02:00'], wed: ['08:00', '02:00'],
          thu: ['08:00', '02:00'], fri: ['08:00', '02:00'], sat: ['08:00', '02:00'],
          sun: ['08:00', '02:00'],
        },
      } : {
        currency: '$',
        pricesIncludeTax: false,
        taxes: [
          { id: 'tax_sales', name: 'Sales tax', rate: 8, enabled: true },
        ],
        charges: [
          {
            id: 'chg_service', name: 'Service charge', type: 'percent', value: 5, enabled: true,
            customerCanRemove: true, addedByDefault: true, applyTax: true,
          },
        ],
        taxNumber: { label: 'GSTIN', value: '27AAAPL1234C1ZV' },
        tips: { enabled: false, presets: [10, 15, 20], allowCustom: true },
        paymentMethods: [
          { id: 'apple_pay', name: 'Apple Pay', enabled: true },
          { id: 'google_pay', name: 'Google Pay', enabled: true },
          { id: 'card', name: 'Credit / Debit Card', enabled: true },
          { id: 'paypal', name: 'PayPal / Venmo', enabled: true },
          { id: 'upi', name: 'UPI (GPay / PhonePe / Paytm)', enabled: true },
          { id: 'cash', name: 'Cash to Waiter', enabled: true },
        ],
        payments: {
          policy: 'pay_at_order',
          stripe: {
            connected: true,
            accountName: 'The Olive Table Ltd',
            bankName: 'Barclays Business (•••• 4192)',
            payoutSchedule: 'Daily Rolling Payouts',
            liveMode: true,
            pubKey: '',
            secKey: '',
            applePay: true,
            googlePay: true,
            cards: true,
          },
          paypal: {
            connected: true,
            clientId: '',
            secKey: '',
            paypalWallet: true,
            venmo: true,
          },
          square: {
            connected: false,
            locationId: '',
            accessToken: '',
            syncPos: true,
          },
          razorpay: {
            connected: true,
            keyId: '',
            keySecret: '',
            vpa: 'olivetable@icici',
            upi: true,
            netbanking: true,
          },
          inPerson: {
            cash: true,
            cardMachine: true,
          },
        },
        geofence: {
          enabled: true,
          lat: 19.0596,
          lng: 72.8295,
          radiusMeters: 250,
          name: '14 Turner Road, Bandra West, Mumbai',
        },
        payAtOrder: {
          enabled: true,
          defaultMethod: 'apple_pay',
          methods: ['apple_pay', 'upi', 'card', 'counter'],
        },
        seatedCheck: {
          enabled: true,
        },
        useWaiterApp: true,
        paymentNote: 'Instant Apple Pay, UPI, or Card at table. Waiter can also collect at table.',
        rounding: 'none',
        accent: '#7A2E2B',
        acceptOrders: status !== 'suspended',
        approval: false,
        sound: true,
        address: '14 Turner Road, Bandra West, Mumbai 400050',
        phone: '+91 22 4004 8812',
        tagline: 'Mediterranean kitchen · Bandra West',
        logo: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=120&q=70',
        cover: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=70',
        hours: {
          mon: ['08:00', '02:00'], tue: ['08:00', '02:00'], wed: ['08:00', '02:00'],
          thu: ['08:00', '02:00'], fri: ['12:00', '00:30'], sat: ['12:00', '00:30'],
          sun: ['08:00', '02:00'],
        },
      },
      createdAt: days(250 - i * 9),
      lastActive: i === 0 ? mins(2) : i === 8 ? null : mins(40 + i * 130),
    });

    data.owners.push({
      id: 'own_' + slug,
      clientId,
      name: ownerName,
      email,
      password: slug === 'spice-route' ? 'NewPassword999' : 'owner123',
      phone: i === 0 ? '+91 98200 41127' : '',
      lastLogin: i === 0 ? mins(2) : mins(180 + i * 60),
    });

    for (let t = 1; t <= tableCount; t += 1) {
      const isBar = t > 10;
      data.tables.push({
        id: `tbl_${slug}_${t}`,
        clientId,
        name: isBar ? 'Bar ' + (t - 10) : 'Table ' + t,
        seats: isBar ? 2 : t % 3 === 0 ? 4 : 2,
        token: `${slug.slice(0, 3)}-${t}k${Math.random().toString(36).slice(2, 5)}`,
        status: slug === 'spice-route' ? 'free' : (t % 4 === 0 ? 'occupied' : 'free'),
        createdAt: days(200),
      });
    }
  });

  // Categories and menu for the demo restaurant
  const catNames = [['starters', 'Starters'], ['mains', 'Mains'], ['pizza', 'Pizza'], ['desserts', 'Desserts'], ['drinks', 'Drinks']];
  catNames.forEach(([key, label], i) => {
    data.categories.push({ id: 'cat_' + key, clientId: 'cli_olive-table', name: label, position: i });
  });

  ITEM_SEED.forEach((row, i) => {
    const [cat, name, price, tags, available, img, desc, sizes, addons] = row;
    data.items.push({
      id: 'itm_' + (i + 1),
      clientId: 'cli_olive-table',
      categoryId: 'cat_' + cat,
      name,
      description: desc,
      price,
      tags,
      available,
      image: IMG(img),
      prepTime: 12,
      sizes: sizes.map((s, si) => ({ id: 'sz_' + i + '_' + si, ...s })),
      addons: addons.map((g, gi) => ({ id: 'ag_' + i + '_' + gi, ...g })),
    });
  });

  // Kitchen & floor staff
  [
    ['Ravi Kumar', '1234', 'floor', true, mins(2)],
    ['Meera Joshi', '4821', 'kitchen', true, mins(18)],
    ['Sanjay Patil', '7712', 'kitchen', false, days(3)],
  ].forEach(([name, pin, role, active, lastActive], i) => {
    data.staff.push({ id: 'stf_' + i, clientId: 'cli_olive-table', name, role: role || 'kitchen', pin, active, lastActive });
  });

  // Staff for Spice Route
  data.staff.push(
    { id: 'stf_sr_ravi', clientId: 'cli_spice-route', name: 'Ravi', role: 'kitchen', pin: '9514', active: true, lastActive: mins(5) },
    { id: 'stf_sr_maya', clientId: 'cli_spice-route', name: 'Maya', role: 'floor', pin: '7701', active: true, lastActive: mins(5) }
  );

  // Menu for Spice Route
  const srCatNames = [['starters', 'Starters'], ['mains', 'Mains'], ['drinks', 'Drinks']];
  srCatNames.forEach(([key, label], i) => {
    data.categories.push({ id: 'cat_sr_' + key, clientId: 'cli_spice-route', name: label, position: i });
  });

  const SR_ITEMS = [
    ['starters', 'Chicken Tikka', 10, ['gf'], true, 'Tender chicken marinated in yoghurt and aromatic spices.'],
    ['mains', 'Lamb Biryani', 13, ['gf'], true, 'Fragrant basmati rice layered with spiced lamb and saffron.'],
    ['drinks', 'Mango Lassi', 3.5, ['veg'], true, 'Creamy churned yoghurt with sweet Alphonso mango pulp.'],
    ['starters', 'Onion Bhaji', 5, ['vegan'], false, 'Crisp golden spiced onion fritters. Sold out today.'],
    ['starters', 'Samosa', 4.5, ['veg'], true, 'Crispy pastry parcels stuffed with spiced potatoes and peas.'],
    ['mains', 'Butter Chicken', 12.5, ['gf'], true, 'Tandoori chicken in a silky, rich tomato and butter sauce.'],
  ];

  SR_ITEMS.forEach(([cat, name, price, tags, available, desc], i) => {
    data.items.push({
      id: 'itm_sr_' + (i + 1),
      clientId: 'cli_spice-route',
      categoryId: 'cat_sr_' + cat,
      name,
      description: desc,
      price,
      tags,
      available,
      taxOverride: cat === 'drinks' ? 20 : undefined,
      image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=400&q=70',
      prepTime: 12,
      sizes: [],
      addons: [],
    });
  });

  // Orders
  const item = (name, qty, price, extra = {}) => ({ name, qty, price, ...extra });
  const oliveSettings = data.clients[0].settings;
  const mkOrder = (number, tableName, status, agoMin, items, opts = {}) => {
    const totals = computeBill({ lines: items.map((it) => ({ amount: it.price * it.qty, taxOverride: 'default' })), settings: oliveSettings });
    data.orders.push({
      id: 'ord_' + number,
      clientId: 'cli_olive-table',
      number,
      tableName,
      tableId: 'tbl_olive-table_' + (tableName.replace('Table ', '') || '1'),
      items,
      note: opts.note || '',
      guestName: opts.guestName || '',
      subtotal: totals.subtotal,
      tax: totals.taxTotal,
      service: totals.chargeTotal,
      total: totals.total,
      breakdown: totals,
      status,
      createdAt: mins(agoMin),
      updatedAt: mins(Math.max(0, agoMin - 2)),
    });
  };

  mkOrder(1046, 'Table 4', 'new', 2, [
    item('Margherita', 2, 13, { size: 'Regular', note: 'No basil on one' }),
    item('House lemonade', 1, 4.5, { size: 'Regular' }),
  ], { note: 'One guest is vegan — no cheese on one pizza.', guestName: 'Priya M.' });

  mkOrder(1045, 'Table 9', 'new', 5, [
    item('Charred octopus', 1, 19, { size: 'Large', addons: ['Extra salsa verde'], note: 'No chilli, please.' }),
    item('Olive oil cake', 2, 8),
  ]);

  mkOrder(1043, 'Table 2', 'pending_approval', 1, [item('Margherita', 1, 13)]);

  mkOrder(1042, 'Table 7', 'preparing', 12, [
    item('Margherita', 2, 13, { size: 'Regular', note: 'No basil', done: true }),
    item('Charred octopus', 1, 19, { size: 'Large', addons: ['Extra salsa verde'], note: 'Sauce on the side.' }),
    item('House lemonade', 1, 4.5, { size: 'Regular' }),
  ], { note: 'One guest is allergic to shellfish, please keep the octopus separate.', guestName: 'Priya M.' });

  mkOrder(1040, 'Table 12', 'preparing', 21, [
    item('Truffle mushroom', 3, 17),
    item('Warm olive & rosemary bread', 2, 6),
    item('Spicy nduja', 1, 16, { note: 'Extra hot honey' }),
  ], { note: 'Guest asked for everything to come together.' });

  mkOrder(1041, 'Table 3', 'ready', 9, [
    item('Slow-braised lamb shoulder', 1, 24, { note: 'No gremolata' }),
    item('House lemonade', 2, 4.5),
  ], { guestName: 'Rahul S.' });

  mkOrder(1039, 'Bar 2', 'served', 38, [item('Olive leaf spritz', 1, 11), item('Crispy calamari', 1, 11)]);
  mkOrder(1038, 'Table 5', 'served', 44, [
    item('Pan-seared sea bass', 1, 22.5), item('Cold brew', 2, 4), item('Dark chocolate tart', 1, 9),
  ]);
  mkOrder(1037, 'Table 9', 'served', 62, [item('Margherita', 2, 13)]);
  mkOrder(1036, 'Table 1', 'served', 84, [
    item('Charcoal chicken', 2, 19), item('Greek frappé', 2, 4.5), item('Lemon sorbet', 2, 6.5),
  ]);
  mkOrder(1035, 'Bar 1', 'served', 98, [item('House lemonade', 3, 4.5), item('Olive oil cake', 1, 8)]);
  mkOrder(1033, 'Table 7', 'rejected', 122, [item('Baklava cheesecake', 2, 9.5)], { note: 'Item sold out at the time.' });

  // Yesterday's orders so reports have some history
  for (let i = 0; i < 14; i += 1) {
    const o = {
      id: 'ord_y' + i,
      clientId: 'cli_olive-table',
      number: 1020 + i,
      tableName: 'Table ' + ((i % 10) + 1),
      tableId: 'tbl_olive-table_' + ((i % 10) + 1),
      items: [item('Margherita', 1 + (i % 3), 13), item('House lemonade', 1, 4.5)],
      note: '',
      guestName: '',
      subtotal: 0, tax: 0, service: 0, total: 0,
      status: 'served',
      createdAt: new Date(Date.now() - 86400000 - i * 1800000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 - i * 1800000 + 900000).toISOString(),
    };
    const totals = computeBill({ lines: o.items.map((it) => ({ amount: it.price * it.qty, taxOverride: 'default' })), settings: oliveSettings });
    o.subtotal = totals.subtotal;
    o.tax = totals.taxTotal;
    o.service = totals.chargeTotal;
    o.total = totals.total;
    o.breakdown = totals;
    data.orders.push(o);
  }

  // Open table sessions for today's live orders
  const liveStatuses = ['new', 'pending_approval', 'preparing', 'ready'];
  const byTable = new Map();
  data.orders
    .filter((o) => liveStatuses.includes(o.status))
    .forEach((o) => {
      if (!byTable.has(o.tableName)) byTable.set(o.tableName, []);
      byTable.get(o.tableName).push(o);
    });
  byTable.forEach((orders, tableName) => {
    const table = data.tables.find((t) => t.clientId === 'cli_olive-table' && t.name === tableName);
    if (!table) return;
    const demoKey = String(1000 + (data.sessions.length + 1) * 739 % 9000);
    const demoSecret = 'sec_' + tableName.toLowerCase().replace(/\s+/g, '-') + '_init';
    data.sessions.push({
      id: 'ses_' + tableName.toLowerCase().replace(/\s+/g, '-'),
      clientId: 'cli_olive-table',
      tableId: table.id,
      tableName,
      tableKey: demoKey,
      joinSecret: demoSecret,
      status: 'open',
      openedAt: orders[orders.length - 1].createdAt,
      closedAt: null,
      orderIds: orders.map((o) => o.id),
      removedChargeIds: [],
      addedChargeIds: [],
      discount: { type: 'percent', value: 0, reason: '' },
      tip: { type: 'percent', value: 0 },
      bill: null,
      payment: null,
    });
    table.status = 'occupied';
    table.tableKey = demoKey;
    table.activeSecret = demoSecret;
  });

  // One paid session from yesterday, so reports have payment data
  const yOrders = data.orders.filter((o) => o.number >= 1020 && o.number < 1034).slice(0, 3);
  if (yOrders.length) {
    const t5 = data.tables.find((t) => t.clientId === 'cli_olive-table' && t.name === 'Table 5');
    const paidBill = computeBill({
      lines: yOrders.flatMap((o) => o.items.map((it) => ({ amount: it.price * it.qty }))),
      settings: oliveSettings,
      discount: { type: 'percent', value: 10, reason: 'Regular guest' },
      tip: { type: 'percent', value: 15 },
    });
    data.sessions.push({
      id: 'ses_paid_yesterday',
      clientId: 'cli_olive-table',
      tableId: t5 ? t5.id : 'tbl_olive-table_5',
      tableName: 'Table 5',
      status: 'paid',
      openedAt: days(1),
      closedAt: days(1),
      orderIds: yOrders.map((o) => o.id),
      removedChargeIds: [],
      addedChargeIds: [],
      discount: { type: 'percent', value: 10, reason: 'Regular guest' },
      tip: { type: 'percent', value: 15 },
      bill: paidBill,
      payment: { method: 'card', at: days(1), amount: paidBill.total },
    });
    yOrders.forEach((o) => { o.sessionId = 'ses_paid_yesterday'; });
  }

  // Waiter calls
  [
    ['Table 4', 'waiter', 1],
    ['Table 9', 'bill', 3],
    ['Bar 1', 'waiter', 5],
    ['Table 12', 'bill', 8],
  ].forEach(([tableName, type, ago], i) => {
    data.waiterCalls.push({
      id: 'wc_' + i,
      clientId: 'cli_olive-table',
      tableName,
      type,
      status: 'open',
      createdAt: mins(ago),
    });
  });

  // Invites
  [
    ['Spice Route', 'Aisha Khan', 'aisha@spiceroute.demo', 'United Kingdom', 'pro', 'accepted', 1, 7],
    ['Tiffin & Chai', 'Rohan Mehta', 'rohan@tiffinchai.in', 'India', 'starter', 'pending', 0, 7],
    ['Curry Leaf Cafe', 'Aditi Sharma', 'aditi@curryleaf.in', 'India', 'starter', 'accepted', 2, 7],
    ['Casa Verde', 'Marco Rossi', 'marco@casaverde.co.uk', 'United Kingdom', 'pro', 'expired', 14, 7],
    ['The Daily Grind', 'Emily Carter', 'emily@dailygrind.us', 'United States', 'starter', 'accepted', 40, 7],
    ['The Salt Room', 'Olivia Bennett', 'olivia@saltroom.co.uk', 'United Kingdom', 'pro', 'revoked', 52, 7],
  ].forEach(([clientName, ownerName, email, country, planId, status, agoDays, expiry], i) => {
    data.invites.push({
      id: 'inv_' + i,
      token: 'tok_' + Math.random().toString(36).slice(2, 10),
      clientName,
      ownerName,
      email,
      country,
      planId,
      status,
      createdAt: days(agoDays),
      expiresAt: new Date(Date.now() + (expiry - agoDays) * 86400000).toISOString(),
      sentBy: 'Vivek Kumar',
    });
  });

  // Activity
  [
    ['Ananya Rao', 'cli_olive-table', 'Order volume', 'Orders today updated', 4],
    ['Vivek Kumar', null, 'Invite', 'Invite sent to rohan@tiffinchai.in', 14],
    ['Priya Nair', 'cli_spice-route', 'Menu change', '6 items added to the Mains category', 60],
    ['System', 'cli_daily-grind', 'Restriction change', 'Switched to read-only mode (plan limit reached)', 120],
    ['James Whitfield', 'cli_copper-kettle', 'Login', 'Owner logged in', 180],
    ['Neha Iyer', 'cli_harbor-rye', 'Suspension', 'Account suspended for unpaid invoice', 420],
    ['Thabo Ndlovu', 'cli_ndlovu-grill', 'Order volume', '61 orders served, busiest day this month', 900],
    ['Vivek Kumar', 'cli_casa-verde', 'Restriction change', 'Table limit raised from 20 to 30', 1500],
  ].forEach(([actor, clientId, type, details, ago], i) => {
    data.activity.push({
      id: 'act_' + i,
      actor,
      clientId,
      type,
      details,
      device: i % 3 === 0 ? 'Chrome · macOS' : i % 3 === 1 ? 'Chrome · Windows' : 'Safari · iPhone',
      at: mins(ago),
    });
  });

  // Internal notes
  data.notes.push({
    id: 'note_1', clientId: 'cli_olive-table', author: 'Vivek Kumar',
    text: 'Second location planned for June. Wants a single dashboard for both — told them it is on the roadmap.',
    at: days(240),
  });
  data.notes.push({
    id: 'note_2', clientId: 'cli_olive-table', author: 'Neha Iyer',
    text: 'Asked about card payments on the guest menu. Explained it is version 2, they were fine with paying at the counter.',
    at: days(30),
  });

  return data;
}

/* ------------------------------------------------------ taxes & charges --- */
/** The tax override that applies to an item: item beats category beats default. */
export function resolveTaxOverride(item, category) {
  const own = item && item.taxOverride ? item.taxOverride : 'default';
  if (own !== 'default') return own;
  const inherited = category && category.taxOverride ? category.taxOverride : 'default';
  return inherited;
}

/** A saved breakdown for old orders that were placed before taxes were itemised. */
export function legacyBreakdown(order, settings) {
  const subtotal = round2(order.subtotal || 0);
  const tax = round2(order.tax || 0);
  const service = round2(order.service || 0);
  const currency = (settings && settings.currency) || '$';
  return {
    pricesIncludeTax: false,
    rounding: 'none',
    subtotal,
    taxes: tax > 0 ? [{ id: 'legacy_tax', name: 'Tax', rate: 0, amount: tax }] : [],
    includedTaxes: [],
    charges: service > 0 ? [{ id: 'legacy_service', name: 'Service charge', type: 'percent', value: 0, amount: service }] : [],
    taxTotal: tax,
    chargeTotal: service,
    total: round2(order.total || subtotal + tax + service),
    currency,
  };
}

/* ------------------------------------------------------- table sessions --- */
export function generateTableKey() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function generateJoinSecret() {
  return 'sec_' + Math.random().toString(36).slice(2, 10);
}

export function sessionForTable(clientId, tableId) {
  return query('sessions', (s) => s.clientId === clientId && s.tableId === tableId && s.status === 'open')[0] || null;
}

export function openSessionForTable(clientId, table) {
  const existing = sessionForTable(clientId, table.id);
  if (existing) {
    if (!existing.tableKey || !existing.joinSecret) {
      const key = existing.tableKey || generateTableKey();
      const secret = existing.joinSecret || generateJoinSecret();
      update('sessions', existing.id, { tableKey: key, joinSecret: secret });
      update('tables', table.id, { tableKey: key, activeSecret: secret });
    }
    return getById('sessions', existing.id);
  }
  const key = generateTableKey();
  const secret = generateJoinSecret();
  const session = insert('sessions', {
    clientId,
    tableId: table.id,
    tableName: table.name,
    tableKey: key,
    joinSecret: secret,
    status: 'open',
    openedAt: new Date().toISOString(),
    closedAt: null,
    orderIds: [],
    removedChargeIds: [],
    addedChargeIds: [],
    discount: { type: 'percent', value: 0, reason: '' },
    tip: { type: 'percent', value: 0 },
    bill: null,
    payment: null,
  });
  update('tables', table.id, { status: 'occupied', tableKey: key, activeSecret: secret });
  return session;
}

export function seatTable(clientId, table) {
  const key = generateTableKey();
  const secret = generateJoinSecret();
  const existing = sessionForTable(clientId, table.id);

  let session;
  if (existing) {
    session = update('sessions', existing.id, {
      tableKey: key,
      joinSecret: secret,
      openedAt: new Date().toISOString(),
    });
  } else {
    session = insert('sessions', {
      clientId,
      tableId: table.id,
      tableName: table.name,
      tableKey: key,
      joinSecret: secret,
      status: 'open',
      openedAt: new Date().toISOString(),
      closedAt: null,
      orderIds: [],
      removedChargeIds: [],
      addedChargeIds: [],
      discount: { type: 'percent', value: 0, reason: '' },
      tip: { type: 'percent', value: 0 },
      bill: null,
      payment: null,
    });
  }
  update('tables', table.id, { status: 'occupied', tableKey: key, activeSecret: secret, failedKeyAttempts: 0 });
  return session;
}

export function sessionOrders(session) {
  const sess = typeof session === 'string' ? getById('sessions', session) : session;
  if (!sess) return [];
  return (sess.orderIds || [])
    .map((id) => getById('orders', id))
    .filter((order) => order && order.status !== 'rejected');
}

export function sessionLines(session) {
  return sessionOrders(session).flatMap((order) =>
    (order.items || []).map((item) => ({
      amount: item.price * item.qty,
      taxOverride: item.taxOverride || 'default',
    }))
  );
}

export function addOrderToSession(sessionId, orderId) {
  const session = getById('sessions', sessionId);
  if (!session) return null;
  return update('sessions', sessionId, { orderIds: [...(session.orderIds || []), orderId] });
}

export function closeSession(sessionId, payment, bill) {
  const session = getById('sessions', sessionId);
  if (!session) return null;
  const closed = update('sessions', sessionId, {
    status: 'paid',
    closedAt: new Date().toISOString(),
    joinSecret: 'closed_' + Math.random().toString(36).slice(2, 8),
    payment,
    bill,
  });
  update('tables', session.tableId, { status: 'free', tableKey: null, activeSecret: null, failedKeyAttempts: 0 });
  // Mark all orders belonging to this session as paid
  (session.orderIds || []).forEach((oid) => {
    update('orders', oid, { paid: true, payment });
  });
  // Auto-resolve any open waiter calls or bill requests for this session
  query('waiterCalls', (c) => (c.sessionId === sessionId || c.tableId === session.tableId) && c.status === 'open')
    .forEach((c) => update('waiterCalls', c.id, { status: 'done' }));
  return closed;
}

/* ------------------------------------------------------- small utilities -- */
export function clientById(id) {
  return getById('clients', id);
}

export function itemsOf(clientId) {
  return query('items', (it) => it.clientId === clientId);
}

export function categoriesOf(clientId) {
  return query('categories', (c) => c.clientId === clientId).sort((a, b) => a.position - b.position);
}

export function tablesOf(clientId) {
  return query('tables', (t) => t.clientId === clientId);
}

export function ordersOf(clientId) {
  return query('orders', (o) => o.clientId === clientId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function nextOrderNumber(clientId) {
  const numbers = ordersOf(clientId).map((o) => Number(o.number) || 0);
  return (numbers.length ? Math.max(...numbers) : 1040) + 1;
}

export function usageFor(clientId) {
  const client = clientById(clientId);
  return {
    tables: tablesOf(clientId).length,
    items: itemsOf(clientId).length,
    staff: query('staff', (s) => s.clientId === clientId).length,
    limits: client ? client.limits : { tables: 0, items: 0, staff: 0 },
  };
}

/** The initial data set (used by `npm run db:seed` and to bootstrap an empty database). */
export function seedData() {
  const data = seed();
  data.__version = VERSION;
  return data;
}

/* ------------------------------------------------------------ cloud sync ---
   Neon Postgres via /api/db. Three moves:
   1. start: on a browser's first visit, load every record from the server
      before any page module runs (top-level await below). After that, pages
      start instantly from the localStorage cache and catch up with one
      "changes since <cursor>" request, so navigating never waits on the
      network (and never re-downloads the whole database).
   2. flush: after each write, compare each record's fingerprint with the one
      the server last confirmed (`synced`) and POST only changed and deleted
      records. Fingerprints and the cursor persist in localStorage, so an edit
      that had not reached the server when the previous page closed is still
      found and sent.
   3. poll: every few seconds fetch records changed since the cursor and
      merge them. A record with an unsent local edit keeps the local version
      (it is pushed next); otherwise the server's version wins. Merged changes
      are announced as the app's usual realtime events (order:new, call:new…)
      through a `tt:remote` DOM event that realtime.js forwards.
   ------------------------------------------------------------------------- */

const CLOUD_ENABLED = typeof window !== 'undefined' && typeof fetch === 'function' &&
  /^https?:$/.test(window.location.protocol);
const API_DB = CLOUD_ENABLED ? new URL('../../api/db', import.meta.url).href : '';
const META_KEY = 'tqr_cloud';
const SEP = '\u0000';
const POLL_MS = 4000;
const BATCH = 500;

const synced = new Map(); // "collection\0id" → fingerprint of the version the server has
const cloud = { status: 'off', lastSyncAt: null, error: null };
let cloudCursor = null;
let flushTimer = null;
let flushing = false;
let flushAgain = false;
let pollTimer = null;
let metaTimer = null;

/** { status: 'off' | 'connecting' | 'online' | 'error', lastSyncAt, error } */
export function cloudStatus() {
  return { ...cloud };
}

function setCloud(patch) {
  Object.assign(cloud, patch);
  try { window.dispatchEvent(new CustomEvent('tt:cloud-status', { detail: cloudStatus() })); } catch (_) { /* no DOM */ }
}

/** JSON with sorted keys, so Postgres jsonb key order never looks like a change. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .filter((k) => value[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}

/** Short fingerprint of a record: length + two independent 32-bit FNV-1a hashes. */
function fingerprint(record) {
  const s = stable(record);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x0100019d) ^ (b >>> 15);
  }
  return s.length.toString(36) + '.' + (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}

function eachRecord(db, fn) {
  for (const name of Object.keys(db)) {
    const list = db[name];
    if (!Array.isArray(list)) continue;
    for (const record of list) {
      if (record && record.id !== undefined && record.id !== null) fn(name, record);
    }
  }
}

function saveMeta() {
  clearTimeout(metaTimer);
  metaTimer = null;
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ cursor: cloudCursor, synced: Object.fromEntries(synced) }));
  } catch (_) { /* storage full or blocked: next visit does a full load */ }
}

function saveMetaSoon() {
  if (!metaTimer) metaTimer = setTimeout(saveMeta, 500);
}

function loadMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    return meta && typeof meta.cursor === 'string' && meta.synced && typeof meta.synced === 'object' ? meta : null;
  } catch (_) {
    return null;
  }
}

function pendingChanges() {
  const upserts = [];
  const deletes = [];
  if (!cache) return { upserts, deletes };
  const seen = new Set();
  eachRecord(cache, (collection, record) => {
    const key = collection + SEP + String(record.id);
    seen.add(key);
    const print = fingerprint(record);
    if (synced.get(key) !== print) upserts.push({ key, print, collection, record });
  });
  for (const key of synced.keys()) {
    if (seen.has(key)) continue;
    const at = key.indexOf(SEP);
    deletes.push({ key, collection: key.slice(0, at), id: key.slice(at + 1) });
  }
  return { upserts, deletes };
}

function scheduleCloudFlush(delay = 300) {
  if (!cloudReady || !CLOUD_ENABLED || cloud.status === 'off' || cloud.status === 'connecting') return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushCloud(); }, delay);
}

/** Pushes local changes now. Resolves true when nothing is left unsent. */
export async function flushCloud({ keepalive = false } = {}) {
  if (!CLOUD_ENABLED || cloud.status === 'off' || cloud.status === 'connecting') return false;
  if (flushing) { flushAgain = true; return false; }
  const { upserts, deletes } = pendingChanges();
  if (!upserts.length && !deletes.length) return true;

  flushing = true;
  const items = [...upserts.map((u) => ({ ...u, kind: 'upsert' })), ...deletes.map((d) => ({ ...d, kind: 'delete' }))];
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const body = JSON.stringify({
        upserts: batch.filter((b) => b.kind === 'upsert').map((b) => ({ collection: b.collection, record: b.record })),
        deletes: batch.filter((b) => b.kind === 'delete').map((b) => ({ collection: b.collection, id: b.id })),
      });
      const res = await fetch(API_DB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: keepalive && body.length < 60000,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed (HTTP ' + res.status + ')');
      }
      batch.forEach((b) => (b.kind === 'upsert' ? synced.set(b.key, b.print) : synced.delete(b.key)));
    }
    if (keepalive) saveMeta(); else saveMetaSoon();
    setCloud({ status: 'online', lastSyncAt: new Date().toISOString(), error: null });
    return true;
  } catch (err) {
    setCloud({ status: 'error', error: err.message });
    scheduleCloudFlush(5000);
    return false;
  } finally {
    flushing = false;
    if (flushAgain) { flushAgain = false; scheduleCloudFlush(); }
  }
}

function remoteEvent(collection, kind, record, previous) {
  const rec = record || previous || {};
  const clientId = rec.clientId;
  switch (collection) {
    case 'orders':
      return kind === 'insert'
        ? { event: 'order:new', data: { orderId: rec.id, clientId } }
        : { event: 'order:update', data: { orderId: rec.id, clientId } };
    case 'waiterCalls':
      return kind === 'insert'
        ? { event: 'call:new', data: { clientId, type: rec.type, tableId: rec.tableId } }
        : { event: 'call:update', data: { clientId } };
    case 'sessions':
      if (record && previous && record.status !== previous.status) {
        if (record.status === 'paid') return { event: 'session:paid', data: { clientId, sessionId: rec.id } };
        if (record.status === 'closed') return { event: 'session:close', data: { clientId, sessionId: rec.id, tableId: rec.tableId } };
      }
      return { event: 'table:update', data: { clientId, tableId: rec.tableId } };
    case 'items':
    case 'categories':
      return { event: 'menu:update', data: { clientId, itemId: collection === 'items' ? rec.id : undefined } };
    case 'tables':
      return { event: 'table:update', data: { clientId, tableId: rec.id } };
    case 'clients':
      return { event: 'settings:update', data: { clientId: rec.id } };
    default:
      return { event: 'db:remote', data: { collection, id: rec.id, clientId } };
  }
}

function applyRemote(changes) {
  const db = read();
  const events = [];
  let touched = false;
  for (const change of changes) {
    if (!change || !change.collection || change.id === undefined) continue;
    const key = change.collection + SEP + String(change.id);
    const list = db[change.collection] || (db[change.collection] = []);
    const index = list.findIndex((r) => r && String(r.id) === String(change.id));
    const local = index === -1 ? null : list[index];
    const localPrint = local ? fingerprint(local) : undefined;
    if (localPrint !== synced.get(key)) continue; // unsent local edit or delete: ours wins, flush sends it

    if (change.deleted) {
      if (index !== -1) {
        list.splice(index, 1);
        touched = true;
        events.push(remoteEvent(change.collection, 'delete', null, local));
      }
      synced.delete(key);
      continue;
    }
    const print = fingerprint(change.data);
    synced.set(key, print);
    if (print === localPrint) continue;
    if (index === -1) list.push(change.data);
    else list[index] = change.data;
    touched = true;
    events.push(remoteEvent(change.collection, index === -1 ? 'insert' : 'update', change.data, local));
  }
  if (touched) {
    db.__version = VERSION;
    persistToStorage(db); // not write(): these changes came from the server
  }
  return events;
}

async function pollCloud() {
  if (document.hidden || cloud.status === 'off') { schedulePoll(); return; }
  try {
    const res = await fetch(API_DB + '?since=' + encodeURIComponent(cloudCursor), { cache: 'no-store' });
    if (!res.ok) throw new Error('Refresh failed (HTTP ' + res.status + ')');
    const body = await res.json();
    if (body.truncated) {
      // Too much changed since this cache was saved: start over from a full load.
      localStorage.removeItem(META_KEY);
      window.location.reload();
      return;
    }
    cloudCursor = body.cursor || cloudCursor;
    const events = applyRemote(body.changes || []);
    saveMetaSoon();
    if (cloud.status !== 'online') setCloud({ status: 'online', error: null });
    events.forEach((detail) => window.dispatchEvent(new CustomEvent('tt:remote', { detail })));
  } catch (err) {
    setCloud({ status: 'error', error: err.message });
  }
  schedulePoll();
}

function schedulePoll(delay = POLL_MS) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollCloud, delay);
}

function startSyncLoop() {
  const onLeave = () => { flushCloud({ keepalive: true }); saveMeta(); };
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onLeave();
    else schedulePoll(0);
  });
}

/**
 * Start from the cache this browser already synced. Returns false when there is
 * none (first visit, cleared storage, or data from before cloud sync).
 */
function resumeFromCache() {
  const meta = loadMeta();
  if (!meta) return false;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!parsed || parsed.__version !== VERSION) return false;
    cache = parsed;
  } catch (_) {
    return false;
  }
  synced.clear();
  for (const [key, print] of Object.entries(meta.synced)) synced.set(key, print);
  cloudCursor = meta.cursor;
  setCloud({ status: 'online', lastSyncAt: null, error: null });
  startSyncLoop();
  schedulePoll(0);        // catch up on other devices' changes right away
  scheduleCloudFlush(0);  // and send anything the previous page left unsent
  return true;
}

/** First visit: load the whole store from Neon. On failure the page runs on local data and does not sync. */
async function hydrateFromCloud() {
  setCloud({ status: 'connecting' });
  try {
    const res = await fetch(API_DB, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    const body = await res.json();
    const remote = body.db || {};
    const total = Object.values(remote).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    cloudCursor = body.cursor;
    synced.clear();

    if (total === 0) {
      // Empty database (e.g. a fresh Neon branch): seed it from this browser.
      cache = seedData();
      persistToStorage(cache);
      setCloud({ status: 'online', lastSyncAt: null, error: null });
      await flushCloud();
    } else {
      cache = { ...remote, __version: VERSION };
      persistToStorage(cache);
      eachRecord(cache, (collection, record) => synced.set(collection + SEP + String(record.id), fingerprint(record)));
      setCloud({ status: 'online', lastSyncAt: new Date().toISOString(), error: null });
    }
    saveMeta();
    startSyncLoop();
    schedulePoll();
  } catch (err) {
    setCloud({ status: 'off', error: 'Cloud database unreachable: ' + err.message });
    if (DEMO_MODE) console.warn('TableTap: running on local data only.', err);
  }
}

cloudReady = true;
if (CLOUD_ENABLED && !resumeFromCache()) await hydrateFromCloud();
