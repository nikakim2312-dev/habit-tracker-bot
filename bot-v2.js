

// Трекер привычек — облегчённая версия для Replit
// Хранит данные в JSON файле (без SQLite)
// Все пуши — простой текст, без Markdown

import { Bot } from 'grammy';
import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ---------- Config ----------
const TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = 'data.json';

// Умный выбор URL для Mini App:
// 1) если задана MINIAPP_URL — используем её
// 2) если задана WEBAPP_URL и она НЕ указывает на наш же хост — используем
// 3) иначе — дефолт
const DEFAULT_MINIAPP = 'https://hqle67kztydxq.space.minimax.io';
const SELF_HOST = process.env.RENDER_EXTERNAL_URL || process.env.KOYEB_PUBLIC_URL || `http://localhost:${PORT}`;
function getMiniAppUrl() {
  if (process.env.MINIAPP_URL) return process.env.MINIAPP_URL;
  const w = process.env.WEBAPP_URL;
  if (w) {
    try {
      const wh = new URL(w).hostname;
      const sh = new URL(SELF_HOST).hostname;
      if (wh !== sh) return w;
    } catch (e) { return w; }
  }
  return DEFAULT_MINIAPP;
}
const WEBAPP_URL = getMiniAppUrl();

if (!TOKEN) { console.error('Set BOT_TOKEN env var'); process.exit(1); }

const bot = new Bot(TOKEN);

// Rate limit
const rateLimit = new Map();
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    const now = Date.now();
    const arr = (rateLimit.get(ctx.from.id) || []).filter(t => now - t < 1000);
    arr.push(now);
    rateLimit.set(ctx.from.id, arr);
    if (arr.length > 5) return;
  }
  return next();
});

// ---------- JSON DB ----------
let db = { users: {}, habits: {}, checks: {}, challenges: {}, achievements: {}, events: [], notes: {}, goals: {}, thanks: {}, rewards: {}, pomodoros: {}, reminders: {}, silent: {}, tags: {} };

// Категории
const TAGS = {
  health: { name: 'Здоровье', emoji: '💪', color: '#38b000' },
  mind:   { name: 'Ментальное', emoji: '🧘', color: '#7f5af0' },
  work:   { name: 'Работа', emoji: '💼', color: '#ff8906' },
  learn:  { name: 'Учёба', emoji: '🎓', color: '#2cb1bc' },
  sport:  { name: 'Спорт', emoji: '🏃', color: '#f25f4c' },
  food:   { name: 'Питание', emoji: '🥗', color: '#52b788' },
  sleep:  { name: 'Сон', emoji: '😴', color: '#6366f1' },
  social: { name: 'Общение', emoji: '👥', color: '#ff5d8f' },
};

async function loadDB() {
  try {
    if (existsSync(DATA_FILE)) {
      const data = await fs.readFile(DATA_FILE, 'utf8');
      db = JSON.parse(data);
    }
  } catch (e) {
    console.error('loadDB:', e.message);
  }
  // Защита от битой структуры
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!db.habits || typeof db.habits !== 'object') db.habits = {};
  if (!db.challenges || typeof db.challenges !== 'object') db.challenges = {};
  if (!db.checks || typeof db.checks !== 'object') db.checks = {};
  if (!db.achievements || typeof db.achievements !== 'object') db.achievements = {};
  if (!db._pomodoros_count || typeof db._pomodoros_count !== 'object') db._pomodoros_count = {};
  // Дополнить дефолтами существующих юзеров
  for (const tgId of Object.keys(db.users)) {
    const u = db.users[tgId];
    if (typeof u.palette !== 'string') u.palette = 'sunset';
    if (typeof u.reminder_time !== 'string') u.reminder_time = '09:00';
    if (typeof u.total_checks !== 'number') u.total_checks = 0;
    if (typeof u.best_streak !== 'number') u.best_streak = 0;
    if (typeof u.onboard_step !== 'number') u.onboard_step = 0;
  }
}
let saveTimer = null;
function saveDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error('saveDB:', e.message); }
  }, 1000);
}

