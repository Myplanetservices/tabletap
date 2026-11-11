/* ==========================================================================
   TableTap — store.js
   One localStorage key ("tqr_db") holds the whole demo database.
   Vanilla ES module. No build step, no backend.
   ========================================================================== */

import { computeBill } from './billing.js';

const KEY = 'tqr_db';
const VERSION = 7;

let cache = null;

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__version === VERSION) {
        cache = parsed;
        return cache;
      }
    }
  } catch (err) {
    console.warn('TableTap: could not read demo data, reseeding.', err);
  }
  cache = seed();
  write(cache);
  return cache;
}

function write(db) {
  db.__version = VERSION;
  cache = db;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('TableTap: storage full or blocked.', err);
  }
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
  ['Spice Route Kitchen', 'spice-route', 'Priya Nair', 'priya@spiceroute.in', 'India', 'pro', 'active', 30, 'SPICE22'],
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
      settings: {
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
          { id: 'upi', name: 'UPI (GPay / PhonePe / Paytm)', enabled: true },
          { id: 'card', name: 'Card', enabled: true },
          { id: 'cash', name: 'Cash / Waiter', enabled: true },
        ],
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
      password: 'owner123',
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
        status: t % 4 === 0 ? 'occupied' : 'free',
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

  // Kitchen staff
  [
    ['Ravi Kumar', '1234', true, mins(2)],
    ['Meera Joshi', '4821', true, mins(18)],
    ['Sanjay Patil', '7712', false, days(3)],
  ].forEach(([name, pin, active, lastActive], i) => {
    data.staff.push({ id: 'stf_' + i, clientId: 'cli_olive-table', name, role: 'kitchen', pin, active, lastActive });
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
  update('tables', table.id, { status: 'occupied', tableKey: key, activeSecret: secret });
  return session;
}

export function sessionOrders(session) {
  if (!session) return [];
  return (session.orderIds || [])
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
  update('tables', session.tableId, { status: 'free', tableKey: null, activeSecret: null });
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
