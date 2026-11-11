/**
 * TableTap Internationalization (i18n) & Geo-Location Language Engine
 * Supports: English (en), Russian (ru), Ukrainian (uk), Spanish (es), German (de), French (fr)
 *
 * Rules:
 *  - Russia (RU, BY, KZ, KG) -> Russian (ru)
 *  - Ukraine (UA) -> Ukrainian (uk)
 *  - India (IN) -> English (en) [Strict requirement]
 *  - Spanish regions -> Spanish (es)
 *  - DACH regions -> German (de)
 *  - France/Belgium -> French (fr)
 *  - User manual selection via language switcher persists in localStorage.
 *  - URL param ?lang=ru or ?country=RU forces language for testing.
 */

(function () {
  'use strict';

  const SUPPORTED_LANGS = {
    en: { name: 'English', flag: '🇬🇧', dir: 'ltr' },
    ru: { name: 'Русский', flag: '🇷🇺', dir: 'ltr' },
    uk: { name: 'Українська', flag: '🇺🇦', dir: 'ltr' },
    es: { name: 'Español', flag: '🇪🇸', dir: 'ltr' },
    de: { name: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
    fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr' }
  };

  const TRANSLATIONS = {
    // ------------------------------------------------------------------------
    // ENGLISH (Default & India)
    // ------------------------------------------------------------------------
    en: {
      'nav.how_it_works': 'How it works',
      'nav.guest_menu': 'Guest menu',
      'nav.features': 'Features',
      'nav.pricing': 'Pricing',
      'nav.faq': 'FAQ',
      'nav.login': 'Login',
      'nav.open_demo': 'Open the demo',

      // Hero
      'hero.badge_lead': 'Contactless QR Table Ordering & Live Kitchen Pass',
      'hero.badge_price': '$49 Lifetime License',
      'hero.title_p1': 'Guests scan the table QR.',
      'hero.title_accent': 'Your kitchen cooks the ticket.',
      'hero.lead': 'TableTap turns any phone camera into an instant ordering channel. Diners scan their table’s QR code, browse your live menu, and tap to order. Tickets chime instantly on your kitchen tablet. No apps, no waiting for waitstaff, zero commissions.',
      'hero.pillar1_title': 'Zero App Downloads',
      'hero.pillar1_desc': 'Guests scan & order in under 0.8s on Safari or Chrome',
      'hero.pillar2_title': 'Instant Kitchen Chime',
      'hero.pillar2_desc': 'Tickets pop up on any tablet in real time',
      'hero.pillar3_title': 'Zero Commissions',
      'hero.pillar3_desc': 'One-time $49 price. Keep 100% of your sales',
      'hero.btn_guest_demo': 'Try Guest Menu (Table 7 Demo)',
      'hero.btn_kitchen': 'View Live Kitchen Pass',
      'hero.btn_how': 'See how it works',

      // Hero Flow Simulation
      'hero.preview_title': 'Live System Preview',
      'hero.chime_active': 'Kitchen Chime Active',
      'hero.realtime_sync': 'Realtime Sync',
      'hero.step1_pill': 'Step 1 · Dining Table',
      'hero.step1_title': 'Guest Scans & Orders',
      'hero.table_stand_hint': 'Point phone camera',
      'hero.order_sent': 'Order #1047 Sent to Kitchen',
      'hero.step2_pill': 'Step 2 · The Pass',
      'hero.step2_title': 'Kitchen Tablet Displays Ticket',
      'hero.new_order': 'New Order',
      'hero.mark_preparing': 'Mark Preparing',
      'hero.mark_ready': 'Mark Ready',
      'hero.flow_step1': 'Guest sits at table',
      'hero.flow_step2': 'Scans table QR code',
      'hero.flow_step3': 'Orders & pays on phone',
      'hero.flow_step4': 'Kitchen prepares ticket',

      // Menu Showcase
      'preview.badge': 'Real Guest Experience',
      'preview.title': 'What your guests see when they scan',
      'preview.sub': 'No app downloads, no account setup, no phone number verification. In under a second, guests have your full menu on their phone with their table already locked in.',
      'preview.call_waiter': 'Call waiter',
      'preview.request_bill': 'Request bill',
      'preview.all': 'All',
      'preview.mains': 'Mains',
      'preview.pizza': 'Pizza',
      'preview.desserts': 'Desserts',
      'preview.drinks': 'Drinks',
      'preview.add': 'Add',
      'preview.sold_out': 'Sold out',
      'preview.view_order': 'View order',
      'preview.scan_phone': 'Scan with your phone',
      'preview.scan_desc': 'Point your phone camera at this QR code to test the live guest ordering experience right now on Table 7.',
      'preview.open_btn': 'Open Table 7 Menu in Browser',
      'preview.load_title': 'Sub-Second Load Time (0.8s)',
      'preview.load_desc': 'Zero framework bloat. Opens in milliseconds even in basement dining rooms with spotty 3G coverage.',
      'preview.tamper_title': 'Tamper-Proof Table ID',
      'preview.tamper_desc': 'Table 7 is pre-locked into the link with session-join secrets. Guests cannot accidentally or maliciously order to other tables.',
      'preview.dietary_title': 'Dietary Filters & Custom Notes',
      'preview.dietary_desc': 'One-tap filters for Veg, Vegan, Gluten-Free, and Spicy. Diners customize sizes, add toppings, and leave kitchen notes.',
      'preview.shared_title': 'Shared Table Bills (One-Tap Join)',
      'preview.shared_desc': 'Dining companions scan the primary diner\'s phone to join the open session and order together onto one combined ticket.',

      // Sample Dishes
      'dish.margherita.name': 'Margherita Pizza',
      'dish.margherita.desc': 'San Marzano tomato, fior di latte and fresh basil on 48h dough.',
      'dish.lamb.name': 'Slow-braised Lamb Shoulder',
      'dish.lamb.desc': 'Six hours in the oven, served on orzo with gremolata and pan juices.',
      'dish.baklava.name': 'Baklava Cheesecake',
      'dish.baklava.desc': 'Pistachio, filo pastry, honey syrup. Marked 86\'d on pass.',
      'dish.lemonade.name': 'House Lemonade',
      'dish.lemonade.desc': 'Pressed lemon, fresh rosemary syrup, pink peppercorn.',

      // Features Grid
      'features.badge': 'Full Restaurant Operating System',
      'features.title': 'Built for busy dining rooms & high-volume shifts',
      'features.sub': 'Everything you need from the first guest sitting down at 5 PM to closing out the register at midnight. No per-transaction cuts, no monthly lock-in.',
      'f1.title': 'Contactless QR Ordering',
      'f1.desc': 'Guests scan the table code to browse high-res photos, customize toppings, select spice levels, and order directly from their phone.',
      'f2.title': 'Live Kitchen Pass (KDS)',
      'f2.desc': 'Dockets land on the kitchen screen with an audible chime. Cooks mark tickets New, Preparing, or Ready with a single tap.',
      'f3.title': 'Realtime Dish 86\'ing',
      'f3.desc': 'Run out of sea bass or truffles mid-rush? Mark items sold out directly from the kitchen pass to instantly disable ordering across all phones.',
      'f4.title': 'Tables & Floor Management',
      'f4.desc': 'Visual floor plan with real-time occupancy. Track active tables, occupied duration, and generate printable 80mm table QR stands.',
      'f5.title': 'Billing & Split Checks',
      'f5.desc': 'Itemized tax calculations (inclusive/exclusive), configurable tip presets (10%, 15%, 20%), and instant printable customer slips.',
      'f6.title': 'Database & Analytics',
      'f6.desc': 'Real-time synchronization with MongoDB Atlas, optional Google Sheets auto-export, daily revenue breakdowns, and top seller mix charts.',

      // Customer Menu Page
      'menu.open_now': 'Open now',
      'menu.call_waiter_btn': 'Call waiter',
      'menu.ask_bill_btn': 'Ask for bill',
      'menu.search_ph': 'Search dishes, e.g. halloumi',
      'menu.items_count': 'items',
      'menu.empty_cart': 'Your cart is empty',
      'menu.waiter_called': 'Waiter has been called to Table',
      'menu.bill_requested': 'Bill requested for Table',
      'sheet.add_to_order': 'Add to order',
      'sheet.size': 'Size',
      'sheet.special_instructions': 'Special instructions',
      'dish.tag_veg': 'Veg',
      'dish.tag_vegan': 'Vegan',
      'dish.tag_gf': 'Gluten-free',
      'dish.tag_spicy': 'Spicy',

      // Kitchen Pass Page
      'kitchen.title': 'Kitchen Pass',
      'kitchen.stoplist': '86 Items (Stop List)',
      'kitchen.completed_btn': 'Completed Orders',
      'kitchen.tab_new': 'New',
      'kitchen.tab_prep': 'Preparing',
      'kitchen.tab_ready': 'Ready',
      'kitchen.btn_done': 'Mark Ready',
      'kitchen.action_start': 'Start',
      'kitchen.action_ready': 'Mark ready',
      'kitchen.action_served': 'Served',

      // Owner & Admin Portal
      'owner.dashboard': 'Dashboard',
      'owner.live_orders': 'Live Orders',
      'owner.order_history': 'Order History',
      'owner.menu': 'Menu',
      'owner.tables': 'Tables & QR',
      'owner.staff': 'Staff',
      'owner.reports': 'Reports',
      'owner.settings': 'Settings',

      // Language Switcher Label
      'lang.select': 'Language',
      'lang.auto': 'Auto (Detect Location)'
    },

    // ------------------------------------------------------------------------
    // RUSSIAN (Русский) — For Russia, Belarus, Kazakhstan, etc.
    // ------------------------------------------------------------------------
    ru: {
      'nav.how_it_works': 'Как это работает',
      'nav.guest_menu': 'Меню гостя',
      'nav.features': 'Возможности',
      'nav.pricing': 'Тарифы',
      'nav.faq': 'Частые вопросы',
      'nav.login': 'Вход',
      'nav.open_demo': 'Открыть демо',

      // Hero
      'hero.badge_lead': 'Бесконтактный QR-заказ и онлайн-табло для кухни',
      'hero.badge_price': '$49 Разово навсегда',
      'hero.title_p1': 'Гости сканируют QR-код на столе.',
      'hero.title_accent': 'Ваша кухня готовит заказ без задержек.',
      'hero.lead': 'TableTap превращает камеру любого смартфона в удобную систему заказа. Гости сканируют QR-код на столике, выбирают блюда и отправляют заказ прямо из браузера. Чек мгновенно со звуковым сигналом появляется на планшете кухни. Без приложений, очередей и комиссий сервисам.',
      'hero.pillar1_title': 'Без установки приложений',
      'hero.pillar1_desc': 'Открывается за 0.8с в Safari и Chrome без смс и паролей',
      'hero.pillar2_title': 'Звуковой сигнал на кухне',
      'hero.pillar2_desc': 'Чеки мгновенно отображаются на кухонном планшете',
      'hero.pillar3_title': '0% комиссии с продаж',
      'hero.pillar3_desc': 'Единоразово $49 за вечную лицензию. Вся выручка ваша',
      'hero.btn_guest_demo': 'Тест меню гостя (Стол 7)',
      'hero.btn_kitchen': 'Открыть экран кухни (КДС)',
      'hero.btn_how': 'Как это устроено',

      // Hero Flow Simulation
      'hero.preview_title': 'Интерактивная демонстрация системы',
      'hero.chime_active': 'Звуковой сигнал включен',
      'hero.realtime_sync': 'Онлайн синхронизация',
      'hero.step1_pill': 'Шаг 1 · Столик в зале',
      'hero.step1_title': 'Гость сканирует и заказывает',
      'hero.table_stand_hint': 'Наведите камеру телефона',
      'hero.order_sent': 'Заказ #1047 отправлен на кухню',
      'hero.step2_pill': 'Шаг 2 · Экран повара',
      'hero.step2_title': 'Планшет кухни принимает чек',
      'hero.new_order': 'Новый заказ',
      'hero.mark_preparing': 'В приготовлении',
      'hero.mark_ready': 'Готово к выдаче',
      'hero.flow_step1': 'Гость садится за стол',
      'hero.flow_step2': 'Сканирует QR-код стола',
      'hero.flow_step3': 'Заказывает со смартфона',
      'hero.flow_step4': 'Кухня готовит заказ',

      // Menu Showcase
      'preview.badge': 'Реальный опыт гостя',
      'preview.title': 'Что видят ваши гости при сканировании',
      'preview.sub': 'Никаких установок приложений, регистраций или смс. Менее чем за секунду гости получают меню на своём телефоне с уже зафиксированным номером столика.',
      'preview.call_waiter': 'Вызвать официанта',
      'preview.request_bill': 'Попросить счёт',
      'preview.all': 'Все',
      'preview.mains': 'Основные',
      'preview.pizza': 'Пицца',
      'preview.desserts': 'Десерты',
      'preview.drinks': 'Напитки',
      'preview.add': 'Добавить',
      'preview.sold_out': 'Закончилось',
      'preview.view_order': 'Посмотреть заказ',
      'preview.scan_phone': 'Отсканируйте смартфоном',
      'preview.scan_desc': 'Наведите камеру смартфона на этот QR-код, чтобы протестировать реальный заказ гостя прямо сейчас со стола 7.',
      'preview.open_btn': 'Открыть меню Стола 7 в браузере',
      'preview.load_title': 'Мгновенная загрузка (0.8с)',
      'preview.load_desc': 'Без тяжелых библиотек. Открывается за миллисекунды даже в цокольных залах со слабым 3G-интернетом.',
      'preview.tamper_title': 'Защита номера стола',
      'preview.tamper_desc': 'Стол 7 зашифрован в QR-ссылке. Гости не могут случайно или намеренно сделать заказ на чужой столик.',
      'preview.dietary_title': 'Фильтры диет и пожелания',
      'preview.dietary_desc': 'Удобные фильтры: вегетарианское, веганское, без глютена, острое. Гости легко указывают комментарии повару.',
      'preview.shared_title': 'Общий стол и заказ компанией',
      'preview.shared_desc': 'Друзья за столом сканируют экран первого гостя, подключаются к сессии и заказывают вместе в общий чек.',

      // Sample Dishes
      'dish.margherita.name': 'Пицца Маргарита',
      'dish.margherita.desc': 'Томаты Сан-Марцано, сыр моцарелла фиор-ди-латте и свежий базилик на тесте 48ч.',
      'dish.lamb.name': 'Томлёная лопатка ягнёнка',
      'dish.lamb.desc': 'Шесть часов в печи, подаётся с пастой орзо, гремолатой и мясным соком.',
      'dish.baklava.name': 'Чизкейк Пахлава',
      'dish.baklava.desc': 'Фисташки, тесто фило, медовый сироп. Отмечено в стоп-листе на кухне.',
      'dish.lemonade.name': 'Домашний лимонад',
      'dish.lemonade.desc': 'Свежий лимон, розмариновый сироп, розовый перец.',

      // Features Grid
      'features.badge': 'Операционная система для ресторана',
      'features.title': 'Создано для активных ресторанов и полных залов',
      'features.sub': 'Всё необходимое от первой посадки в 17:00 до закрытия смены в полночь. Без абонентской платы и процентов.',
      'f1.title': 'Бесконтактный QR-заказ',
      'f1.desc': 'Гости сканируют код на столе, просматривают сочные фото блюд, выбирают топпинги, степень остроты и заказывают сами.',
      'f2.title': 'Экран кухни (KDS)',
      'f2.desc': 'Чеки моментально появляются на экране кухни со звуковым сигналом. Повар отмечает статус: Новый, Готовится, Готов.',
      'f3.title': 'Мгновенный стоп-лист (86)',
      'f3.desc': 'Закончился лосось или стейк? В один клик поставьте блюдо в стоп-лист на кухне, и оно сразу станет недоступным у всех гостей.',
      'f4.title': 'Управление залом и столами',
      'f4.desc': 'Интерактивная карта залов с индикацией занятости. Печать красивых термочеков с QR-кодами 80 мм для столов.',
      'f5.title': 'Счета, чаевые и раздельный чек',
      'f5.desc': 'Расчёт налогов, встроенные предустановки чаевых (10%, 15%, 20%) и печать понятных гостевых чеков.',
      'f6.title': 'База данных и аналитика',
      'f6.desc': 'Синхронизация с облачной MongoDB Atlas, автоэкспорт в Google Таблицы, графики выручки и анализ популярных блюд.',

      // Customer Menu Page
      'menu.open_now': 'Открыто',
      'menu.call_waiter_btn': 'Вызвать официанта',
      'menu.ask_bill_btn': 'Попросить счёт',
      'menu.search_ph': 'Поиск блюд, например халуми',
      'menu.items_count': 'блюд',
      'menu.empty_cart': 'Ваша корзина пуста',
      'menu.waiter_called': 'Официант вызван к столу',
      'menu.bill_requested': 'Счёт запрошен для стола',
      'sheet.add_to_order': 'Добавить в заказ',
      'sheet.size': 'Размер',
      'sheet.special_instructions': 'Особые пожелания к заказу',
      'dish.tag_veg': 'Вег',
      'dish.tag_vegan': 'Веган',
      'dish.tag_gf': 'Без глютена',
      'dish.tag_spicy': 'Острое',

      // Kitchen Pass Page
      'kitchen.title': 'Кухня (КДС)',
      'kitchen.stoplist': 'Стоп-лист (86)',
      'kitchen.completed_btn': 'Готовые заказы',
      'kitchen.tab_new': 'Новые',
      'kitchen.tab_prep': 'Готовятся',
      'kitchen.tab_ready': 'Готовы',
      'kitchen.btn_done': 'Готово к выдаче',
      'kitchen.action_start': 'Начать',
      'kitchen.action_ready': 'Готово',
      'kitchen.action_served': 'Выдано',

      // Owner & Admin Portal
      'owner.dashboard': 'Панель управления',
      'owner.live_orders': 'Онлайн-заказы',
      'owner.order_history': 'История заказов',
      'owner.menu': 'Меню',
      'owner.tables': 'Столы и QR',
      'owner.staff': 'Сотрудники',
      'owner.reports': 'Отчёты',
      'owner.settings': 'Настройки',

      'lang.select': 'Язык',
      'lang.auto': 'Авто (По геопозиции)'
    },

    // ------------------------------------------------------------------------
    // UKRAINIAN (Українська) — For Ukraine
    // ------------------------------------------------------------------------
    uk: {
      'nav.how_it_works': 'Як це працює',
      'nav.guest_menu': 'Меню гостя',
      'nav.features': 'Можливості',
      'nav.pricing': 'Ціни',
      'nav.faq': 'Часті запитання',
      'nav.login': 'Вхід',
      'nav.open_demo': 'Відкрити демо',

      // Hero
      'hero.badge_lead': 'Безконтактне замовлення за QR-кодом та екран кухні',
      'hero.badge_price': '$49 Одноразово назавжди',
      'hero.title_p1': 'Гості сканують QR-код на столі.',
      'hero.title_accent': 'Кухня готує замовлення без затримок.',
      'hero.lead': 'TableTap перетворює камеру смартфона на швидку систему замовлень. Гості сканують QR-код на столику, обирають страви та замовляють прямо в браузері. Чек миттєво зі звуковим сигналом з\'являється на планшеті кухні. Без додатків, очікування офіціанта та комісій.',
      'hero.pillar1_title': 'Без завантаження додатків',
      'hero.pillar1_desc': 'Відкривається за 0.8с у Safari та Chrome без реєстрацій',
      'hero.pillar2_title': 'Звуковий сигнал на кухні',
      'hero.pillar2_desc': 'Чеки миттєво з\'являються на планшеті кухні',
      'hero.pillar3_title': '0% комісії з замовлень',
      'hero.pillar3_desc': 'Одноразово $49 за довічну ліцензію. Весь виторг ваш',
      'hero.btn_guest_demo': 'Спробувати меню (Стіл 7)',
      'hero.btn_kitchen': 'Відкрити екран кухні',
      'hero.btn_how': 'Як це працює',

      // Hero Flow Simulation
      'hero.preview_title': 'Інтерактивна демонстрація системи',
      'hero.chime_active': 'Звук сповіщень увімкнено',
      'hero.realtime_sync': 'Онлайн синхронізація',
      'hero.step1_pill': 'Крок 1 · Столик у залі',
      'hero.step1_title': 'Гість сканує та замовляє',
      'hero.table_stand_hint': 'Наведіть камеру телефону',
      'hero.order_sent': 'Замовлення #1047 надіслано на кухню',
      'hero.step2_pill': 'Крок 2 · Кухня',
      'hero.step2_title': 'Планшет кухні приймає чек',
      'hero.new_order': 'Нове замовлення',
      'hero.mark_preparing': 'Готується',
      'hero.mark_ready': 'Готово до видачі',
      'hero.flow_step1': 'Гість сідає за стіл',
      'hero.flow_step2': 'Сканує QR-код столу',
      'hero.flow_step3': 'Замовляє зі смартфона',
      'hero.flow_step4': 'Кухня готує замовлення',

      // Menu Showcase
      'preview.badge': 'Реальний досвід гостя',
      'preview.title': 'Що бачать гості після сканування',
      'preview.sub': 'Жодних додатків чи реєстрацій. За частки секунди меню відкривається на екрані смартфона з уже зафіксованим номером столу.',
      'preview.call_waiter': 'Викликати офіціанта',
      'preview.request_bill': 'Попросити рахунок',
      'preview.all': 'Все',
      'preview.mains': 'Основні',
      'preview.pizza': 'Піца',
      'preview.desserts': 'Десерти',
      'preview.drinks': 'Напої',
      'preview.add': 'Додати',
      'preview.sold_out': 'Закінчилося',
      'preview.view_order': 'Переглянути замовлення',
      'preview.scan_phone': 'Відскануйте смартфоном',
      'preview.scan_desc': 'Наведіть камеру смартфона на цей QR-код, щоб протестувати замовлення зі столу 7 прямо зараз.',
      'preview.open_btn': 'Відкрити меню Столу 7 у браузері',
      'preview.load_title': 'Миттєве завантаження (0.8с)',
      'preview.load_desc': 'Без важких скриптів. Швидко працює навіть у підвальних приміщеннях зі слабким 3G-зв\'язком.',
      'preview.tamper_title': 'Захист номера столу',
      'preview.tamper_desc': 'Стіл 7 зашифровано в QR-посиланні. Гості не можуть випадково чи навмисно відправити чек на інший стіл.',
      'preview.dietary_title': 'Фільтри страв та побажання',
      'preview.dietary_desc': 'Зручні фільтри: веганське, безглютенове, гостре. Гості легко залишають коментарі для кухаря.',
      'preview.shared_title': 'Спільний стіл та замовлення компанією',
      'preview.shared_desc': 'Друзі за одним столом сканують код та додають страви в один спільний чек зі своїх смартфонів.',

      // Sample Dishes
      'dish.margherita.name': 'Піца Маргарита',
      'dish.margherita.desc': 'Томати Сан-Марцано, моцарела фіор-ді-латте та свіжий базилік на тісті 48г.',
      'dish.lamb.name': 'Томлена лопатка ягняти',
      'dish.lamb.desc': 'Шість годин у печі, подається з орзо, гремолатою та соком печені.',
      'dish.baklava.name': 'Чизкейк Пахлава',
      'dish.baklava.desc': 'Фісташки, тісто філо, медовий сироп. Позначено в стоп-листі.',
      'dish.lemonade.name': 'Домашній лимонад',
      'dish.lemonade.desc': 'Свіжовичавлений лимон, сироп розмарину, рожевий перець.',

      // Features Grid
      'features.badge': 'Операційна система для ресторану',
      'features.title': 'Створено для завантажених залів та швидкого сервісу',
      'features.sub': 'Все необхідне від першого гостя о 17:00 до закриття зміни опівночі. Без щомісячних платежів та комісій.',
      'f1.title': 'Безконтактне QR-замовлення',
      'f1.desc': 'Гості сканують код на столі, переглядають фотографії страв, обирають розміри та замовляють самі.',
      'f2.title': 'Екран кухні (KDS)',
      'f2.desc': 'Замовлення миттєво з\'являються на екрані кухні зі звуковим сигналом. Кухар відзначає: Нове, Готується, Готово.',
      'f3.title': 'Миттєвий стоп-лист (86)',
      'f3.desc': 'Закінчилися інгредієнти? В один дотик поставте страву в стоп-лист, і вона миттєво заблокується на всіх смартфонах.',
      'f4.title': 'Керування залом та столами',
      'f4.desc': 'Візуальна карта залів з відображенням зайнятості. Друк гарних QR-підставок 80 мм для столів.',
      'f5.title': 'Рахунки та чайові',
      'f5.desc': 'Розрахунок податків, налаштування чайових (10%, 15%, 20%) та друк чеків для гостей.',
      'f6.title': 'База даних та аналітика',
      'f6.desc': 'Синхронізація з MongoDB Atlas, експорт у Google Таблиці, графіки виторгу та аналітика популярних страв.',

      // Customer Menu Page
      'menu.open_now': 'Відчинено',
      'menu.call_waiter_btn': 'Викликати офіціанта',
      'menu.ask_bill_btn': 'Попросити рахунок',
      'menu.search_ph': 'Пошук страв, наприклад халумі',
      'menu.items_count': 'страв',
      'menu.empty_cart': 'Ваш кошик порожній',
      'menu.waiter_called': 'Офіціанта викликано до столу',
      'menu.bill_requested': 'Рахунок запитано для столу',
      'sheet.add_to_order': 'Додати до замовлення',
      'sheet.size': 'Розмір',
      'sheet.special_instructions': 'Особливі побажання до страви',
      'dish.tag_veg': 'Вег',
      'dish.tag_vegan': 'Веган',
      'dish.tag_gf': 'Без глютену',
      'dish.tag_spicy': 'Гостре',

      // Kitchen Pass Page
      'kitchen.title': 'Кухня (КДС)',
      'kitchen.stoplist': 'Стоп-лист (86)',
      'kitchen.completed_btn': 'Виконані замовлення',
      'kitchen.tab_new': 'Нові',
      'kitchen.tab_prep': 'Готуються',
      'kitchen.tab_ready': 'Готові',
      'kitchen.btn_done': 'Готово до видачі',
      'kitchen.action_start': 'Почати',
      'kitchen.action_ready': 'Готово',
      'kitchen.action_served': 'Видано',

      // Owner & Admin Portal
      'owner.dashboard': 'Панель керування',
      'owner.live_orders': 'Онлайн-замовлення',
      'owner.order_history': 'Історія замовлень',
      'owner.menu': 'Меню',
      'owner.tables': 'Столи та QR',
      'owner.staff': 'Персонал',
      'owner.reports': 'Звіти',
      'owner.settings': 'Налаштування',

      'lang.select': 'Мова',
      'lang.auto': 'Авто (За геопозицією)'
    },

    // ------------------------------------------------------------------------
    // SPANISH (Español)
    // ------------------------------------------------------------------------
    es: {
      'nav.how_it_works': 'Cómo funciona',
      'nav.guest_menu': 'Menú comensal',
      'nav.features': 'Funciones',
      'nav.pricing': 'Precios',
      'nav.faq': 'Preguntas',
      'nav.login': 'Entrar',
      'nav.open_demo': 'Ver demo',

      'hero.badge_lead': 'Pedidos con código QR y pantalla de cocina en vivo',
      'hero.badge_price': '$49 Licencia de por vida',
      'hero.title_p1': 'Tus clientes piden desde su móvil.',
      'hero.title_accent': 'Tu cocina prepara sin esperas.',
      'hero.lead': 'TableTap convierte la cámara de cualquier teléfono en un canal de pedidos instantáneo. Los comensales escanean el código QR de su mesa, eligen del menú y piden. Las comandas suenan al instante en la cocina sin apps ni comisiones.',
      'hero.pillar1_title': 'Sin descargar apps',
      'hero.pillar1_desc': 'Abre en 0.8s en Safari o Chrome',
      'hero.pillar2_title': 'Aviso sonoro en cocina',
      'hero.pillar2_desc': 'Comandas en tiempo real en cualquier tablet',
      'hero.pillar3_title': 'Cero comisiones',
      'hero.pillar3_desc': 'Pago único de $49. El 100% de las ventas es tuyo',
      'hero.btn_guest_demo': 'Probar menú de comensal (Mesa 7)',
      'hero.btn_kitchen': 'Ver pantalla de cocina',
      'hero.btn_how': 'Cómo funciona',

      'preview.badge': 'Experiencia del comensal',
      'preview.title': 'Lo que ven tus clientes al escanear',
      'preview.sub': 'Sin descargar aplicaciones ni registrarse. En menos de un segundo, tienen tu menú completo con la mesa ya asignada.',
      'preview.call_waiter': 'Llamar camarero',
      'preview.request_bill': 'Pedir la cuenta',
      'preview.all': 'Todo',
      'preview.add': 'Añadir',
      'preview.sold_out': 'Agotado',
      'preview.view_order': 'Ver pedido',

      'menu.open_now': 'Abierto ahora',
      'menu.call_waiter_btn': 'Llamar camarero',
      'menu.ask_bill_btn': 'Pedir la cuenta',
      'menu.search_ph': 'Buscar platos...',
      'kitchen.title': 'Pantalla de Cocina',
      'kitchen.stoplist': 'Lista de agotados (86)',
      'kitchen.tab_new': 'Nuevos',
      'kitchen.tab_prep': 'En marcha',
      'kitchen.tab_ready': 'Listos',
      'lang.select': 'Idioma',
      'lang.auto': 'Auto (Ubicación)'
    },

    // ------------------------------------------------------------------------
    // GERMAN (Deutsch)
    // ------------------------------------------------------------------------
    de: {
      'nav.how_it_works': 'Funktionsweise',
      'nav.guest_menu': 'Gäste-Menü',
      'nav.features': 'Funktionen',
      'nav.pricing': 'Preise',
      'nav.faq': 'FAQ',
      'nav.login': 'Anmelden',
      'nav.open_demo': 'Demo testen',

      'hero.badge_lead': 'Kontaktlose QR-Bestellung & Live-Küchenmonitor',
      'hero.badge_price': '$49 Einmalig lebenslang',
      'hero.title_p1': 'Gäste scannen den Tisch-QR.',
      'hero.title_accent': 'Ihre Küche kocht ohne Wartezeit.',
      'hero.lead': 'TableTap verwandelt jede Handykamera in ein Bestellsystem. Gäste scannen den QR-Code am Tisch, wählen Speisen und bestellen direkt im Browser. Bons erscheinen sofort auf dem Küchen-Tablet.',
      'hero.pillar1_title': 'Keine App nötig',
      'hero.pillar1_desc': 'Öffnet in 0,8 s in Safari & Chrome',
      'hero.pillar2_title': 'Sofortiges Küchensignal',
      'hero.pillar2_desc': 'Bons erscheinen in Echtzeit auf jedem Tablet',
      'hero.pillar3_title': 'Null Provisionen',
      'hero.pillar3_desc': 'Einmalig $49. 100% Ihres Umsatzes bleibt bei Ihnen',
      'hero.btn_guest_demo': 'Gäste-Menü testen (Tisch 7)',
      'hero.btn_kitchen': 'Küchen-Monitor öffnen',
      'hero.btn_how': 'Mehr erfahren',

      'preview.badge': 'Echtes Gästeerlebnis',
      'preview.title': 'Was Ihre Gäste beim Scannen sehen',
      'preview.sub': 'Keine App-Downloads, keine Registrierung. In Sekundenbruchteilen öffnet sich die Speisekarte mit fest hinterlegter Tischnummer.',
      'preview.call_waiter': 'Kellner rufen',
      'preview.request_bill': 'Rechnung anfordern',
      'preview.all': 'Alle',
      'preview.add': 'Hinzufügen',
      'preview.sold_out': 'Ausverkauft',
      'preview.view_order': 'Bestellung ansehen',

      'menu.open_now': 'Jetzt geöffnet',
      'menu.call_waiter_btn': 'Kellner rufen',
      'menu.ask_bill_btn': 'Rechnung anfordern',
      'menu.search_ph': 'Gerichte suchen...',
      'kitchen.title': 'Küchenmonitor',
      'kitchen.stoplist': 'Stoppliste (86)',
      'kitchen.tab_new': 'Neu',
      'kitchen.tab_prep': 'In Zubereitung',
      'kitchen.tab_ready': 'Fertig',
      'lang.select': 'Sprache',
      'lang.auto': 'Auto (Standort)'
    },

    // ------------------------------------------------------------------------
    // FRENCH (Français)
    // ------------------------------------------------------------------------
    fr: {
      'nav.how_it_works': 'Comment ça marche',
      'nav.guest_menu': 'Menu client',
      'nav.features': 'Fonctionnalités',
      'nav.pricing': 'Tarifs',
      'nav.faq': 'FAQ',
      'nav.login': 'Connexion',
      'nav.open_demo': 'Ouvrir la démo',

      'hero.badge_lead': 'Commande QR à table & Écran de cuisine en direct',
      'hero.badge_price': '$49 À vie sans abonnement',
      'hero.title_p1': 'Les clients scannent le QR à table.',
      'hero.title_accent': 'Votre cuisine prépare sans attente.',
      'hero.lead': 'TableTap transforme tout smartphone en borne de commande. Les clients scannent le QR code de leur table, parcourent le menu et commandent directement dans leur navigateur. Le ticket apparaît instantanément en cuisine.',
      'hero.pillar1_title': 'Zéro application à télécharger',
      'hero.pillar1_desc': 'S\'ouvre en 0,8s sur Safari et Chrome',
      'hero.pillar2_title': 'Signal sonore en cuisine',
      'hero.pillar2_desc': 'Les tickets s\'affichent en temps réel sur tablette',
      'hero.pillar3_title': '0% de commission',
      'hero.pillar3_desc': 'Prix unique de $49. Conservez 100% de vos recettes',
      'hero.btn_guest_demo': 'Essayer le menu client (Table 7)',
      'hero.btn_kitchen': 'Voir l\'écran de cuisine',
      'hero.btn_how': 'Comment ça marche',

      'preview.badge': 'Expérience client réelle',
      'preview.title': 'Ce que vos clients voient en scannant',
      'preview.sub': 'Pas d\'application à installer, pas d\'inscription. En moins d\'une seconde, ils ont votre menu complet avec leur numéro de table.',
      'preview.call_waiter': 'Appeler le serveur',
      'preview.request_bill': 'Demander l\'addition',
      'preview.all': 'Tous',
      'preview.add': 'Ajouter',
      'preview.sold_out': 'Épuisé',
      'preview.view_order': 'Voir la commande',

      'menu.open_now': 'Ouvert actuellement',
      'menu.call_waiter_btn': 'Appeler le serveur',
      'menu.ask_bill_btn': 'Demander l\'addition',
      'menu.search_ph': 'Rechercher un plat...',
      'kitchen.title': 'Écran de Cuisine',
      'kitchen.stoplist': 'Articles épuisés (86)',
      'kitchen.tab_new': 'Nouveaux',
      'kitchen.tab_prep': 'En préparation',
      'kitchen.tab_ready': 'Prêts',
      'lang.select': 'Langue',
      'lang.auto': 'Auto (Localisation)'
    }
  };

  /**
   * Determine user language based on:
   * 1. URL param: ?lang=ru or ?country=RU
   * 2. localStorage saved choice (if manual)
   * 3. Server-detected / Geo-IP Country
   *    - RU, BY, KZ, KG -> Russian (ru)
   *    - UA -> Ukrainian (uk)
   *    - IN -> English (en) [Explicit requirement]
   *    - ES / Latin America -> Spanish (es)
   *    - DE / AT / CH -> German (de)
   *    - FR / BE -> French (fr)
   * 4. navigator.language
   * 5. Fallback: en
   */
  let currentLang = 'en';
  let detectedCountry = '';

  function mapCountryToLang(countryCode) {
    if (!countryCode) return null;
    const c = countryCode.toUpperCase().trim();

    // STRICT USER REQUIREMENT: India will be in English only
    if (c === 'IN') return 'en';

    // Russian speaking countries
    if (['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ'].includes(c)) return 'ru';

    // Ukraine
    if (c === 'UA') return 'uk';

    // Spanish speaking countries
    if (['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY'].includes(c)) return 'es';

    // German speaking countries
    if (['DE', 'AT', 'CH'].includes(c)) return 'de';

    // French speaking countries
    if (['FR', 'BE', 'MC', 'LU'].includes(c)) return 'fr';

    return null;
  }

  function mapBrowserToLang() {
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
    if (nav.startsWith('uk')) return 'uk';
    if (nav.startsWith('es')) return 'es';
    if (nav.startsWith('de')) return 'de';
    if (nav.startsWith('fr')) return 'fr';
    return 'en';
  }

  async function detectLocationCountry() {
    // 1. Check URL override ?country=RU or ?country=IN
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('country')) {
        return sp.get('country').toUpperCase();
      }
    } catch (_) {}

    // 2. Query our own /api/geo endpoint
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 1800);
      const res = await fetch('/api/geo', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data.country) {
          return data.country.toUpperCase();
        }
      }
    } catch (_) {}

    // 3. Fallback to free public IP geolocation with fast timeout
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('https://get.geojs.io/v1/ip/country.json', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data.country) {
          return data.country.toUpperCase();
        }
      }
    } catch (_) {}

    return '';
  }

  function t(key, fallback) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    if (dict[key]) return dict[key];
    const enDict = TRANSLATIONS.en;
    if (enDict[key]) return enDict[key];
    return fallback || key;
  }

  function applyTranslations(root) {
    const container = root || document;

    // Text content
    container.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val) {
        // preserve icons or child elements if marked data-i18n-preserve
        if (el.hasAttribute('data-i18n-html')) {
          el.innerHTML = val;
        } else {
          el.textContent = val;
        }
      }
    });

    // Placeholders
    container.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val) el.setAttribute('placeholder', val);
    });

    // Titles
    container.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const val = t(key);
      if (val) el.setAttribute('title', val);
    });

    // Aria labels
    container.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key);
      if (val) el.setAttribute('aria-label', val);
    });

    // Update document HTML lang attribute
    document.documentElement.setAttribute('lang', currentLang);
    document.documentElement.setAttribute('dir', SUPPORTED_LANGS[currentLang]?.dir || 'ltr');
  }

  function setLanguage(lang, isManual = true) {
    if (!SUPPORTED_LANGS[lang]) lang = 'en';
    currentLang = lang;
    if (isManual) {
      try {
        localStorage.setItem('tabletap_lang', lang);
      } catch (_) {}
    }

    applyTranslations();
    updateSwitcherUI();

    // Fire global event so pages like customer.js or kitchen.js can refresh dynamic lists
    try {
      window.dispatchEvent(new CustomEvent('tabletap:langchange', { detail: { lang, country: detectedCountry } }));
    } catch (_) {}
  }

  function updateSwitcherUI() {
    document.querySelectorAll('.lang-switcher-select').forEach((sel) => {
      sel.value = currentLang;
    });

    document.querySelectorAll('.lang-switcher-btn').forEach((btn) => {
      const info = SUPPORTED_LANGS[currentLang] || SUPPORTED_LANGS.en;
      btn.innerHTML = `<span class="lang-flag">${info.flag}</span> <span class="lang-code">${currentLang.toUpperCase()}</span>`;
    });
  }

  function renderSwitcher() {
    // Generate markup for a language switcher widget
    const optionsHtml = Object.keys(SUPPORTED_LANGS).map((code) => {
      const item = SUPPORTED_LANGS[code];
      const sel = code === currentLang ? 'selected' : '';
      return `<option value="${code}" ${sel}>${item.flag} ${item.name}</option>`;
    }).join('');

    return `
      <div class="lang-picker" title="${t('lang.select')}">
        <label for="lang-select-global" class="sr-only">${t('lang.select')}</label>
        <span class="lang-picker__icon" aria-hidden="true"><i data-lucide="globe"></i></span>
        <select id="lang-select-global" class="lang-switcher-select" aria-label="${t('lang.select')}">
          ${optionsHtml}
        </select>
      </div>
    `;
  }

  async function init() {
    // 1. Check URL param ?lang=ru
    let chosenLang = null;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has('lang') && SUPPORTED_LANGS[sp.get('lang')]) {
        chosenLang = sp.get('lang');
        localStorage.setItem('tabletap_lang', chosenLang);
      }
    } catch (_) {}

    // 2. Check localStorage saved choice
    if (!chosenLang) {
      try {
        const saved = localStorage.getItem('tabletap_lang');
        if (saved && SUPPORTED_LANGS[saved]) {
          chosenLang = saved;
        }
      } catch (_) {}
    }

    // 3. Location / Geo detection if no manual choice was previously locked
    if (!chosenLang) {
      detectedCountry = await detectLocationCountry();
      const countryLang = mapCountryToLang(detectedCountry);
      if (countryLang) {
        chosenLang = countryLang;
      } else {
        chosenLang = mapBrowserToLang();
      }
    }

    currentLang = chosenLang || 'en';
    setLanguage(currentLang, false);

    // Bind any language selectors on the page
    document.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('lang-switcher-select')) {
        setLanguage(e.target.value, true);
      }
    });

    // Re-create icons if Lucide is loaded
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  const DISH_TRANSLATIONS = {
    ru: {
      'Crispy halloumi': 'Хрустящий сыр халуми',
      'Charred octopus': 'Осьминог на гриле',
      'Margherita': 'Пицца Маргарита',
      'Margherita Pizza': 'Пицца Маргарита',
      'House lemonade': 'Домашний лимонад',
      'House Lemonade': 'Домашний лимонад',
      'Slow-braised lamb shoulder': 'Томлёная лопатка ягнёнка',
      'Slow-braised Lamb Shoulder': 'Томлёная лопатка ягнёнка',
      'Baklava cheesecake': 'Чизкейк Пахлава',
      'Baklava Cheesecake': 'Чизкейк Пахлава',
      'Olive oil cake': 'Кекс на оливковом масле',
      'Dark chocolate tart': 'Тарт из тёмного шоколада',
      'Lemon sorbet': 'Лимонный сорбет',
      'Charcoal chicken': 'Цыплёнок на углях',
      'Olive Table burger': 'Бургер Olive Table',
      'Olive & anchovy': 'Пицца с оливками и анчоусами',
      'Truffle mushroom': 'Пицца с трюфелем и грибами',
      'Spicy nduja': 'Пицца со сладко-острой ндуйей',
      'Cold brew': 'Колд брю кофе',
      'Greek frappé': 'Греческий фраппе',
      'Olive leaf spritz': 'Оливковый спритц',
      'Mint & cucumber cooler': 'Огуречно-мятный кулер',
      'Warm olive & rosemary bread': 'Тёплый хлеб с оливками и розмарином',
      'Whipped feta & honey': 'Взбитая фета с мёдом',
      'Crispy calamari': 'Хрустящие кальмары',
      'Pan-seared sea bass': 'Сибас на гриле',
      'Wild mushroom risotto': 'Ризотто с лесными грибами',
      'starters': 'Закуски',
      'mains': 'Основные блюда',
      'pizza': 'Пицца',
      'desserts': 'Десерты',
      'drinks': 'Напитки',
      'Starters': 'Закуски',
      'Mains': 'Основные блюда',
      'Pizza': 'Пицца',
      'Desserts': 'Десерты',
      'Drinks': 'Напитки',
      'Veg': 'Вег',
      'Vegan': 'Веган',
      'Spicy': 'Острое',
      'Gluten-free': 'Без глютена'
    },
    uk: {
      'Crispy halloumi': 'Хрусткий сир халумі',
      'Charred octopus': 'Восьминіг на грилі',
      'Margherita': 'Піца Маргарита',
      'Margherita Pizza': 'Піца Маргарита',
      'House lemonade': 'Домашній лимонад',
      'House Lemonade': 'Домашній лимонад',
      'Slow-braised lamb shoulder': 'Томлена лопатка ягняти',
      'Slow-braised Lamb Shoulder': 'Томлена лопатка ягняти',
      'Baklava cheesecake': 'Чизкейк Пахлава',
      'Baklava Cheesecake': 'Чизкейк Пахлава',
      'Olive oil cake': 'Пиріг на оливковій олії',
      'Dark chocolate tart': 'Тарт із темного шоколаду',
      'Lemon sorbet': 'Лимонний сорбет',
      'Charcoal chicken': 'Курча на вугіллі',
      'Olive Table burger': 'Бургер Olive Table',
      'Olive & anchovy': 'Піца з оливками та анчоусами',
      'Truffle mushroom': 'Піца з трюфелем та грибами',
      'Spicy nduja': 'Піца з гострою ндуєю',
      'Cold brew': 'Колд брю кава',
      'Greek frappé': 'Грецький фрапе',
      'Olive leaf spritz': 'Оливковий шприц',
      'Mint & cucumber cooler': 'Огірково-м\'ятний кулер',
      'Warm olive & rosemary bread': 'Теплий хліб з оливками та розмарином',
      'Whipped feta & honey': 'Збита фета з медом',
      'Crispy calamari': 'Хрусткі кальмари',
      'Pan-seared sea bass': 'Сібас на грилі',
      'Wild mushroom risotto': 'Різотто з лісовими грибами',
      'starters': 'Закуски',
      'mains': 'Основні страви',
      'pizza': 'Піца',
      'desserts': 'Десерти',
      'drinks': 'Напої',
      'Starters': 'Закуски',
      'Mains': 'Основні страви',
      'Pizza': 'Піца',
      'Desserts': 'Десерти',
      'Drinks': 'Напої',
      'Veg': 'Вег',
      'Vegan': 'Веган',
      'Spicy': 'Гостре',
      'Gluten-free': 'Без глютену'
    }
  };

  function translateDish(name) {
    if (!name) return '';
    const langDict = DISH_TRANSLATIONS[currentLang];
    if (langDict && langDict[name]) return langDict[name];
    return name;
  }

  // Export to window
  window.TableTapI18n = {
    t,
    setLanguage,
    translateDish,
    getLanguage: () => currentLang,
    getCountry: () => detectedCountry,
    applyTranslations,
    renderSwitcher,
    SUPPORTED_LANGS,
    TRANSLATIONS
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