// Helpers
function getUser(tgId) {
  if (!db.users[tgId]) {
    db.users[tgId] = {
      tg_id: tgId, name: 'друг', emoji: '🙂', palette: 'sunset',
      onboard_step: 0, best_streak: 0, total_checks: 0,
      reminder_time: '09:00', last_seen_at: 0, last_check_day: null,
    };
  }
  return db.users[tgId];
}
function getHabits(tgId) {
  return Object.values(db.habits).filter(h => h.owner_id === tgId);
}
function getHabit(id, tgId) {
  const h = db.habits[id];
  if (h && h.owner_id === tgId) return h;
  return null;
}
function checkKey(habitId, day) { return `${habitId}::${day}`; }
function isChecked(habitId, day) { return !!db.checks[checkKey(habitId, day)]; }
function setCheck(habitId, day, on) {
  if (on) db.checks[checkKey(habitId, day)] = true;
  else delete db.checks[checkKey(habitId, day)];
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const uid = () => randomBytes(6).toString('hex');

// ---------- Push Library (text only) ----------
const PUSH = {
  morning: [
    { text: n => `${n}, доброе утро.\n\nВчера ты была лучше, чем неделю назад. Не теряй темп.`, btn: 'Отметить' },
    { text: n => `Утро, ${n}.\n\nНовый день — новый шанс не сорваться. Погнали.`, btn: 'Я готов' },
    { text: n => `Сонный, ${n}?\n\nЛучшее время для привычек — прямо сейчас. Через 2 минуты ты в потоке.`, btn: 'Начать' },
    { text: n => `Ку-ка-ре-ку, ${n}.\n\nВставай. Мир не построит себя сам. Начни с воды.`, btn: 'Стакан воды' },
    { text: n => `${n}, кофе в руку, жизнь в ритм.\n\nИ 30 секунд на привычки. Утро решает день.`, btn: 'Погнали' },
    { text: n => `Подъём, ${n}.\n\nКровать не уйдёт. А вот серия — может.`, btn: 'Не упустить' },
  ],
  day: [
    { text: n => `${n}, перерыв.\n\nПара минут на отметку — и обратно к делам. Согласен?`, btn: 'Отметить' },
    { text: n => `Уже середина дня, ${n}.\n\nПоловина прошла. Если ещё не отметил(а) — самое время.`, btn: 'Сейчас' },
    { text: n => `Обед, ${n}.\n\nПрежде чем есть — отметь. Принцип простой: сначала долг, потом булка.`, btn: 'Отметить' },
    { text: n => `${n}, ты же не на работе для работы.\n\nТы здесь, чтобы быть лучше. Один тап.`, btn: 'Тап' },
  ],
  evening: [
    { text: n => `${n}, вечер близко.\n\nЕсли ещё не отметил(а) — окно закрывается. Не упусти.`, btn: 'Отметить' },
    { text: n => `${n}, у тебя 30 минут.\n\nЧерез час уже поздно. Лучше сделать сейчас.`, btn: 'Го' },
    { text: n => `${n}, прежде чем сериал — привычки.\n\n30 секунд. Потом Netflix. Без дедлайна.`, btn: 'Отметить' },
    { text: n => `${n}, ужин готовишь?\n\nПока ждёшь — отметь. Пять минут — и серия в кармане.`, btn: 'Сейчас' },
  ],
  night: [
    { text: n => `${n}, последний шанс.\n\nЧерез час уже ночь. Серия сгорит?`, btn: 'Спасти серию' },
    { text: n => `Спать? Сначала — отметка.\n\n30 секунд. Это легче, чем завтра жалеть.`, btn: 'Отметить' },
    { text: n => `${n}, полуночник.\n\nОдин тап — и серия в безопасности до завтра.`, btn: 'Тап' },
    { text: n => `${n}, всё спит. Кроме твоей серии.\n\nУспей, пока огонь не погас.`, btn: 'Спасти' },
    { text: n => `${n}, звезды уже считают твою серию.\n\nНе дай им сбиться. Отметь.`, btn: 'Тап' },
  ],
  bold: [
    { text: n => `${n}, ну что, опять?\n\nЯ верю в тебя. Но ты сама себе — верю больше.`, btn: 'Один тап' },
    { text: n => `${n}, или сегодня — опять "завтра"?\n\nТы знаешь правильный ответ.`, btn: 'Сейчас' },
    { text: n => `${n}, странно.\n\nТы начала с энтузиазмом. А сейчас... что?`, btn: 'Собраться' },
    { text: n => `${n}, ну посмотри на себя.\n\nТакая умная, такая сильная — и не может один тап сделать?`, btn: 'Могу' },
    { text: n => `${n}, бой с самим собой.\n\nТы уже победила раз десять. Одиннадцатый — легко.`, btn: 'Победа' },
  ],
  praise_today: [
    { text: n => `${n}, ты уже отметила сегодня.\n\nПосмотри на это дерево. Это — твоя работа.`, btn: 'Смотреть' },
    { text: n => `${n}, идеально.\n\nВсе привычки отмечены. Ты в огне.`, btn: 'Красавчик' },
  ],
  comeback: [
    { text: n => `${n}, всё ок.\n\nБывает. Главное — вернуться. Погнали?`, btn: 'Вернуться' },
    { text: n => `${n}, ещё не всё потеряно.\n\nПропустила день — не страшно. Сегодня можно начать заново.`, btn: 'Начать' },
  ],
  long_away: [
    { text: n => `${n}, мы соскучились.\n\nТы была на паузе. Всё ок — возвращайся, дерево ждёт.`, btn: 'Вернуться' },
    { text: n => `${n}, никаких упрёков.\n\nЖизнь есть жизнь. Готова вернуться?`, btn: 'Продолжить' },
  ],
};
const PALETTES = [
  { id: 'sunset', label: 'Закат' },
  { id: 'ocean', label: 'Океан' },
  { id: 'forest', label: 'Лес' },
  { id: 'sakura', label: 'Сакура' },
  { id: 'midnight', label: 'Полночь' },
  { id: 'peach', label: 'Персик' },
  { id: 'cyber', label: 'Кибер' },
  { id: 'mono', label: 'Моно' },
];
const REMINDER = {
  'А': { label: '08:00 Утро', value: '08:00' },
  'Б': { label: '13:00 День', value: '13:00' },
  'В': { label: '19:00 Вечер', value: '19:00' },
  'Г': { label: '22:00 Поздно', value: '22:00' },
  'Д': { label: 'Без напоминаний', value: 'off' },
};
const CHALLENGES = [
  // ===== 21 день (привычка формируется) =====
  {
    id: 'water21',
    title: '21 день воды',
    emoji: '💧',
    shortDesc: 'Стакан воды утром и вечером',
    desc: '21 день — привычка формируется. Стакан воды сразу после пробуждения и стакан перед сном. Простое начало длинного пути.',
    days: 21,
    color: '#4a8fe7',
    habitName: 'Вода утро/вечер',
    habitEmoji: '💧',
    habitFreq: 'Каждый день',
  },
  {
    id: 'walk21',
    title: '21 день прогулок',
    emoji: '🚶',
    shortDesc: '30 минут на воздухе',
    desc: '21 день — формируем привычку. 30 минут прогулки на свежем воздухе в любую погоду. Без телефона, просто шаги.',
    days: 21,
    color: '#52b788',
    habitName: 'Прогулка 30 мин',
    habitEmoji: '🚶',
    habitFreq: 'Каждый день',
  },
  {
    id: 'no_phone21',
    title: '21 день без телефона',
    emoji: '📵',
    shortDesc: 'Час без экрана до сна',
    desc: '21 день без телефона за час до сна. Откладывай смартфон в 22:00. Лучше сон, меньше тревоги, больше энергии утром.',
    days: 21,
    color: '#6366f1',
    habitName: 'Без телефона вечером',
    habitEmoji: '📵',
    habitFreq: 'Каждый день',
  },

  // ===== 30 дней (закрепление) =====
  {
    id: 'meditate30',
    title: '30 дней тишины',
    emoji: '🧘',
    shortDesc: '10 минут медитации',
    desc: '30 дней медитации по 10 минут утром. Меньше тревоги, яснее мысли, ровнее эмоции. К концу — ты другой человек.',
    days: 30,
    color: '#c060a1',
    habitName: 'Медитация 10 мин',
    habitEmoji: '🧘',
    habitFreq: 'Каждый день',
  },
  {
    id: 'read30',
    title: '30 дней чтения',
    emoji: '📖',
    shortDesc: '20 минут книги',
    desc: '30 дней по 20 минут чтения настоящей книги. Не новости, не соцсети. Одна книга за месяц — и мозг работает иначе.',
    days: 30,
    color: '#ff8906',
    habitName: 'Чтение 20 мин',
    habitEmoji: '📖',
    habitFreq: 'Каждый день',
  },
  {
    id: 'sport30',
    title: '30 дней спорта',
    emoji: '🏃',
    shortDesc: 'Любая активность 20 мин',
    desc: '30 дней по 20 минут любой активности. Бег, зал, йога, растяжка, велосипед. Главное — каждый день, без пропусков.',
    days: 30,
    color: '#38b000',
    habitName: 'Спорт 20 мин',
    habitEmoji: '🏃',
    habitFreq: 'Каждый день',
  },
  {
    id: 'early30',
    title: '30 дней ранних подъёмов',
    emoji: '🌅',
    shortDesc: 'Вставать в 6:00–7:00',
    desc: '30 дней вставать в 6:00–7:00 утра без snooze. Утро принадлежит тебе, а не ленте новостей. 2 часа до работы — на себя.',
    days: 30,
    color: '#f59e0b',
    habitName: 'Подъём в 6–7',
    habitEmoji: '🌅',
    habitFreq: 'Каждый день',
  },

  // ===== 50 дней (глубокое закрепление) =====
  {
    id: 'sport50',
    title: '50 дней силы',
    emoji: '💪',
    shortDesc: 'Спорт 30 мин через день',
    desc: '50 дней тренировок через день. 30+ минут кардио или силовой. К концу — минус 3-5 кг и совершенно другой уровень энергии.',
    days: 50,
    color: '#2e7d32',
    habitName: 'Спорт 30 мин',
    habitEmoji: '💪',
    habitFreq: 'Каждые 2 дня',
  },
  {
    id: 'water50',
    title: '50 дней гидратации',
    emoji: '💧',
    shortDesc: '2 литра воды в день',
    desc: '50 дней подряд по 2 литра чистой воды ежедневно. Кожа, волосы, концентрация, пищеварение. Без газировки и сока.',
    days: 50,
    color: '#1976d2',
    habitName: '2 литра воды',
    habitEmoji: '💧',
    habitFreq: 'Каждый день',
  },

  // ===== 75 дней (сложный уровень) =====
  {
    id: 'sport75',
    title: '75 дней силы',
    emoji: '💪',
    shortDesc: 'Спорт каждые 2 дня',
    desc: '75 сложных дней. Тренировка через день — кардио, силовая или растяжка по 30-40 минут. К концу ты в лучшей форме в жизни.',
    days: 75,
    color: '#38b000',
    habitName: 'Спорт 40 мин',
    habitEmoji: '🏃',
    habitFreq: 'Каждые 2 дня',
  },
  {
    id: 'sleep75',
    title: '75 дней сна',
    emoji: '😴',
    shortDesc: 'Ложиться до 23:00',
    desc: '75 сложных дней. Сон до 23:00 каждый день, 7-8 часов. Утром вставать бодрым. Без ночных сериалов и скроллинга.',
    days: 75,
    color: '#7f5af0',
    habitName: 'Сон до 23',
    habitEmoji: '😴',
    habitFreq: 'Каждый день',
  },
  {
    id: 'nofap75',
    title: '75 дней без',
    emoji: '🚫',
    shortDesc: 'Отказ от вредной привычки',
    desc: '75 сложных дней. Полный отказ от одной вредной привычки: сладкое, фастфуд, соцсети, алкоголь. Выбери свою. Каждый день.',
    days: 75,
    color: '#e63946',
    habitName: 'Без вредного',
    habitEmoji: '🚫',
    habitFreq: 'Каждый день',
  },
  {
    id: 'read75',
    title: '75 дней чтения',
    emoji: '📖',
    shortDesc: '30 минут книги ежедневно',
    desc: '75 сложных дней. 30 минут чтения настоящей книги каждый день. К концу — 3-4 прочитанных книги и новое мышление.',
    days: 75,
    color: '#ff8906',
    habitName: 'Чтение 30 мин',
    habitEmoji: '📖',
    habitFreq: 'Каждый день',
  },
  {
    id: 'meditate75',
    title: '75 дней тишины',
    emoji: '🧘',
    shortDesc: '20 минут медитации',
    desc: '75 сложных дней. 20 минут медитации или тишины ежедневно. Утром или перед сном. Меньше тревоги, больше фокуса.',
    days: 75,
    color: '#c060a1',
    habitName: 'Медитация 20 мин',
    habitEmoji: '🧘',
    habitFreq: 'Каждый день',
  },
  {
    id: 'walk75',
    title: '75 дней шагов',
    emoji: '🚶',
    shortDesc: '10 000 шагов ежедневно',
    desc: '75 сложных дней. 10 000 шагов каждый день без исключений. В любую погоду. Тело и голова скажут спасибо.',
    days: 75,
    color: '#2cb1bc',
    habitName: '10 000 шагов',
    habitEmoji: '🚶',
    habitFreq: 'Каждый день',
  },

  // ===== 100 дней (длинная дистанция) =====
  {
    id: 'sport100',
    title: '100 дней трансформации',
    emoji: '🏆',
    shortDesc: 'Спорт каждый день',
    desc: '100 дней — серьёзное испытание. Тренировка КАЖДЫЙ день без исключений. 30-60 минут. К концу — новое тело и железная дисциплина.',
    days: 100,
    color: '#d97706',
    habitName: 'Спорт каждый день',
    habitEmoji: '🏆',
    habitFreq: 'Каждый день',
  },
  {
    id: 'mind100',
    title: '100 дней ясности',
    emoji: '🧠',
    shortDesc: 'Медитация + дневник',
    desc: '100 дней ментальной практики. 15 минут медитации утром и 5 минут вечером. Запись мыслей перед сном. К концу — кристальная ясность.',
    days: 100,
    color: '#7c3aed',
    selectable: true,
    habits: [
      { name: 'Медитация 15 мин', emoji: '🧘', freq: 'Каждый день' },
      { name: 'Дневник мыслей', emoji: '📓', freq: 'Каждый вечер' },
    ],
  },
  {
    id: 'clean100',
    title: '100 дней чистоты',
    emoji: '✨',
    shortDesc: 'Без сахара и фастфуда',
    desc: '100 дней без добавленного сахара, фастфуда, газировки. Только натуральная еда, вода, фрукты. К концу — минус 5-8 кг и сияющая кожа.',
    days: 100,
    color: '#16a34a',
    habitName: 'Без сахара',
    habitEmoji: '✨',
    habitFreq: 'Каждый день',
  },

  // ===== 365 дней (год трансформации) =====
  {
    id: 'year_walk',
    title: '365 дней шагов',
    emoji: '🚶‍♀️',
    shortDesc: '10 000 шагов весь год',
    desc: '365 дней без единого пропуска. 10 000 шагов каждый день, в отпуске, в болезни, в дождь. Это год, который изменит тело навсегда.',
    days: 365,
    color: '#0d9488',
    habitName: '10 000 шагов',
    habitEmoji: '🚶‍♀️',
    habitFreq: 'Каждый день',
  },
  {
    id: 'year_read',
    title: '365 дней книголюба',
    emoji: '📚',
    shortDesc: '20 минут чтения весь год',
    desc: '365 дней чтения. 20 минут в день — это 12-15 книг за год. Другое мышление, другая речь, другие решения. Через год ты не узнаешь себя.',
    days: 365,
    color: '#ea580c',
    habitName: 'Чтение 20 мин',
    habitEmoji: '📚',
    habitFreq: 'Каждый день',
  },

  // ===== СВЯЗКА: Эффективная работа =====
  {
    id: 'work_eff',
    title: 'Челлендж эффективной работы',
    emoji: '💼',
    shortDesc: '4 привычки для продуктивности',
    desc: 'Полный арсенал продуктивного человека. 4 привычки работают вместе: утренний фокус → главная задача → блок без отвлечений → вечерняя ревизия. 30 дней — и ты работаешь иначе. Выбирай привычки, которые подходят тебе.',
    days: 30,
    color: '#0ea5e9',
    habits: [
      { name: 'Фокус-старт (10 мин планирования утром)', emoji: '🎯', freq: 'Каждый день' },
      { name: 'Главная задача дня', emoji: '✓', freq: 'Каждый день' },
      { name: 'Блок 50 мин без отвлечений', emoji: '🔕', freq: 'Каждый день' },
      { name: 'Вечерняя ревизия дня', emoji: '📝', freq: 'Каждый вечер' },
    ],
    selectable: true,
  },
  {
    id: 'work_deep',
    title: '30 дней глубокой работы',
    emoji: '🧠',
    shortDesc: '2 часа фокуса ежедневно',
    desc: '30 дней по 2 часа глубокой работы без мессенджеров, соцсетей и уведомлений. Одна главная задача в день. К концу — ты делаешь за день то, что раньше делал за неделю.',
    days: 30,
    color: '#0891b2',
    habits: [
      { name: '2 часа глубокой работы', emoji: '🧠', freq: 'Каждый день' },
      { name: 'Без соцсетей в рабочие часы', emoji: '📵', freq: 'Каждый день' },
      { name: 'План на день утром', emoji: '📋', freq: 'Каждый день' },
    ],
    selectable: true,
  },
  {
    id: 'work_morning',
    title: 'Утренняя рутина продуктивного',
    emoji: '☀️',
    shortDesc: 'Идеальное утро каждый день',
    desc: '30 дней утренней рутины. Подъём в 6:00, стакан воды, 10 минут тишины, 30 минут на главную задачу до того, как мир проснётся. Это час, который стоит 3 часов после.',
    days: 30,
    color: '#fbbf24',
    habits: [
      { name: 'Подъём в 6:00', emoji: '🌅', freq: 'Каждый день' },
      { name: 'Стакан воды сразу', emoji: '💧', freq: 'Каждый день' },
      { name: '10 минут тишины', emoji: '🧘', freq: 'Каждый день' },
      { name: 'Главная задача до 9:00', emoji: '🎯', freq: 'Каждый день' },
    ],
    selectable: true,
  },
];
const ONBOARD = [
  {
    key: 'habits',
    q: 'Привет! Я — трекер привычек.\n\nВыбери привычки через пробел (например А В Д), потом напиши "готово":\n\nА Вода\nБ Спорт\nВ Чтение\nГ Медитация\nД Сон 8ч\nЕ Прогулка\nЖ Без телефона\nЗ Учёба',
    options: {
      'А': 'water', 'Б': 'sport', 'В': 'read', 'Г': 'meditate',
      'Д': 'sleep', 'Е': 'walk', 'Ж': 'no_phone', 'З': 'study',
    },
    multi: true,
  },
  {
    key: 'name_reminder',
    q: 'Когда напоминать? И имя одной строкой: "Вероника Б"\n\nА 08:00 Утро\nБ 13:00 День\nВ 19:00 Вечер\nГ 22:00 Поздно\nД Без напоминаний',
    options: REMINDER,
    nameReminder: true,
  },
];
const HABIT_NAMES = {
  water: ['💧', 'Вода'], sport: ['🏃', 'Спорт'], read: ['📖', 'Чтение'],
  meditate: ['🧘', 'Медитация'], sleep: ['😴', 'Сон 8ч'], walk: ['🚶', 'Прогулка'],
  no_phone: ['📵', 'Без телефона'], study: ['🎓', 'Учёба'],
};
const onboardState = new Map();

function pickPush(arr, name) {
  if (!arr || !arr.length) return { text: 'Пора отметить день!', btn: 'Отметить' };
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Достижения / Награды (заглушки) ----------
async function checkAchievementsOnCheck(ctx, tgId, habitId, streak, hour) {
  // Первая отметка
  const u = db.users[tgId];
  if (u && u.total_checks >= 1) giveAchievement(tgId, 'first_check');
  // Уровни (по общему числу отметок)
  if (u && u.total_checks >= 50) giveAchievement(tgId, 'level_5');
  if (u && u.total_checks >= 100) giveAchievement(tgId, 'level_10');
  if (u && u.total_checks >= 250) giveAchievement(tgId, 'level_25');
  // Достижения: ранняя пташка, ночная сова
  if (hour >= 5 && hour < 9) giveAchievement(tgId, 'early_bird');
  if (hour >= 22 || hour < 4) giveAchievement(tgId, 'night_owl');
  // За серии
  if (streak >= 3) giveAchievement(tgId, 'streak_3');
  if (streak >= 7) giveAchievement(tgId, 'streak_7');
  if (streak >= 14) giveAchievement(tgId, 'streak_14');
  if (streak >= 30) giveAchievement(tgId, 'streak_30');
  if (streak >= 100) giveAchievement(tgId, 'streak_100');
  if (streak >= 365) giveAchievement(tgId, 'streak_365');
}
function giveAchievement(tgId, code) {
  const key = `${tgId}::${code}`;
  if (db.achievements[key]) return false;
  db.achievements[key] = { tg_id: tgId, code, date: todayKey() };
  saveDB();
  return true;
}
function giveReward(tgId, text) {
  // Заглушка — можно расширить для будущих фишек
  console.log(`[REWARD] ${tgId}: ${text}`);
}
async function sendPush(tgId, push, cta = 'menu:today', extra = '') {
  try {
    await bot.api.sendMessage(
      tgId,
      push.text + (extra ? '\n\n' + extra : ''),
      { reply_markup: { inline_keyboard: [[{ text: push.btn, callback_data: cta }]] } }
    );
  } catch (e) { console.error('sendPush:', e.message); }
}

const sentToday = new Map();
function wasSent(tgId, key) { return !!sentToday.get(tgId)?.[key]; }
function markSent(tgId, key) {
  if (!sentToday.has(tgId)) sentToday.set(tgId, {});
  sentToday.get(tgId)[key] = true;
}

// ---------- Цитаты дня ----------
const QUOTES = [
  'Маленький шаг каждый день — это путь в тысячу миль.',
  'Дисциплина — это мост между целями и достижениями.',
  'Не считай дни, делай так, чтобы дни считали тебя.',
  'Успех — это сумма маленьких усилий, повторяющихся день за днём.',
  'Лучшее время начать было вчера. Следующее лучшее — сейчас.',
  'Ты не обязан быть великим, чтобы начать. Но обязан начать, чтобы стать великим.',
  'Сначала ты создаёшь привычки, потом привычки создают тебя.',
  'Не бойся идти медленно. Бойся стоять на месте.',
  'Каждый день — новая страница. Напиши её хорошо.',
  'Победа — это не конечная цель, это привычка.',
  'Сильные люди не действуют по-другому. Они действуют, когда не могут.',
  'Сначала будет тяжело. Потом будет легко. Сейчас — не сдавайся.',
  'Ты сильнее, чем думаешь, и способнее, чем представляешь.',
  'Привычка — якорь, который держит тебя в шторм.',
  'То, что делается каждый день, важнее того, что делается раз в жизни.',
  'Не ищи мотивацию. Создай дисциплину. Она приведёт тебя дальше.',
  'Сделай сегодня то, что другие не хотят, — завтра будешь жить так, как другие не могут.',
  'Каждая привычка — это голос за будущего себя.',
  'Самый тёмный час — перед рассветом. Держись.',
  'Ты не обязан быть идеальным. Ты обязан быть постоянным.',
  'Маленькие победы — это кирпичи больших результатов.',
  'Рост происходит за пределами зоны комфорта.',
  'Через год ты пожалеешь, что не начал сегодня.',
  'Не останавливайся, пока не будешь гордиться собой.',
  'Привычки — это сложные проценты. Каждый день добавляет.',
  'Дорогу осилит идущий. Сделай ещё один шаг.',
  'Сила не в том, чтобы никогда не падать. А в том, чтобы каждый раз вставать.',
  'Лучшая инвестиция — в себя. Проценты капают каждый день.',
  'Не откладывай на завтра то, что можно отметить сегодня.',
  'Дисциплина — это свобода. Каждая отметка — шаг к ней.',
];

function getQuote() { return QUOTES[Math.floor(Math.random() * QUOTES.length)]; }

// ---------- Уровни ----------
function getLevel(totalChecks) {
  // Каждые 10 отметок = +1 уровень, начиная с 1
  return Math.floor(totalChecks / 10) + 1;
}
function getLevelProgress(totalChecks) {
  const level = getLevel(totalChecks);
  const base = (level - 1) * 10;
  const progress = totalChecks - base;
  return { level, progress, next: 10 };
}

// ---------- Режим тишины ----------
function isSilent(tgId) {
  const u = db.users[tgId];
  const s = u && u.silent;
  if (!s) return false;
  const now = Math.floor(Date.now() / 1000);
  // s = { from: '22:00', to: '08:00' } — формат HH:MM
  if (!s.from || !s.to) return false;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const [fh, fm] = s.from.split(':').map(Number);
  const [th, tm] = s.to.split(':').map(Number);
  const fromMin = fh * 60 + fm;
  const toMin = th * 60 + tm;
  if (fromMin < toMin) {
    return nowMin >= fromMin && nowMin < toMin;
  } else {
    // переходит через полночь
    return nowMin >= fromMin || nowMin < toMin;
  }
}

// ---------- Команды ----------
bot.command('help', async (ctx) => {
  return ctx.reply(
    'Команды:\n\n' +
    '/start — главное меню\n' +
    '/today — отметить привычки\n' +
    '/add Название — добавить привычку\n' +
    '/delete Название — удалить привычку\n' +
    '/stats — статистика\n' +
    '/challenge — челленджи\n' +
    '/silent 22:00 08:00 — тихий режим\n' +
    '/silent off — выключить тишину'
  );
});

bot.command('add', async (ctx) => {
  const text = ctx.message.text;
  const name = text.replace(/^\/add\s*/i, '').trim();
  if (!name) return ctx.reply('Формат: /add Название\nНапример: /add Пить воду');
  if (name.length > 60) return ctx.reply('Слишком длинное название (макс 60 символов)');
  if (getHabits(ctx.from.id).length >= 30) return ctx.reply('Лимит 30 привычек. Удали старые через /delete Название');
  const id = uid();
  db.habits[id] = { id, owner_id: ctx.from.id, name, emoji: '✨', color: '#ff8906', streak: 0, best: 0, created_at: Date.now() };
  saveDB();
  return ctx.reply(`Привычка «${name}» добавлена ✓\n\nОткрой в трекере или нажми /today`);
});

bot.command('delete', async (ctx) => {
  const text = ctx.message.text;
  const name = text.replace(/^\/delete\s*/i, '').trim();
  if (!name) return ctx.reply('Формат: /delete Название\nНапример: /delete Вода');
  const tgId = ctx.from.id;
  const habits = Object.values(db.habits).filter(h => h.owner_id === tgId);
  const found = habits.find(h => h.name.toLowerCase() === name.toLowerCase());
  if (!found) return ctx.reply(`Не нашёл «${name}»\n\nТвои: ${habits.map(h => h.name).join(', ') || 'нет'}`);
  delete db.habits[found.id];
  saveDB();
  return ctx.reply(`Удалил «${found.name}»`);
});

bot.command('stats', async (ctx) => {
  return showStatsInline(ctx);
});

bot.command('today', async (ctx) => {
  return showToday(ctx);
});

bot.command('challenge', async (ctx) => {
  return showChallengePicker(ctx);
});

bot.command('silent', async (ctx) => {
  const text = ctx.message.text;
  const arg = text.replace(/^\/silent\s*/i, '').trim();
  if (!arg) return ctx.reply('Формат: /silent 22:00 08:00\nИли /silent off');
  if (arg === 'off') {
    const u = getUser(ctx.from.id);
    u.silent = null;
    saveDB();
    return ctx.reply('Режим тишины выключен.');
  }
  const m = arg.match(/^(\d{1,2}):?(\d{2})\s+(\d{1,2}):?(\d{2})$/);
  if (!m) return ctx.reply('Формат: /silent 22:00 08:00');
  const u = getUser(ctx.from.id);
  u.silent = { from: `${m[1].padStart(2,'0')}:${m[2]}`, to: `${m[3].padStart(2,'0')}:${m[4]}` };
  saveDB();
  return ctx.reply(`Тишина: с ${u.silent.from} до ${u.silent.to}. Бот не будет беспокоить в это время.`);
});

async function showStatsInline2(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  const habits = getHabits(tgId);
  if (habits.length === 0) return ctx.reply('Нет привычек. /add Название');
  const total = u.total_checks || 0;
  const best = u.best_streak || 0;
  const avgPct = Math.round(habits.reduce((s,h)=>s+(h.percent30||0),0)/habits.length);
  let text = `Статистика\n\n`;
  text += `Среднее: ${avgPct}%\n`;
  text += `Всего отметок: ${total}\n`;
  text += `Лучшая серия: ${best} дней\n\n`;
  text += `По привычкам:\n`;
  for (const h of habits) {
    text += ` ${h.emoji} ${h.name}: ${h.percent30 || 0}% (${h.totalChecks || 0} ✓, 🔥${h.best || 0})\n`;
  }
  return ctx.reply(text);
}

// ---------- Onboarding ----------
bot.command('start', async (ctx) => {
  console.log('CMD /start from', ctx.from.id);
  const u = getUser(ctx.from.id);
  if (u.onboard_step >= 100) {
    console.log('Going to showMainMenu');
    const tgId = ctx.from.id;
    const habits = getHabits(tgId);
    const today = todayKey();
    const doneToday = habits.filter(h => isChecked(h.id, today)).length;
    const url = buildWebAppUrl(tgId);
    console.log('URL length:', url.length);
    console.log('habits count:', habits.length);
    try {
      const r = await ctx.reply(
        `Трекер привычек\n\nПривет, ${u.name}!\n\nСегодня: ${doneToday}/${habits.length}\nВсего отметок: ${u.total_checks}\nЛучшая серия: ${u.best_streak} дней`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Открыть трекер', web_app: { url: url } }],
              [{ text: '✅ Отметить', callback_data: 'menu:today' }, { text: '📊 Статистика', callback_data: 'menu:stats' }],
              [{ text: '🏆 Челенджи', callback_data: 'menu:challenge' }, { text: '⚙️ Настройки', callback_data: 'menu:settings' }],
            ],
          },
        }
      );
      console.log('Sent OK');
      return r;
    } catch (e) {
      console.error('SEND FAILED:', e.message);
      throw e;
    }
  }
  onboardState.set(ctx.from.id, { step: 0, data: {} });
  u.onboard_step = 1;
  saveDB();
  return ctx.reply(ONBOARD[0].q);
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  u.last_seen_at = Math.floor(Date.now() / 1000);
  saveDB();

  if (text.startsWith('/')) return handleCommand(ctx, text);
  if (text === 'готово' || text.toLowerCase() === 'готово') {
    const st = onboardState.get(tgId);
    if (st && st.step === 0) {
      st.step = 1;
      onboardState.set(tgId, st);
      u.onboard_step = 2;
      saveDB();
      return ctx.reply(ONBOARD[1].q);
    }
  }
  const st = onboardState.get(tgId);
  if (st && st.step === 0) {
    // Парсим буквы
    const letters = text.toUpperCase().split(/[\s,]+/).filter(Boolean);
    const picked = [];
    for (const l of letters) {
      if (ONBOARD[0].options[l]) picked.push(ONBOARD[0].options[l]);
    }
    if (picked.length > 0) {
      st.data.habits = [...(st.data.habits || []), ...picked];
      return ctx.reply(`Добавил: ${picked.join(', ')}\n\nЕщё или напиши "готово"`);
    }
  }
  if (st && st.step === 1) {
    const m = text.match(/^(.+?)\s*([А-Я])?$/);
    if (m) {
      const name = m[1].trim() || 'друг';
      const letter = m[2] || 'А';
      const rem = REMINDER[letter] || REMINDER['А'];
      st.data.name = name;
      st.data.reminder = rem.value;
      u.name = name;
      u.reminder_time = rem.value;
      // Создаём привычки
      const selected = st.data.habits || ['water', 'walk', 'sleep'];
      for (const h of selected) {
        const id = uid();
        const info = HABIT_NAMES[h] || ['✨', h];
        db.habits[id] = { id, owner_id: tgId, name: info[1], emoji: info[0], color: '#ff8906', streak: 0, best: 0, created_at: Date.now() };
      }
      u.onboard_step = 100;
      onboardState.delete(tgId);
      saveDB();
      const remLabel = rem.value === 'off' ? 'Без напоминаний' : `В ${rem.value}`;
      return ctx.reply(
        `Готово, ${name}!\n\nСоздал ${selected.length} ${selected.length === 1 ? 'привычку' : 'привычек'}.\n\n${remLabel}\n\nНапиши /today или открой приложение.`
      );
    }
  }
});

async function handleCommand(ctx, text) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  if (text === '/today') return showToday(ctx);
  if (text === '/stats') return showStats(ctx);
  if (text === '/help') return ctx.reply(
    'Команды:\n\n' +
    '/start — главное меню\n' +
    '/today — отметить привычки\n' +
    '/add Название — добавить\n' +
    '/delete Название — удалить\n' +
    '/stats — статистика\n' +
    '/challenge — челленджи\n' +
    '/silent 22:00 08:00 — тихий режим\n' +
    '/silent off — выключить тишину\n\n' +
    'Или просто открой /start → кнопки'
  );
}

async function showMainMenu(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  const habits = getHabits(tgId);
  const today = todayKey();
  const doneToday = habits.filter(h => isChecked(h.id, today)).length;
  return ctx.reply(
    `Трекер привычек\n\nПривет, ${u.name}!\n\nСегодня: ${doneToday}/${habits.length}\nВсего отметок: ${u.total_checks}\nЛучшая серия: ${u.best_streak} дней`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📱 Открыть трекер', web_app: { url: buildWebAppUrl(tgId) } }],
          [{ text: '✅ Отметить', callback_data: 'menu:today' }, { text: '📊 Статистика', callback_data: 'menu:stats' }],
          [{ text: '🏆 Челенджи', callback_data: 'menu:challenge' }, { text: '⚙️ Настройки', callback_data: 'menu:settings' }],
        ],
      },
    }
  );
}

async function showToday(ctx) {
  const tgId = ctx.from.id;
  const habits = getHabits(tgId);
  if (habits.length === 0) {
    return ctx.reply('Нет привычек. Нажми /start');
  }
  const today = todayKey();
  const rows = habits.map(h => {
    const done = isChecked(h.id, today);
    return [{ text: `${done ? '✅' : '⬜'} ${h.emoji} ${h.name} (🔥${h.streak})`, callback_data: `toggle:${h.id}` }];
  });
  rows.push([{ text: '« Меню', callback_data: 'menu:main' }]);
  return ctx.reply('Отметь сегодня:', { reply_markup: { inline_keyboard: rows } });
}

async function showStats(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  const habits = getHabits(tgId);
  const total = habits.reduce((s, h) => s + (h.best || 0), 0);
  return ctx.reply(
    `Статистика\n\nПривычек: ${habits.length}\nВсего отметок: ${u.total_checks}\nЛучшая серия за всё время: ${u.best_streak} дней`
  );
}

async function showChallengePicker(ctx) {
  const tgId = ctx.from.id;
  const myChallenges = Object.values(db.challenges).filter(c => c.owner_id === tgId);
  const rows = [];
  for (let i = 0; i < CHALLENGES.length; i += 2) {
    const a = CHALLENGES[i], b = CHALLENGES[i+1];
    const aActive = myChallenges.find(x => x.title === a.title && !x.completed);
    const row = [{ text: `${aActive ? '⏳' : ''} ${a.emoji} ${a.title}`, callback_data: `cstart:${a.id}` }];
    if (b) {
      const bActive = myChallenges.find(x => x.title === b.title && !x.completed);
      row.push({ text: `${bActive ? '⏳' : ''} ${b.emoji} ${b.title}`, callback_data: `cstart:${b.id}` });
    }
    rows.push(row);
  }
  rows.push([{ text: '« Меню', callback_data: 'menu:main' }]);
  return ctx.reply('Выбери челендж:', { reply_markup: { inline_keyboard: rows } });
}

async function showSettingsInline(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  // Компактные настройки в одном сообщении
  const palRows = [];
  for (let i = 0; i < PALETTES.length; i += 2) {
    const a = PALETTES[i], b = PALETTES[i+1];
    const row = [{ text: `${a.id === u.palette ? '✓ ' : ''}${a.label}`, callback_data: `pal:${a.id}` }];
    if (b) row.push({ text: `${b.id === u.palette ? '✓ ' : ''}${b.label}`, callback_data: `pal:${b.id}` });
    palRows.push(row);
  }
  const remRows = [];
  for (let i = 0; i < Object.keys(REMINDER).length; i += 2) {
    const keys = Object.keys(REMINDER);
    const a = REMINDER[keys[i]], b = REMINDER[keys[i+1]];
    const row = [{ text: `${a.value === u.reminder_time ? '✓ ' : ''}${a.label}`, callback_data: `rem:${a.value}` }];
    if (b) row.push({ text: `${b.value === u.reminder_time ? '✓ ' : ''}${b.label}`, callback_data: `rem:${b.value}` });
    remRows.push(row);
  }
  const rows = [
    [{ text: '🎨 Палитра', callback_data: 'noop' }],
    ...palRows,
    [{ text: '⏰ Напоминание', callback_data: 'noop' }],
    ...remRows,
    [{ text: '« Меню', callback_data: 'menu:main' }],
  ];
  return ctx.reply('⚙️ *Настройки*\n\nВыбери палитру и время напоминания:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
}

function buildWebAppUrl(tgId) {
  // Короткий URL — Telegram имеет лимит ~512 символов на web_app.url
  // Данные WebApp подгрузит через API
  return `${WEBAPP_URL}?tg_id=${tgId}`;
}

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  u.last_seen_at = Math.floor(Date.now() / 1000);
  if (data === 'menu:main') return showMainMenu(ctx);
  if (data === 'menu:today') return showToday(ctx);
  if (data === 'menu:stats') return showStats(ctx);
  if (data === 'menu:palette') {
    const rows = [];
    for (let i = 0; i < PALETTES.length; i += 2) {
      const a = PALETTES[i], b = PALETTES[i+1];
      const row = [{ text: `${a.id === u.palette ? '✓ ' : ''}${a.label}`, callback_data: `pal:${a.id}` }];
      if (b) row.push({ text: `${b.id === u.palette ? '✓ ' : ''}${b.label}`, callback_data: `pal:${b.id}` });
      rows.push(row);
    }
    rows.push([{ text: '« Меню', callback_data: 'menu:main' }]);
    return ctx.reply('Палитра:', { reply_markup: { inline_keyboard: rows } });
  }
  if (data === 'menu:challenge') return showChallengePicker(ctx);
  if (data === 'menu:settings') return showSettingsInline(ctx);
  if (data === 'noop') return ctx.answerCbQuery();
  if (data.startsWith('pal:')) {
    const palette = data.slice(4);
    const u = getUser(tgId);
    u.palette = palette;
    save();
    await ctx.answerCbQuery('Палитра применена!');
    return showSettingsInline(ctx);
  }
  if (data.startsWith('rem:')) {
    const value = data.slice(4);
    const u = getUser(tgId);
    u.reminder_time = value;
    save();
    await ctx.answerCbQuery('Напоминание сохранено');
    return showSettingsInline(ctx);
  }
  if (data.startsWith('pal:')) {
    u.palette = data.slice(4);
    saveDB();
    await ctx.answerCallbackQuery('✓');
    return ctx.editMessageText(`Палитра: ${u.palette}`);
  }
  if (data.startsWith('toggle:')) {
    const habitId = data.slice(7);
    const h = getHabit(habitId, tgId);
    if (!h) return ctx.answerCallbackQuery('Не найдено');
    const day = todayKey();
    const was = isChecked(habitId, day);
    setCheck(habitId, day, !was);
    if (!was) {
      // Считаем streak
      let streak = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(habitId, key)) streak++;
        else break;
      }
      h.streak = streak;
      h.best = Math.max(h.best, streak);
      u.total_checks += 1;
      u.best_streak = Math.max(u.best_streak, streak);
      u.last_check_day = day;
      const hour = new Date().getHours();
      checkAchievementsOnCheck(ctx, tgId, habitId, streak, hour);
      // Награда за milestone
      if (streak === 7) { await ctx.reply('Неделя силы. Не останавливайся.'); giveReward(tgId, 'Неделя силы — 7 дней'); }
      if (streak === 30) { await ctx.reply('Месяц. Ты машина.'); giveReward(tgId, 'Месяц дисциплины — 30 дней'); }
      if (streak === 100) { await ctx.reply('100 дней. Сказочное дерево.'); giveReward(tgId, 'Сказочное дерево — 100 дней'); }
      // Случайный бонус (10% шанс)
      if (Math.random() < 0.1) {
        const bonuses = [
          '🍀 Удача! Сегодня +1 к streak бесплатно!',
          '🌟 Бонус: +1 к лучшей серии!',
          '🎁 Подарок: уровень повышен!',
        ];
        await ctx.reply('🎁 ' + bonuses[Math.floor(Math.random() * bonuses.length)]);
      }
    }
    saveDB();
    return showToday(ctx);
  }
  if (data.startsWith('cstart:')) {
    const cid = data.slice(6);
    const cat = CHALLENGES.find(c => c.id === cid);
    if (!cat) return ctx.answerCbQuery('Не найдено');

    // Если челлендж со связкой привычек (selectable) — показать выбор
    if (cat.selectable && cat.habits) {
      onboardState.set(tgId, { step: 'pick_challenge_habits', challenge: cat, selected: new Set() });
      const rows = cat.habits.map((h, i) => [{
        text: `◯ ${h.emoji} ${h.name}`,
        callback_data: `cph:${cid}:${i}`,
      }]);
      rows.push([{ text: '✅ Готово — добавить выбранные', callback_data: `cph_done:${cid}` }]);
      rows.push([{ text: '« Отмена', callback_data: 'menu:challenge' }]);
      return ctx.reply(
        `🚀 ${cat.emoji} ${cat.title}\n\n${cat.desc}\n\nВыбери привычки, которые хочешь добавить (можно несколько). Можно выбрать все или только те, что подходят:`,
        { reply_markup: { inline_keyboard: rows } }
      );
    }

    // Простой челлендж с одной привычкой (или набором привычек)
    const id = uid();
    db.challenges[id] = {
      id, owner_id: tgId, title: cat.title, emoji: cat.emoji,
      description: cat.desc, days: cat.days, color: cat.color,
      started_at: Math.floor(Date.now()/1000),
      ends_at: Math.floor(Date.now()/1000) + cat.days*86400,
      completed: 0, checkDays: 0,
    };
    if (cat.habitName) {
      const habitId = uid();
      db.habits[habitId] = {
        id: habitId, owner_id: tgId,
        name: cat.habitName,
        emoji: cat.habitEmoji,
        color: cat.color,
        category: 'challenge',
        challengeId: id,
        freq: cat.habitFreq,
        created: Math.floor(Date.now()/1000),
        checks: [],
      };
    }
    saveDB();
    await ctx.answerCbQuery('Старт!');
    const replyRows = [];
    if (habitId) replyRows.push([{ text: '✅ Отметить сегодня', callback_data: `t:${habitId}` }]);
    replyRows.push([{ text: '📱 Открыть трекер', web_app: { url: buildWebAppUrl(tgId) } }]);
    replyRows.push([{ text: '🏠 Главное меню', callback_data: 'menu:main' }]);
    return ctx.reply(
      `🚀 Старт: ${cat.emoji} ${cat.title}\n\n${cat.desc}\n\n${cat.habitName ? `📌 Привычка «${cat.habitEmoji} ${cat.habitName}» добавлена в твой список. ${cat.habitFreq === 'Каждые 2 дня' ? 'Отмечай через день.' : 'Отмечай каждый день.'}\n\n` : ''}${cat.days} дней. Поехали.`,
      { reply_markup: { inline_keyboard: replyRows } }
    );
  }

  // Toggle выбор привычки для связки
  if (data.startsWith('cph:')) {
    const [, cid, idxStr] = data.split(':');
    const idx = parseInt(idxStr);
    const st = onboardState.get(tgId);
    if (!st || st.step !== 'pick_challenge_habits' || st.challenge.id !== cid) return ctx.answerCbQuery('Отменено');
    if (st.selected.has(idx)) st.selected.delete(idx);
    else st.selected.add(idx);
    const cat = st.challenge;
    const rows = cat.habits.map((h, i) => [{
      text: `${st.selected.has(i) ? '✓' : '◯'} ${h.emoji} ${h.name}`,
      callback_data: `cph:${cid}:${i}`,
    }]);
    rows.push([{ text: `✅ Готово (${st.selected.size}/${cat.habits.length})`, callback_data: `cph_done:${cid}` }]);
    rows.push([{ text: '« Отмена', callback_data: 'menu:challenge' }]);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: rows }); } catch {}
    return ctx.answerCbQuery();
  }

  // Подтверждение выбора связки
  if (data.startsWith('cph_done:')) {
    const cid = data.slice('cph_done:'.length);
    const st = onboardState.get(tgId);
    if (!st || st.step !== 'pick_challenge_habits' || st.challenge.id !== cid) return ctx.answerCbQuery('Отменено');
    const cat = st.challenge;
    if (st.selected.size === 0) return ctx.answerCbQuery('Выбери хотя бы одну');
    // Создать челлендж
    const id = uid();
    db.challenges[id] = {
      id, owner_id: tgId, title: cat.title, emoji: cat.emoji,
      description: cat.desc, days: cat.days, color: cat.color,
      started_at: Math.floor(Date.now()/1000),
      ends_at: Math.floor(Date.now()/1000) + cat.days*86400,
      completed: 0, checkDays: 0,
    };
    // Создать выбранные привычки
    const habitBtns = [];
    for (const i of st.selected) {
      const h = cat.habits[i];
      const habitId = uid();
      db.habits[habitId] = {
        id: habitId, owner_id: tgId,
        name: h.name, emoji: h.emoji, color: cat.color,
        category: 'challenge', challengeId: id,
        freq: h.freq, created: Math.floor(Date.now()/1000), checks: [],
      };
      habitBtns.push([{ text: `${h.emoji} ${h.name}`, callback_data: `t:${habitId}` }]);
    }
    saveDB();
    onboardState.delete(tgId);
    await ctx.answerCbQuery('Старт!');
    habitBtns.push([{ text: '📱 Открыть трекер', web_app: { url: buildWebAppUrl(tgId) } }]);
    habitBtns.push([{ text: '🏠 Главное меню', callback_data: 'menu:main' }]);
    return ctx.reply(
      `🚀 Старт: ${cat.emoji} ${cat.title}\n\n${cat.desc}\n\n📌 Добавлено привычек: ${st.selected.size}. ${cat.days} дней. Поехали.`,
      { reply_markup: { inline_keyboard: habitBtns } }
    );
  }
});

// ---------- WebApp actions ----------
bot.on('message:web_app_data', async (ctx) => {
  let p;
  try { p = JSON.parse(ctx.message.web_app_data.data); } catch { return; }
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  if (p.action === 'set_palette' && p.palette) {
    u.palette = p.palette; saveDB(); return;
  }
  if (p.action === 'set_profile' && p.name) {
    u.name = p.name.slice(0, 40);
    if (p.reminder_time) u.reminder_time = p.reminder_time;
    saveDB(); return;
  }
  if (p.action === 'set_reminder' && p.reminder_time) {
    u.reminder_time = p.reminder_time;
    saveDB(); return;
  }
  if (p.action === 'toggle_habit' && p.habit_id) {
    const h = getHabit(p.habit_id, tgId);
    if (!h) return;
    const day = todayKey();
    const was = isChecked(p.habit_id, day);
    setCheck(p.habit_id, day, !was);
    if (!was) {
      let streak = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(p.habit_id, key)) streak++; else break;
      }
      h.streak = streak; h.best = Math.max(h.best, streak);
      u.total_checks += 1; u.best_streak = Math.max(u.best_streak, streak); u.last_check_day = day;
      const hour = new Date().getHours();
      checkAchievementsOnCheck(null, tgId, p.habit_id, streak, hour);
    }
    saveDB();
    return;
  }
  if (p.action === 'add_habit' && p.name) {
    if (getHabits(tgId).length >= 30) return;
    const id = uid();
    db.habits[id] = { id, owner_id: tgId, name: String(p.name).slice(0, 60), emoji: p.emoji || '✨', color: p.color || '#ff8906', streak: 0, best: 0, created_at: Date.now() };
    saveDB();
    return;
  }
  if (p.action === 'delete_habit' && p.habit_id) {
    const h = getHabit(p.habit_id, tgId);
    if (h) {
      delete db.habits[p.habit_id];
      // Очистить связанные чеки
      for (const k of Object.keys(db.checks)) {
        if (k.startsWith(p.habit_id + '::') || k === p.habit_id) delete db.checks[k];
      }
      saveDB();
    }
    return;
  }
  if (p.action === 'start_challenge' && p.challenge_id) {
    const cat = CHALLENGES.find(c => c.id === p.challenge_id);
    if (!cat) return;
    const id = uid();
    db.challenges[id] = { id, owner_id: tgId, title: cat.title, emoji: cat.emoji, description: cat.desc, days: cat.days, color: cat.color, started_at: Math.floor(Date.now()/1000), ends_at: Math.floor(Date.now()/1000) + cat.days*86400, completed: 0, checkDays: 0 };
    // Создаём связанные привычки
    if (cat.habits && cat.habits.length) {
      for (const h of cat.habits) {
        const habitId = uid();
        db.habits[habitId] = { id: habitId, owner_id: tgId, name: h.name, emoji: h.emoji, color: cat.color, category: 'challenge', challengeId: id, freq: h.freq, created: Math.floor(Date.now()/1000), checks: [] };
      }
    } else if (cat.habitName) {
      const habitId = uid();
      db.habits[habitId] = { id: habitId, owner_id: tgId, name: cat.habitName, emoji: cat.habitEmoji, color: cat.color, category: 'challenge', challengeId: id, freq: cat.habitFreq, created: Math.floor(Date.now()/1000), checks: [] };
    }
    saveDB();
    try { await ctx.reply(`🚀 Старт: ${cat.emoji} ${cat.title}\n\n${cat.days} дней. Привычки добавлены на главную. Поехали!`); } catch {}
    return;
  }
  if (p.action === 'check_challenge' && p.challenge_id) {
    const c = db.challenges[p.challenge_id];
    if (!c || c.owner_id !== tgId || c.completed) return;
    const day = todayKey();
    const key = `${c.id}::${day}`;
    if (db.checks[key]) return;
    db.checks[key] = true;
    c.checkDays = (c.checkDays || 0) + 1;
    if (c.checkDays >= c.days) c.completed = 1;
    saveDB();
    try { await ctx.reply(`✓ ${c.emoji} ${c.title}: день ${c.checkDays}/${c.days}`); } catch {}
    return;
  }
});

// ---------- Scheduler ----------
setInterval(async () => {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowStr = `${hh}:${mm}`;
  for (const tgId in db.users) {
    const u = db.users[tgId];
    if (u.onboard_step < 100) continue;
    if (u.reminder_time !== nowStr) continue;
    const key = `remind:${nowStr}`;
    if (wasSent(tgId, key)) continue;
    const habits = getHabits(Number(tgId));
    if (habits.length === 0) continue;
    if (u.last_check_day === todayKey()) continue;
    let pool;
    if (nowStr === '22:00' || nowStr === '20:00') pool = PUSH.night;
    else if (nowStr === '19:00') pool = PUSH.evening;
    else if (nowStr === '13:00') pool = PUSH.day;
    else if (nowStr === '08:00') pool = PUSH.morning;
    else pool = PUSH.bold;
    await sendPush(Number(tgId), pickPush(pool, u.name));
    markSent(tgId, key);
  }
  // 1 раз в день в 19:00 — comeback push
  if (nowStr === '19:00') {
    for (const tgId in db.users) {
      const u = db.users[tgId];
      if (u.onboard_step < 100) continue;
      const day = todayKey();
      const habits = getHabits(Number(tgId));
      const done = habits.filter(h => isChecked(h.id, day)).length;
      if (done === habits.length && habits.length > 0) continue;
      const last = u.last_seen_at || 0;
      const now = Math.floor(Date.now() / 1000);
      if (now - last < 2 * 86400) continue;
      const key = `comeback:${Math.floor(now / 3600)}`;
      if (wasSent(tgId, key)) continue;
      const pool = now - last > 5 * 86400 ? PUSH.long_away : PUSH.comeback;
      await sendPush(Number(tgId), pickPush(pool, u.name));
      markSent(tgId, key);
    }
  }
}, 60 * 1000);
setInterval(() => { sentToday.clear(); }, 60 * 60 * 1000);

// ---------- HTTP API ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, users: Object.keys(db.users).length }));
    return;
  }
  if (url.pathname === '/api/webapp-data') {
    const tgId = parseInt(url.searchParams.get('tg_id') || '0');
    if (!tgId || !db.users[tgId]) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const u = db.users[tgId];
    const habits = Object.values(db.habits).filter(h => h.owner_id === tgId);
    const today = todayKey();
    const habitsWithStats = habits.map(h => {
      const doneDays = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(h.id, key)) doneDays.push(key);
      }
      const doneCount = doneDays.length;
      return { id: h.id, name: h.name, emoji: h.emoji, color: h.color, streak: h.streak, best: h.best, doneDays, totalChecks: doneCount, percent30: Math.round(doneCount/30*100) };
    });
    const doneToday = habitsWithStats.filter(h => h.doneDays.includes(today)).length;
    const payload = {
      user: { tg_id: tgId, name: u.name, best_streak: u.best_streak, total_checks: u.total_checks, palette: u.palette },
      today: { date: today, done: doneToday, total: habitsWithStats.length },
      stats: { avgPercent: habitsWithStats.length ? Math.round(habitsWithStats.reduce((s,h)=>s+h.percent30,0)/habitsWithStats.length) : 0, bestStreak: u.best_streak, totalChecks: u.total_checks },
      habits: habitsWithStats,
      challenges: Object.values(db.challenges || {}).filter(c => c.owner_id === tgId),
      achievements: Object.values(db.achievements || {}).filter(a => a.tg_id === tgId),
      challengeCatalog: CHALLENGES.map(c => ({
        id: c.id, title: c.title, emoji: c.emoji, shortDesc: c.shortDesc,
        description: c.desc,
        days: c.days, color: c.color, habitFreq: c.habitFreq,
        habitName: c.habitName, habitEmoji: c.habitEmoji,
        habits: c.habits, selectable: c.selectable,
      })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
    res.end(JSON.stringify(payload));
    return;
  }
  res.writeHead(404, CORS); res.end('not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`HTTP API on :${PORT}`));

// ---------- Start ----------
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
await loadDB();
console.log('Трекер привычек bot started');
bot.catch((err, ctx) => {
  console.error('=== BOT ERROR ===');
  console.error('MSG:', err.message);
  if (ctx) {
    if (ctx.callbackQuery) {
      console.error('TYPE: callback');
      console.error('DATA:', ctx.callbackQuery.data);
      try { ctx.answerCbQuery('Ошибка, попробуй ещё раз').catch(()=>{}); } catch {}
    }
    if (ctx.message) {
      console.error('TYPE: message');
      console.error('TEXT:', ctx.message.text);
    }
  }
  console.error('STACK:', (err.stack || '').slice(0, 800));
});
bot.start();
console.log('Bot polling started');
