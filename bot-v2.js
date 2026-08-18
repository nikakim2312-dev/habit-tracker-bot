// Трекер привычек — облегчённая версия для Replit
// Хранит данные в JSON файле (без SQLite)
// Все пуши — простой текст, без Markdown

import { Bot } from 'grammy';
import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ---------- Logger ----------
// Уровни логирования: debug=0, info=1, warning=2, error=3, critical=4
const LOG_LEVELS = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };
const LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function ts() {
  return new Date().toISOString();
}
function log(level, msg, extra) {
  const lv = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  if (lv < LOG_LEVEL) return; // Фильтр по уровню
  const tag = level.toUpperCase().padEnd(8, ' ');
  let line = `[${ts()}] [${tag}] ${msg}`;
  if (extra) {
    if (extra instanceof Error) line += ` ${extra.stack || extra.message}`;
    else if (typeof extra === 'object') {
      try { line += ` ${JSON.stringify(extra)}`; } catch { line += ` [unserializable]`; }
    } else line += ` ${extra}`;
  }
  // critical/error → stderr, остальные → stdout
  if (lv >= LOG_LEVELS.error) console.error(line);
  else console.log(line);
}

const logger = {
  debug: (msg, extra) => log('debug', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  warning: (msg, extra) => log('warning', msg, extra),
  warn: (msg, extra) => log('warning', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
  critical: (msg, extra) => log('critical', msg, extra),
};

// ---------- Safe wrappers ----------
// Безопасные обёртки — не бросают при сетевых ошибках Telegram
function safeReply(ctx, text, extra) {
  return Promise.resolve()
    .then(() => ctx.reply(text, extra))
    .catch((e) => logger.error('safeReply failed', { error: e.message, chat: ctx.chat?.id }));
}
function safeAnswerCb(ctx, text) {
  return Promise.resolve()
    .then(() => ctx.answerCallbackQuery(text))
    .catch((e) => logger.error('safeAnswerCb failed', { error: e.message, user: ctx.from?.id }));
}

function safeEditText(ctx, text, extra) {
  return Promise.resolve()
    .then(() => ctx.editMessageText(text, extra))
    .catch((e) => logger.error('safeEditText failed', { error: e.message, user: ctx.from?.id }));
}

function safeEditMarkup(ctx, markup) {
  return Promise.resolve()
    .then(() => ctx.editMessageReplyMarkup(markup))
    .catch((e) => logger.error('safeEditMarkup failed', { error: e.message, user: ctx.from?.id }));
}

// ---------- Config ----------
const TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT || 10000); // Render default
const DATA_FILE = process.env.DATA_FILE || 'data.json';

// Умный выбор URL для Mini App:
// 1) если задана MINIAPP_URL — используем её
// 2) если задана WEBAPP_URL и она НЕ указывает на наш же хост — используем
// 3) иначе — дефолт
const DEFAULT_MINIAPP = 'https://q4qcuplnh04mz.space.minimax.io';
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

if (!TOKEN) { logger.critical('Set BOT_TOKEN env var'); process.exit(1); }

const bot = new Bot(TOKEN);

// Rate limit — защита от спама (макс 5 update в секунду на юзера)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 5;
function checkRateLimit(tgId) {
  const now = Date.now();
  let arr = rateLimit.get(tgId);
  if (!arr) { arr = []; rateLimit.set(tgId, arr); }
  // Чистим старые timestamps in-place (O(1) amortized)
  while (arr.length && now - arr[0] > RATE_LIMIT_WINDOW) arr.shift();
  if (arr.length >= RATE_LIMIT_MAX) return false;
  arr.push(now);
  return true;
}
bot.use(async (ctx, next) => {
  if (ctx.from?.id) {
    if (!checkRateLimit(ctx.from.id)) {
      logger.warn('Rate limit hit', { user: ctx.from.id });
      // Тихо игнорируем, не отвечаем (чтобы не спамить в ответ)
      return;
    }
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

// === GitHub Gist как persistent хранилище ===
// Render free plan не имеет persistent disk — данные теряются при рестарте
// Решение: писать в приватный GitHub Gist
// GIST_ID и GIST_TOKEN задаются через env vars в Render Dashboard
const GIST_ID = process.env.GIST_ID || '';
const GIST_TOKEN = process.env.GIST_TOKEN || '';
const GIST_FILE = 'data.json';

async function loadFromGist() {
  if (!GIST_ID || !GIST_TOKEN) return null;
  try {
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`);
    if (!r.ok) return null;
    const data = await r.json();
    const file = data.files?.[GIST_FILE];
    if (!file || !file.content) return null;
    const parsed = JSON.parse(file.content);
    // Защита: должен быть объект
    if (typeof parsed !== 'object' || !parsed) return null;
    return parsed;
  } catch (e) {
    logger.error('loadFromGist failed', e.message);
    return null;
  }
}

async function saveToGist() {
  if (!GIST_ID || !GIST_TOKEN) return false;
  try {
    // Snapshot данных чтобы не сериализовать в Gist мутирующий объект
    const snapshot = JSON.stringify(db);
    const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GIST_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
      },
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: snapshot } }
      })
    });
    if (!r.ok) {
      logger.error('saveToGist failed', `HTTP ${r.status}`);
      return false;
    }
    return true;
  } catch (e) {
    logger.error('saveToGist failed', e.message);
    return false;
  }
}

async function loadDB() {
  // Сначала пробуем Gist (persistent, переживает рестарт Render)
  // Потом fallback на локальный файл
  let loaded = null;
  loaded = await loadFromGist();
  if (loaded) {
    logger.info(`Loaded DB from GitHub Gist (${Object.keys(loaded.users || {}).length} users, ${Object.keys(loaded.habits || {}).length} habits)`);
  } else if (existsSync(DATA_FILE)) {
    try {
      loaded = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
      logger.info('Loaded DB from local file');
    } catch (e) {}
  }
  if (loaded && typeof loaded === 'object') {
    // ВАЖНО: мутируем db, а не переприсваиваем (let-binding)
    // Иначе функции в замыкании потеряют ссылку
    for (const k of Object.keys(loaded)) {
      if (loaded[k] !== undefined) db[k] = loaded[k];
    }
  }
  // Защита от битой структуры
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!db.habits || typeof db.habits !== 'object') db.habits = {};
  if (!db.challenges || typeof db.challenges !== 'object') db.challenges = {};
  if (!db.checks || typeof db.checks !== 'object') db.checks = {};
  if (!db.achievements || typeof db.achievements !== 'object') db.achievements = {};
  // Дополнить дефолтами существующих юзеров
  for (const tgId of Object.keys(db.users)) {
    const u = db.users[tgId];
    if (!u || typeof u !== 'object') { delete db.users[tgId]; continue; }
    if (typeof u.palette !== 'string') u.palette = 'forest';
    if (typeof u.reminder_time !== 'string') u.reminder_time = '09:00';
    if (typeof u.total_checks !== 'number') u.total_checks = 0;
    if (typeof u.best_streak !== 'number') u.best_streak = 0;
    if (typeof u.onboard_step !== 'number') u.onboard_step = 0;
  }
}
let saveTimer = null;
let saveInProgress = false;
let savePending = false; // есть ли изменения, ожидающие сохранения
async function saveDBNow() {
  if (saveInProgress) {
    savePending = true;
    return;
  }
  saveInProgress = true;
  const tmpFile = DATA_FILE + '.tmp';
  try {
    // === updated_at для идеальной синхронизации ===
    db._updated_at = Date.now();
    // Локальный файл (быстро, для синхронных операций)
    await fs.writeFile(tmpFile, JSON.stringify(db, null, 2));
    await fs.rename(tmpFile, DATA_FILE);
    // GitHub Gist (persistent, переживает рестарты)
    saveToGist().catch(e => logger.error('Gist sync', e.message));
  } catch (e) {
    logger.error('saveDB failed', e);
  } finally {
    saveInProgress = false;
    // Если были изменения пока шла запись — сохраняем ещё раз
    if (savePending) {
      savePending = false;
      setImmediate(saveDBNow);
    }
  }
}
function saveDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDBNow, 1000);
}

// Helpers
function getUser(tgId) {
  // ВАЖНО: ключ всегда строка для консистентности
  const key = String(tgId);
  if (!db.users[key]) {
    db.users[key] = {
      tg_id: tgId, name: 'друг', emoji: '🙂', palette: 'forest',
      onboard_step: 0, best_streak: 0, total_checks: 0,
      reminder_time: '09:00', last_seen_at: 0, last_check_day: null,
    };
    saveDB(); // Сохраняем отложенно (debounce)
  }
  return db.users[key];
}
function getHabits(tgId) {
  // Сравниваем через String() для устойчивости к типу
  const key = String(tgId);
  return Object.values(db.habits).filter(h => String(h.owner_id) === key);
}
function getHabit(id, tgId) {
  const h = db.habits[id];
  if (h && String(h.owner_id) === String(tgId)) return h;
  return null;
}
function checkKey(habitId, day) {
  // Валидация day — должен быть строкой YYYY-MM-DD
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    day = todayKey();
  }
  return `${habitId}::${day}`;
}
function isChecked(habitId, day) { return !!db.checks[checkKey(habitId, day)]; }
function setCheck(habitId, day, on) {
  const k = checkKey(habitId, day);
  if (on) db.checks[k] = true;
  else delete db.checks[k];
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const uid = () => randomBytes(6).toString('hex');

// === Безопасное добавление привычки с дедупликацией ===
// Возвращает { ok, id, deduped } где deduped=true если уже существует
function addHabitSafe(tgId, name, emoji = '✨', color = '#5fb357') {
  // Нормализуем имя для сравнения
  const normalizedName = String(name || '').trim().slice(0, 60);
  if (!normalizedName) return { ok: false, error: 'empty name' };
  // Ищем существующую привычку (case-insensitive, String-safe)
  const lowerName = normalizedName.toLowerCase();
  const tgKey = String(tgId);
  for (const h of Object.values(db.habits)) {
    if (String(h.owner_id) === tgKey && h.name.toLowerCase() === lowerName) {
      return { ok: true, id: h.id, deduped: true };
    }
  }
  // Лимит 30 привычек
  const userHabits = getHabits(tgId);
  if (userHabits.length >= 30) {
    return { ok: false, error: 'limit 30' };
  }
  const id = uid();
  db.habits[id] = { id, owner_id: tgId, name: normalizedName, emoji, color, streak: 0, best: 0, created_at: Date.now() };
  return { ok: true, id, deduped: false };
}

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
// Только одна палитра — зелёный лес
const PALETTES = [
  { id: 'forest', label: '🌲 Зелёный лес' },
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
    q: 'Привет! Я — трекер привычек.\n\nВыбери привычки кнопками (можно несколько), затем нажми "Готово":\n\nА Вода\nБ Спорт\nВ Чтение\nГ Медитация\nД Сон 8ч\nЕ Прогулка\nЖ Без телефона\nЗ Учёба',
    options: {
      'А': 'water', 'Б': 'sport', 'В': 'read', 'Г': 'meditate',
      'Д': 'sleep', 'Е': 'walk', 'Ж': 'no_phone', 'З': 'study',
    },
    multi: true,
  },
  {
    key: 'name_reminder',
    q: 'Как тебя зовут и когда напоминать?\n\nА 08:00 Утро\nБ 13:00 День\nВ 19:00 Вечер\nГ 22:00 Поздно\nД Без напоминаний',
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
// TTL = 5 минут (вместо часа) — онбординг не должен длиться вечно
setInterval(() => {
  const now = Date.now();
  for (const [tgId, st] of onboardState) {
    if (st && st._ts && now - st._ts > 5 * 60 * 1000) {
      onboardState.delete(tgId);
      logger.debug(`Cleaned stale onboardState for ${tgId}`);
    }
  }
}, 60 * 1000); // Каждую минуту — быстрая очистка

// Безопасные хелперы для onboardState
function getObState(tgId) {
  const st = onboardState.get(tgId);
  if (!st) return null;
  // Проверяем TTL
  if (Date.now() - st._ts > 5 * 60 * 1000) {
    onboardState.delete(tgId);
    return null;
  }
  return st;
}
function setObState(tgId, partial) {
  const prev = onboardState.get(tgId) || {};
  onboardState.set(tgId, { ...prev, ...partial, _ts: Date.now() });
}
function clearObState(tgId) {
  onboardState.delete(tgId);
}

// Экспорт для тестов
if (process.env.NODE_ENV === 'test') {
  // ESM: используем глобальную переменную для тестов
  global.__testApi = {
    getObState, setObState, clearObState, onboardState,
    db, getUser, getHabits, getHabit, saveDB, loadDB, buildOnboardKeyboard,
    addHabitSafe,
  };
}

function pickPush(arr, name) {
  if (!arr || !arr.length) return { text: 'Пора отметить день!', btn: 'Отметить' };
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Достижения / Награды (заглушки) ----------
async function checkAchievementsOnCheck(ctx, tgId, habitId, streak, hour) {
  // Защита от undefined
  const u = db.users[String(tgId)];
  if (!u) return;
  // Первая отметка
  if (u.total_checks >= 1) giveAchievement(tgId, 'first_check');
  // Уровни (по общему числу отметок)
  if (u.total_checks >= 50) giveAchievement(tgId, 'level_5');
  if (u.total_checks >= 100) giveAchievement(tgId, 'level_10');
  if (u.total_checks >= 250) giveAchievement(tgId, 'level_25');
  // Достижения: ранняя пташка, ночная сова
  if (typeof hour === 'number') {
    if (hour >= 5 && hour < 9) giveAchievement(tgId, 'early_bird');
    if (hour >= 22 || hour < 4) giveAchievement(tgId, 'night_owl');
  }
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
  // Лимит: макс 100 достижений на юзера (защита от переполнения)
  const tgKey = String(tgId);
  const userCount = Object.values(db.achievements).filter(a => String(a.tg_id) === tgKey).length;
  if (userCount >= 100) return false;
  db.achievements[key] = { tg_id: tgId, code, date: todayKey() };
  saveDB();
  return true;
}
function giveReward(tgId, text) {
  // Заглушка — можно расширить для будущих фишек
  logger.info(`[REWARD] tg=${tgId}: ${text}`);
}
async function sendPush(tgId, push, cta = 'menu:today', extra = '') {
  // Защита от undefined tgId
  if (!tgId || !push || !push.text) {
    logger.warn('sendPush: missing tgId or push');
    return;
  }
  try {
    await bot.api.sendMessage(
      tgId,
      push.text + (extra ? '\n\n' + extra : ''),
      { reply_markup: { inline_keyboard: [[{ text: push.btn || 'OK', callback_data: cta }]] } }
    );
  } catch (e) { logger.error('sendPush failed', e); }
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
  const u = db.users[String(tgId)];
  const s = u && u.silent;
  if (!s || typeof s !== 'object') return false;
  // s = { from: '22:00', to: '08:00' } — формат HH:MM
  if (!s.from || !s.to) return false;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const fromParts = String(s.from).split(':');
  const toParts = String(s.to).split(':');
  if (fromParts.length !== 2 || toParts.length !== 2) return false;
  const fh = parseInt(fromParts[0], 10);
  const fm = parseInt(fromParts[1], 10);
  const th = parseInt(toParts[0], 10);
  const tm = parseInt(toParts[1], 10);
  if (isNaN(fh) || isNaN(fm) || isNaN(th) || isNaN(tm)) return false;
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
  return safeReply(ctx,
    'Команды:\n\n' +
    '/start — главное меню\n' +
    '/today — отметить привычки\n' +
    '/add Название — добавить привычку\n' +
    '/delete Название — удалить привычку\n' +
    '/stats — статистика\n' +
    '/challenge — челленджи\n' +
    '/silent 22:00 08:00 — тишина\n' +
    '/silent off — выключить тишину\n' +
    '/test — диагностика бота'
  );
});

bot.command('add', async (ctx) => {
  const text = ctx.message.text;
  let name = text.replace(/^\/add\s*/i, '').trim();
  if (!name) return safeReply(ctx, 'Формат: /add Название\nНапример: /add Пить воду');
  if (name.length > 60) return safeReply(ctx, 'Слишком длинное название (макс 60 символов)');
  if (getHabits(ctx.from.id).length >= 30) return safeReply(ctx, 'Лимит 30 привычек. Удали старые через /delete Название');

  // Извлечь emoji если первый символ — эмодзи
  let emoji = '✨';
  const emojiMatch = name.match(/^(\p{Extended_Pictographic})(?:\s+|$)/u);
  if (emojiMatch) {
    emoji = emojiMatch[1];
    name = name.replace(emojiMatch[0], '').trim();
  }

  // === Dedup через addHabitSafe ===
  const result = addHabitSafe(ctx.from.id, name, emoji, '#ff8906');
  if (!result.ok) {
    if (result.error === 'limit 30') return safeReply(ctx, 'Лимит 30 привычек. Удали старые через /delete');
    if (result.error === 'empty name') return safeReply(ctx, 'Формат: /add Название\nНапример: /add Пить воду');
  }
  saveDB();
  if (result.deduped) {
    return safeReply(ctx, `${emoji} «${name}» уже есть в твоём списке ✓`);
  }
  return safeReply(ctx, `Привычка ${emoji} «${name}» добавлена ✓\n\nОткрой в трекере или нажми /today`);
});

bot.command('delete', async (ctx) => {
  const text = ctx.message.text;
  const name = text.replace(/^\/delete\s*/i, '').trim();
  if (!name) return safeReply(ctx, 'Формат: /delete Название\nНапример: /delete Вода');
  const tgId = ctx.from.id;
  const habits = getHabits(tgId); // Используем безопасный helper
  const found = habits.find(h => h.name.toLowerCase() === name.toLowerCase());
  if (!found) return safeReply(ctx, `Не нашёл «${name}»\n\nТвои: ${habits.map(h => h.name).join(', ') || 'нет'}`);
  delete db.habits[found.id];
  // ВАЖНО: очищаем все чеки для этой привычки (избегаем утечки памяти)
  const prefix = found.id + '::';
  for (const k of Object.keys(db.checks)) {
    if (k.startsWith(prefix)) delete db.checks[k];
  }
  saveDB();
  return safeReply(ctx, `Удалил «${found.name}»`);
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
  if (!arg) return safeReply(ctx, 'Формат: /silent 22:00 08:00\nИли /silent off');
  if (arg === 'off') {
    const u = getUser(ctx.from.id);
    u.silent = null;
    saveDB();
    return safeReply(ctx, 'Режим тишины выключен.');
  }
  const m = arg.match(/^(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return safeReply(ctx, 'Формат: /silent 22:00 08:00');
  const fh = parseInt(m[1], 10);
  const fm = parseInt(m[2], 10);
  const th = parseInt(m[3], 10);
  const tm = parseInt(m[4], 10);
  // Валидация диапазонов
  if (fh < 0 || fh > 23 || fm < 0 || fm > 59 || th < 0 || th > 23 || tm < 0 || tm > 59) {
    return safeReply(ctx, 'Некорректное время. Формат: /silent 22:00 08:00');
  }
  const u = getUser(ctx.from.id);
  u.silent = { from: `${m[1].padStart(2,'0')}:${m[2]}`, to: `${m[3].padStart(2,'0')}:${m[4]}` };
  saveDB();
  return safeReply(ctx, `Тишина: с ${u.silent.from} до ${u.silent.to}. Бот не будет беспокоить в это время.`);
});

// Удалена неиспользуемая showStatsInline2 — заменена на showStatsInline

// ---------- Onboarding ----------
bot.command('start', async (ctx) => {
  logger.info(`CMD /start from ${ctx.from.id}`);
  const u = getUser(ctx.from.id);
  if (u.onboard_step >= 100) {
    logger.debug('Going to showMainMenu');
    const tgId = ctx.from.id;
    const habits = getHabits(tgId);
    const today = todayKey();
    const doneToday = habits.filter(h => isChecked(h.id, today)).length;
    const url = buildWebAppUrl(tgId);
    logger.debug(`URL length: ${url.length}, habits: ${habits.length}`);
    try {
      const r = await safeReply(ctx, 
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
      logger.debug('Sent OK');
      return r;
    } catch (e) {
      logger.error('SEND FAILED', e);
      throw e;
    }
  }
  // === ОНБОРДИНГ v2 — простой и надёжный ===
  // Используем безопасные helpers (TTL 5 мин)
  setObState(ctx.from.id, { step: 'pick_habits', picked: new Set() });
  u.onboard_step = 1;
  saveDB();

  // Создаём кнопки привычек
  return safeReply(ctx, ONBOARD[0].q, {
    reply_markup: { inline_keyboard: buildOnboardKeyboard(ctx.from.id) }
  });
});

// Построить клавиатуру онбординга
function buildOnboardKeyboard(tgId) {
  const st = getObState(tgId);
  const picked = st?.picked || new Set();
  const habitButtons = [];
  // Фиксированный порядок букв для UI
  const habitLetters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];
  for (let i = 0; i < habitLetters.length; i += 2) {
    const a = habitLetters[i], b = habitLetters[i+1];
    const aMark = picked.has(a) ? '✅ ' : '';
    const bMark = b && picked.has(b) ? '✅ ' : '';
    const aName = HABIT_NAMES[ONBOARD[0].options[a]]?.[1] || a;
    const bName = b ? HABIT_NAMES[ONBOARD[0].options[b]]?.[1] || b : null;
    const row = [{ text: `${aMark}${a} ${aName}`, callback_data: `ob_pick:${a}` }];
    if (b && bName) row.push({ text: `${bMark}${b} ${bName}`, callback_data: `ob_pick:${b}` });
    habitButtons.push(row);
  }
  habitButtons.push([
    { text: `✅ Готово (${picked.size})`, callback_data: 'ob_done' },
    { text: '⏭ Пропустить', callback_data: 'ob_skip' }
  ]);
  return habitButtons;
}

// === Команда сброса онбординга ===
bot.command('reset', async (ctx) => {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  // Сбросить онбординг
  u.onboard_step = 0;
  u.name = 'друг';
  // Очистить локальный state
  onboardState.delete(tgId);
  saveDB();
  logger.info(`CMD /reset from ${tgId}`);
  return safeReply(ctx, '🔄 Сброшено! Нажми /start чтобы начать заново.');
});


bot.command('test', async (ctx) => {
  logger.info(`CMD /test from ${ctx.from.id}`);
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  const habits = getHabits(tgId);
  const today = todayKey();
  const doneToday = habits.filter(h => isChecked(h.id, today)).length;

  // Собираем диагностику
  const lines = [
    '🧪 <b>Тестовая диагностика</b>',
    '',
    `👤 User ID: <code>${tgId}</code>`,
    `📛 Имя: ${u.name}`,
    `📊 Шаг онбординга: ${u.onboard_step}`,
    `🎨 Палитра: ${u.palette}`,
    `⏰ Напоминание: ${u.reminder_time}`,
    '',
    `📋 Всего привычек: ${habits.length}`,
    `✅ Отмечено сегодня: ${doneToday}/${habits.length}`,
    `🔥 Лучшая серия: ${u.best_streak} дней`,
    `📈 Всего отметок: ${u.total_checks}`,
    '',
    `🔧 Render: v51n`,
    `🤖 Webhook: активен`,
    `⏱ Uptime бота: ${Math.floor(process.uptime())} сек`,
    `💾 Память: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
  ];

  return safeReply(ctx, lines.join('\n'), { parse_mode: 'HTML' });
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  u.last_seen_at = Math.floor(Date.now() / 1000);
  saveDB();

  if (text.startsWith('/')) return handleCommand(ctx, text);

  // === WebApp sendData() — JSON события из Mini App ===
  // Когда WebApp открыт через кнопку бота, sendData() шлёт текст в чат
  if (text.startsWith('{') && text.includes('"action"')) {
    try {
      const event = JSON.parse(text);
      const action = event.action;
      logger.info(`WebApp event from ${tgId}: ${action}`);
      // Данные УЖЕ сохранены через /api/action (в этой же транзакции)
      // sendData — это просто "уведомление" для бота
      // Отвечаем только для важных действий
      switch (action) {
        case 'add_habit': {
          return safeReply(ctx, `✅ Привычка «${event.name || 'новая'}» добавлена!`);
        }
        case 'delete_habit': {
          return safeReply(ctx, `🗑 Привычка удалена`);
        }
        case 'set_name': {
          u.name = event.name || 'друг';
          saveDB();
          return safeReply(ctx, `👤 Имя: ${u.name}`);
        }
        case 'set_reminder': {
          u.reminder_time = event.value || '09:00';
          saveDB();
          return safeReply(ctx, `⏰ Напоминание: ${u.reminder_time}`);
        }
        case 'check':
        case 'check_challenge':
        case 'start_challenge':
          // Тихо — WebApp уже обновил UI
          return;
        default:
          // Неизвестное — игнорируем
          return;
      }
    } catch (e) {
      // Не JSON — обычное сообщение
    }
  }

  // === ОНБОРДИНГ v2 — упрощённый flow ===
  // Только ввод имени на финальном шаге (после выбора времени кнопкой)
  const st = getObState(tgId);

  // Если юзер сейчас на шаге ввода имени (после ob_rem)
  if (st && st.step === 'enter_name') {
    const name = text.trim().slice(0, 40) || 'друг';
    u.name = name;
    // Привычки уже созданы в ob_rem. Если нет — добавим дефолты через addHabitSafe (dedup)
    if (getHabits(tgId).length === 0) {
      const defaultHabits = ['water', 'walk', 'sleep'];
      for (const h of defaultHabits) {
        const info = HABIT_NAMES[h] || ['✨', h];
        addHabitSafe(tgId, info[1], info[0], '#5fb357');
      }
    }
    u.onboard_step = 100;
    clearObState(tgId);
    saveDB();
    const habitCount = getHabits(tgId).length;
    return safeReply(ctx,
      `Готово, ${name}! 🎉\n\n` +
      `У тебя ${habitCount} ${habitCount === 1 ? 'привычка' : (habitCount < 5 ? 'привычки' : 'привычек')}.\n\n` +
      `Напиши /today или открой приложение.`
    );
  }

  // Если юзер на любом шаге онбординга, но пишет текст — подскажем что делать
  if (st && (st.step === 'pick_habits' || st.step === 'pick_reminder')) {
    return safeReply(ctx, '👆 Используй кнопки выше для выбора.');
  }
  // Иначе — обычное сообщение, ничего не делаем
  return;
});

async function handleCommand(ctx, text) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  if (text === '/today') return showToday(ctx);
  if (text === '/stats') return showStats(ctx);
  if (text === '/help') return safeReply(ctx, 
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
  return safeReply(ctx, 
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
    return safeReply(ctx, 'Нет привычек. Нажми /start');
  }
  const today = todayKey();
  const rows = habits.map(h => {
    const done = isChecked(h.id, today);
    return [{ text: `${done ? '✅' : '⬜'} ${h.emoji || '📌'} ${h.name} (🔥${h.streak})`, callback_data: `toggle:${h.id}` }];
  });
  rows.push([{ text: '« Меню', callback_data: 'menu:main' }]);
  return safeReply(ctx, 'Отметь сегодня:', { reply_markup: { inline_keyboard: rows } });
}

async function showStats(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  const habits = getHabits(tgId);
  const total = habits.reduce((s, h) => s + (h.best || 0), 0);
  return safeReply(ctx, 
    `Статистика\n\nПривычек: ${habits.length}\nВсего отметок: ${u.total_checks}\nЛучшая серия за всё время: ${u.best_streak} дней`
  );
}

async function showChallengePicker(ctx) {
  const tgId = ctx.from.id;
  const tgKey = String(tgId);
  const myChallenges = Object.values(db.challenges).filter(c => String(c.owner_id) === tgKey);
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
  return safeReply(ctx, 'Выбери челендж:', { reply_markup: { inline_keyboard: rows } });
}

async function showSettingsInline(ctx) {
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  // Только время напоминания — палитра всегда зелёная
  const remRows = [];
  const keys = Object.keys(REMINDER);
  for (let i = 0; i < keys.length; i += 2) {
    const a = REMINDER[keys[i]], b = REMINDER[keys[i+1]];
    const row = [{ text: `${a.value === u.reminder_time ? '✓ ' : ''}${a.label}`, callback_data: `rem:${a.value}` }];
    if (b) row.push({ text: `${b.value === u.reminder_time ? '✓ ' : ''}${b.label}`, callback_data: `rem:${b.value}` });
    remRows.push(row);
  }
  const rows = [
    [{ text: '⏰ Напоминание', callback_data: 'noop' }],
    ...remRows,
    [{ text: '« Меню', callback_data: 'menu:main' }],
  ];
  return safeReply(ctx, '<b>⚙️ Настройки</b>\n\nВыбери палитру и время напоминания:', { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}

function buildWebAppUrl(tgId) {
  // Короткий URL — Telegram имеет лимит ~512 символов на web_app.url
  // v=40.9 — cache buster: при обновлении версии WebApp Telegram загрузит свежий
  return `${WEBAPP_URL}?tg_id=${tgId}&v=40.9`;
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
    // Палитра больше не выбирается — всегда зелёный
    return safeAnswerCb(ctx, 'Палитра фиксирована: 🌲 Зелёный лес');
  }
  if (data === 'menu:challenge') return showChallengePicker(ctx);
  if (data === 'menu:settings') return showSettingsInline(ctx);
  if (data === 'noop') return safeAnswerCb(ctx, '');

  // === Онбординг кнопки v2 — bulletproof ===
  if (data.startsWith('ob_pick:')) {
    const letter = data.slice(8);
    const habitKey = ONBOARD[0].options[letter];
    // Всегда отвечаем на callback — даже если state потерян
    if (!habitKey) {
      return safeAnswerCb(ctx, '⚠️ Сначала /start');
    }
    const st = getObState(tgId);
    if (!st || st.step !== 'pick_habits') {
      return safeAnswerCb(ctx, '⚠️ Сначала /start');
    }
    // Toggle привычку
    if (st.picked.has(letter)) {
      st.picked.delete(letter);
    } else {
      st.picked.add(letter);
    }
    setObState(tgId, { picked: st.picked });
    // Пытаемся обновить клавиатуру (безопасно, не падаем)
    try {
      await safeEditMarkup(ctx, { reply_markup: { inline_keyboard: buildOnboardKeyboard(tgId) } });
    } catch (e) {
      logger.debug('editMessageReplyMarkup failed', e.message);
    }
    return safeAnswerCb(ctx, `Выбрано: ${st.picked.size}`);
  }
  if (data === 'ob_done' || data === 'ob_skip') {
    const st = getObState(tgId);
    if (!st) {
      return safeAnswerCb(ctx, '⚠️ Сначала /start');
    }
    // Сохранить выбранные привычки (если есть picked)
    if (data === 'ob_done' && st.picked && st.picked.size > 0) {
      // Используем addHabitSafe — дедупликация по имени (case-insensitive)
      for (const letter of st.picked) {
        const habitKey = ONBOARD[0].options[letter];
        if (!habitKey) continue;
        const [emoji, name] = HABIT_NAMES[habitKey];
        if (!emoji || !name) continue;
        addHabitSafe(tgId, name, emoji, '#5fb357');
      }
    }
    // Переход к следующему шагу
    setObState(tgId, { step: 'pick_reminder' });
    u.onboard_step = 2;
    saveDB();
    // Показать кнопки времени напоминания (фиксированный порядок)
    const REMINDER_ORDER = ['А', 'Б', 'В', 'Г', 'Д'];
    const remButtons = REMINDER_ORDER.map(k => {
      const v = REMINDER[k];
      if (!v) return null;
      return [{ text: `${k} ${v.label}`, callback_data: `ob_rem:${k}` }];
    }).filter(Boolean);
    await safeAnswerCb(ctx, 'Сохранено ✓');
    return safeReply(ctx, ONBOARD[1].q, { reply_markup: { inline_keyboard: remButtons } });
  }
  if (data.startsWith('ob_rem:')) {
    const letter = data.slice(7);
    const rem = REMINDER[letter];
    if (!rem) return safeAnswerCb(ctx, '⚠️ Неверный выбор');
    u.reminder_time = rem.value;
    // Спросить имя (используем безопасный helper)
    setObState(tgId, { step: 'enter_name' });
    u.onboard_step = 3;
    saveDB();
    const remLabel = rem.value === 'off' ? 'Без напоминаний' : `В ${rem.value}`;
    return safeReply(ctx, `Время: ${remLabel} ✓\n\nТеперь напиши своё имя одним сообщением:`);
  }
  if (data.startsWith('rem:')) {
    const value = data.slice(4);
    const u = getUser(tgId);
    u.reminder_time = value;
    saveDB(); // Было save() — undefined function
    await safeAnswerCb(ctx, 'Напоминание сохранено');
    return showSettingsInline(ctx);
  }
  if (data.startsWith('pal:')) {
    u.palette = 'forest'; // Всегда зелёный
    saveDB();
    try { await safeEditText(ctx, '🌲 Зелёный лес (фиксировано)'); } catch (e) {}
    return safeAnswerCb(ctx, '🌲 Зелёный лес');
  }
  if (data.startsWith('toggle:')) {
    const habitId = data.slice(7);
    const h = getHabit(habitId, tgId);
    if (!h) return safeAnswerCb(ctx, 'Не найдено');
    const day = todayKey();
    const was = isChecked(habitId, day);
    setCheck(habitId, day, !was);
    if (!was) {
      // Считаем streak (от сегодня назад, локальное время!)
      let streak = 0;
      const nowD = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(habitId, key)) streak++;
        else if (i > 0) break; // Сегодня может быть пустым — это ОК
      }
      h.streak = streak;
      h.best = Math.max(h.best, streak);
      u.total_checks += 1;
      u.best_streak = Math.max(u.best_streak, streak);
      u.last_check_day = day;
      const hour = new Date().getHours();
      checkAchievementsOnCheck(ctx, tgId, habitId, streak, hour);
      // Награда за milestone
      if (streak === 7) { await safeReply(ctx, 'Неделя силы. Не останавливайся.'); giveReward(tgId, 'Неделя силы — 7 дней'); }
      if (streak === 30) { await safeReply(ctx, 'Месяц. Ты машина.'); giveReward(tgId, 'Месяц дисциплины — 30 дней'); }
      if (streak === 100) { await safeReply(ctx, '100 дней. Сказочное дерево.'); giveReward(tgId, 'Сказочное дерево — 100 дней'); }
    }
    saveDB();
    return showToday(ctx);
  }
  if (data.startsWith('cstart:')) {
    const cid = data.slice(6);
    const cat = CHALLENGES.find(c => c.id === cid);
    if (!cat) return safeAnswerCb(ctx, 'Не найдено');

    // Если челлендж со связкой привычек (selectable) — показать выбор
    if (cat.selectable && cat.habits) {
      // ВАЖНО: не передаём cid в callback — он хранится в onboardState
      // (Telegram ограничивает callback_data до 64 байт)
      onboardState.set(tgId, { step: 'pick_challenge_habits', challenge: cat, selected: new Set(), _ts: Date.now() });
      const rows = cat.habits.map((h, i) => [{
        text: `◯ ${h.emoji || '📌'} ${h.name}`,
        callback_data: `cph:${i}`,
      }]);
      rows.push([{ text: '✅ Готово — добавить выбранные', callback_data: `cph_done` }]);
      rows.push([{ text: '« Отмена', callback_data: 'menu:challenge' }]);
      return safeReply(ctx,
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
    await safeAnswerCb(ctx, 'Старт!');
    const replyRows = [];
    if (habitId) replyRows.push([{ text: '✅ Отметить сегодня', callback_data: `t:${habitId}` }]);
    replyRows.push([{ text: '📱 Открыть трекер', web_app: { url: buildWebAppUrl(tgId) } }]);
    replyRows.push([{ text: '🏠 Главное меню', callback_data: 'menu:main' }]);
    return safeReply(ctx, 
      `🚀 Старт: ${cat.emoji} ${cat.title}\n\n${cat.desc}\n\n${cat.habitName ? `📌 Привычка «${cat.habitEmoji} ${cat.habitName}» добавлена в твой список. ${cat.habitFreq === 'Каждые 2 дня' ? 'Отмечай через день.' : 'Отмечай каждый день.'}\n\n` : ''}${cat.days} дней. Поехали.`,
      { reply_markup: { inline_keyboard: replyRows } }
    );
  }

  // Toggle выбор привычки для связки (cid хранится в onboardState)
  if (data === 'cph' || data.startsWith('cph:')) {
    const idxStr = data === 'cph' ? '0' : data.split(':')[1];
    const idx = parseInt(idxStr);
    const st = onboardState.get(tgId);
    if (!st || st.step !== 'pick_challenge_habits') return safeAnswerCb(ctx, 'Отменено');
    if (idx >= 0 && idx < st.challenge.habits.length) {
      if (st.selected.has(idx)) st.selected.delete(idx);
      else st.selected.add(idx);
    }
    const cat = st.challenge;
    const rows = cat.habits.map((h, i) => [{
      text: `${st.selected.has(i) ? '✓' : '◯'} ${h.emoji || '📌'} ${h.name}`,
      callback_data: `cph:${i}`,
    }]);
    rows.push([{ text: `✅ Готово (${st.selected.size}/${cat.habits.length})`, callback_data: `cph_done` }]);
    rows.push([{ text: '« Отмена', callback_data: 'menu:challenge' }]);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: rows }); } catch {}
    return safeAnswerCb(ctx, '');
  }

  // Подтверждение выбора связки
  if (data === 'cph_done' || data.startsWith('cph_done:')) {
    // cid берём из onboardState (не из callback — лимит 64 байт)
    const st = onboardState.get(tgId);
    if (!st || st.step !== 'pick_challenge_habits') return safeAnswerCb(ctx, 'Отменено');
    const cat = st.challenge;
    if (st.selected.size === 0) return safeAnswerCb(ctx, 'Выбери хотя бы одну');
    // Создать челлендж
    const id = uid();
    db.challenges[id] = {
      id, owner_id: tgId, title: cat.title, emoji: cat.emoji,
      description: cat.desc, days: cat.days, color: cat.color,
      started_at: Math.floor(Date.now()/1000),
      ends_at: Math.floor(Date.now()/1000) + cat.days*86400,
      completed: 0, checkDays: 0,
    };
    // Создать выбранные привычки через addHabitSafe (dedup)
    const habitBtns = [];
    for (const i of st.selected) {
      const h = cat.habits[i];
      const result = addHabitSafe(tgId, h.name, h.emoji, cat.color);
      if (result.ok) {
        const habitId = result.id;
        if (db.habits[habitId]) {
          db.habits[habitId].category = 'challenge';
          db.habits[habitId].challengeId = id;
        }
        habitBtns.push([{ text: `${h.emoji || '📌'} ${h.name}`, callback_data: `t:${habitId}` }]);
      }
    }
    saveDB();
    onboardState.delete(tgId);
    await safeAnswerCb(ctx, 'Старт!');
    habitBtns.push([{ text: '📱 Открыть трекер', web_app: { url: buildWebAppUrl(tgId) } }]);
    habitBtns.push([{ text: '🏠 Главное меню', callback_data: 'menu:main' }]);
    return safeReply(ctx, 
      `🚀 Старт: ${cat.emoji} ${cat.title}\n\n${cat.desc}\n\n📌 Добавлено привычек: ${st.selected.size}. ${cat.days} дней. Поехали.`,
      { reply_markup: { inline_keyboard: habitBtns } }
    );
  }
});

// ---------- WebApp actions ----------
const VALID_PALETTES = new Set(['forest', 'sunset', 'ocean', 'lavender']); // Допустимые палитры
bot.on('message:web_app_data', async (ctx) => {
  let p;
  try { p = JSON.parse(ctx.message.web_app_data.data); } catch { return; }
  if (!p || typeof p !== 'object') return;
  const tgId = ctx.from.id;
  const u = getUser(tgId);
  if (p.action === 'set_palette' && p.palette) {
    // Валидация: только разрешённые палитры
    u.palette = VALID_PALETTES.has(p.palette) ? p.palette : 'forest';
    saveDB(); return;
  }
  if (p.action === 'set_profile' && p.name) {
    u.name = String(p.name).slice(0, 40);
    if (p.reminder_time && /^(\d{1,2}):(\d{2})$/.test(p.reminder_time)) {
      u.reminder_time = p.reminder_time;
    }
    saveDB(); return;
  }
  if (p.action === 'set_reminder' && p.reminder_time) {
    if (/^(\d{1,2}):(\d{2})$/.test(p.reminder_time)) {
      u.reminder_time = p.reminder_time;
      saveDB();
    }
    return;
  }
  if (p.action === 'toggle_habit' && p.habit_id) {
    const h = getHabit(p.habit_id, tgId);
    if (!h) return;
    const day = todayKey();
    const was = isChecked(p.habit_id, day);
    setCheck(p.habit_id, day, !was);
    if (!was) {
      // CHECK: отмечаем
      let streak = 0;
      const nowD = new Date();
      for (let i = 0; i < 365; i++) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(p.habit_id, key)) streak++;
        else if (i > 0) break; // Сегодня пуст — ОК
      }
      h.streak = streak; h.best = Math.max(h.best, streak);
      u.total_checks += 1; u.best_streak = Math.max(u.best_streak, streak); u.last_check_day = day;
      const hour = new Date().getHours();
      checkAchievementsOnCheck(null, tgId, p.habit_id, streak, hour);
    } else {
      // UNCHECK: снимаем отметку
      // Рекалькулировать streak (от вчера назад)
      let streak = 0;
      const nowD = new Date();
      for (let i = 1; i < 365; i++) {
        const d = new Date(nowD);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (isChecked(p.habit_id, key)) streak++; else break;
      }
      h.streak = streak;
      if (u.total_checks > 0) u.total_checks -= 1;
      // Проверим: остались ли отметки на сегодня у других привычек
      const userHabits = getHabits(tgId);
      // Защита: если 0 привычек, last_check_day = null (нет что отмечать)
      if (userHabits.length === 0) {
        u.last_check_day = null;
      } else {
        const allTodayDone = userHabits.every(xh => isChecked(xh.id, day));
        if (!allTodayDone) u.last_check_day = null;
      }
    }
    saveDB();
    return;
  }
  if (p.action === 'add_habit' && p.name) {
    // Dedup через addHabitSafe
    addHabitSafe(tgId, String(p.name), p.emoji || '✨', p.color || '#ff8906');
    saveDB();
    return;
  }
  if (p.action === 'delete_habit' && p.habit_id) {
    const h = getHabit(p.habit_id, tgId);
    if (h) {
      delete db.habits[p.habit_id];
      // Очистить связанные чеки (формат: id::YYYY-MM-DD)
      const prefix = p.habit_id + '::';
      for (const k of Object.keys(db.checks)) {
        if (k.startsWith(prefix)) delete db.checks[k];
      }
      // best_streak не должен уменьшаться при удалении (исторический максимум)
      // Поэтому НЕ пересчитываем — оставляем как есть
      saveDB();
    }
    return;
  }
  if (p.action === 'start_challenge' && p.challenge_id) {
    // ВАЖНО: дубликат с /api/action — но через sendData мы придём позже
    // Все данные уже созданы в /api/action (это PRIMARY путь)
    // sendData — это только уведомление для бота, ничего не создаём
    // (Иначе будут дубли челленджей)
    return;
  }
  if (p.action === 'check_challenge' && p.challenge_id) {
    // Также дублируется — данные уже в /api/action
    // Ничего не делаем, бот уже ответил через /api/action
    return;
  }
});

// ---------- Scheduler ----------
// Вызывается каждую минуту
setInterval(async () => {
  try {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${hh}:${mm}`;
    for (const tgId of Object.keys(db.users)) {
      try {
        const u = db.users[tgId];
        if (!u || u.onboard_step < 100) continue;
        if (isSilent(Number(tgId))) continue;
        // reminder_time может быть "08:00" или "off" — пропускаем off
        if (!u.reminder_time || u.reminder_time === 'off') continue;
        // ВАЖНО: пушим в нужный час (с окном 0-1 минута) — старый код требовал точное совпадение
        // Сейчас сравниваем только часы (любая минута в часе триггерит)
        const reminderHour = u.reminder_time.split(':')[0];
        if (reminderHour !== hh) continue;
        const key = `remind:${nowStr}:${u.reminder_time}`;
        if (wasSent(tgId, key)) continue;
        const habits = getHabits(Number(tgId));
        if (habits.length === 0) continue;
        // Пушим только если сегодня ещё НЕ все отмечены
        const day = todayKey();
        const done = habits.filter(h => isChecked(h.id, day)).length;
        if (done === habits.length) continue;
        let pool;
        if (u.reminder_time === '22:00' || u.reminder_time === '20:00') pool = PUSH.night;
        else if (u.reminder_time === '19:00') pool = PUSH.evening;
        else if (u.reminder_time === '13:00') pool = PUSH.day;
        else if (u.reminder_time === '08:00') pool = PUSH.morning;
        else pool = PUSH.bold;
        await sendPush(Number(tgId), pickPush(pool, u.name));
        markSent(tgId, key);
      } catch (e) {
        logger.error(`Scheduler error for user ${tgId}`, e.message);
      }
    }
    // 1 раз в день в 19:00 — comeback push
    if (nowStr === '19:00') {
      for (const tgId of Object.keys(db.users)) {
        try {
          const u = db.users[tgId];
          if (!u || u.onboard_step < 100) continue;
          if (isSilent(Number(tgId))) continue;
          const day = todayKey();
          const habits = getHabits(Number(tgId));
          const done = habits.filter(h => isChecked(h.id, day)).length;
          if (done === habits.length && habits.length > 0) continue;
          const last = u.last_seen_at || 0;
          const nowSec = Math.floor(Date.now() / 1000);
          if (nowSec - last < 2 * 86400) continue;
          const key = `comeback:${Math.floor(nowSec / 3600)}`;
          if (wasSent(tgId, key)) continue;
          const pool = nowSec - last > 5 * 86400 ? PUSH.long_away : PUSH.comeback;
          await sendPush(Number(tgId), pickPush(pool, u.name));
          markSent(tgId, key);
        } catch (e) {
          logger.error(`Comeback scheduler error for user ${tgId}`, e.message);
        }
      }
    }
  } catch (e) {
    logger.error('Scheduler tick failed', e);
  }
}, 60 * 1000);
// Очистка sentToday раз в сутки (по UTC), не каждый час — иначе дубли пушей
setInterval(() => { sentToday.clear(); }, 24 * 60 * 60 * 1000);

// ---------- HTTP API ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  // Только GET и POST разрешены для API
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', ...CORS, 'Allow': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Webhook endpoint для Telegram
  if (url.pathname === '/webhook' && req.method === 'POST') {
    try {
      let body = '';
      let totalSize = 0;
      const MAX_BODY = 1024 * 1024; // 1MB — Telegram updates редко больше
      for await (const chunk of req) {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY) {
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: 'payload too large' }));
          return;
        }
        body += chunk;
      }
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'empty body' }));
        return;
      }
      const update = JSON.parse(body);
      await bot.handleUpdate(update);
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end('{"ok":true}');
    } catch (e) {
      logger.error('Webhook error', e);
      res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'bad request' }));
    }
    return;
  }
  // === Serve WebApp (mini app) — единый деплой ===
  // GET / или /app или /index.html → отдаём встроенный WebApp
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/index.html' || url.pathname === '/mini')) {
    try {
      const path = await import('node:path');
      // Ищем webapp файл: ./public/index.html, ./webapp.html, ./index.html
      // В ESM нет __dirname, используем process.cwd()
      const candidates = [
        path.join(process.cwd(), 'public', 'index.html'),
        path.join(process.cwd(), 'webapp.html'),
        path.join(process.cwd(), 'index.html'),
      ];
      let content = null;
      let foundPath = null;
      for (const p of candidates) {
        try {
          if (existsSync(p)) {
            content = await fs.readFile(p);
            foundPath = p;
            break;
          }
        } catch (e) {}
      }
      if (content) {
        logger.debug(`Serving webapp from ${foundPath}`);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...CORS
        });
        res.end(content);
        return;
      }
      // Если файла нет — вернём простую страницу с диагностикой
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
      res.end(`<!DOCTYPE html><html><body style="background:#0f0c1d;color:#5fb357;font-family:sans-serif;padding:40px"><h1>🌱 Трекер привычек</h1><p>WebApp не найден. Искали в:</p><ul>${candidates.map(p => '<li><code>' + p + '</code></li>').join('')}</ul><p>CWD: <code>${process.cwd()}</code></p><p>Откройте из бота: <code>/start</code></p></body></html>`);
      return;
    } catch (e) {
      logger.error('Serve webapp failed', e);
      res.writeHead(500, { 'Content-Type': 'text/json', ...CORS });
      res.end(JSON.stringify({ error: e.message, stack: e.stack?.slice(0, 200) }));
      return;
    }
  }
  // === /diag — диагностика ===
  if (url.pathname === '/diag' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
    res.end(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Diag</title>
<style>body{font-family:sans-serif;background:#0f0c1d;color:#f0eef5;padding:20px}code{background:rgba(0,0,0,.4);padding:2px 6px;border-radius:4px}.ok{color:#2cb67d}.fail{color:#ff6b8b}</style>
</head><body>
<h1>🩺 Диагностика</h1>
<p>tg_id из URL: <code id="tgid">—</code></p>
<div id="results"></div>
<script>
const params = new URLSearchParams(location.search);
const tgId = params.get('tg_id');
document.getElementById('tgid').textContent = tgId || 'НЕТ';
const results = document.getElementById('results');
function add(name, ok, detail) {
  const d = document.createElement('div');
  d.className = ok ? 'ok' : 'fail';
  d.innerHTML = (ok ? '✅' : '❌') + ' ' + name + (detail ? '<br><small>' + detail + '</small>' : '');
  results.appendChild(d);
}
async function run() {
  if (!tgId) { add('tg_id', false, 'нет в URL'); return; }
  add('tg_id', true, tgId);
  try {
    const r = await fetch('/api/webapp-data?tg_id=' + tgId + '&_t=' + Date.now(), { cache: 'no-store' });
    add('API status', r.ok, 'HTTP ' + r.status);
    if (r.ok) {
      const d = await r.json();
      add('user.name', !!d.user?.name, d.user?.name || 'нет');
      add('habits', (d.habits?.length || 0) > 0, (d.habits?.length || 0) + ' привычек: ' + (d.habits || []).map(h => h.name).join(', '));
    }
  } catch (e) { add('fetch', false, e.message); }
}
run();
</script>
</body></html>`);
    return;
  }
  if (url.pathname === '/api/health') {
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({
      ok: true,
      users: Object.keys(db.users).length,
      habits: Object.keys(db.habits).length,
      uptime_sec: Math.floor(process.uptime()),
      memory_mb: Math.round(mem.heapUsed / 1024 / 1024),
      node: process.version,
    }));
    return;
  }
  if (url.pathname === '/api/webapp-data') {
    const tgId = parseInt(url.searchParams.get('tg_id') || '0');
    if (!tgId) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: 'missing tg_id' }));
      return;
    }
    // Автоматически создать юзера если его нет (для WebApp first-time)
    const tgKey = String(tgId);
    if (!db.users[tgKey]) {
      getUser(tgId); // Создаёт с дефолтами
      saveDB();
    }
    const u = db.users[tgKey];
    const habits = Object.values(db.habits).filter(h => String(h.owner_id) === tgKey);
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
      return { id: h.id, name: h.name, emoji: h.emoji, color: h.color, streak: h.streak || 0, best: h.best || 0, doneDays, totalChecks: doneCount, percent30: Math.round(doneCount/30*100) };
    });
    const doneToday = habitsWithStats.filter(h => h.doneDays.includes(today)).length;
    const payload = {
      user: { tg_id: tgId, name: u.name, best_streak: u.best_streak, total_checks: u.total_checks, palette: u.palette, reminder_time: u.reminder_time || '09:00' },
      today: { date: today, done: doneToday, total: habitsWithStats.length },
      stats: { avgPercent: habitsWithStats.length ? Math.round(habitsWithStats.reduce((s,h)=>s+h.percent30,0)/habitsWithStats.length) : 0, bestStreak: u.best_streak, totalChecks: u.total_checks },
      habits: habitsWithStats,
      challenges: Object.values(db.challenges || {}).filter(c => String(c.owner_id) === tgKey),
      achievements: Object.values(db.achievements || {}).filter(a => String(a.tg_id) === tgKey),
      challengeCatalog: CHALLENGES.map(c => ({
        id: c.id, title: c.title, emoji: c.emoji, shortDesc: c.shortDesc,
        description: c.desc,
        days: c.days, color: c.color, habitFreq: c.habitFreq,
        habitName: c.habitName, habitEmoji: c.habitEmoji,
        habits: c.habits, selectable: c.selectable,
      })),
      // updated_at — клиент может сравнить без парсинга
      _updated_at: db._updated_at || 0,
    };
    // === ETag для идеальной синхронизации ===
    // Хеш основан на user.name + habits + total_checks
    const habitsSorted = habitsWithStats.map(h => h.id + ':' + (h.streak || 0) + ':' + (h.doneDays?.length || 0)).sort().join('|');
    const etagRaw = `${u.name}|${u.total_checks}|${u.best_streak}|${u.palette}|${u.reminder_time}|${habitsSorted}|${doneToday}|${db._updated_at || 0}`;
    const crypto = await import('node:crypto');
    const etag = '"' + crypto.createHash('md5').update(etagRaw).digest('hex') + '"';
    // 304 Not Modified если клиент прислал тот же ETag
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === etag) {
      res.writeHead(304, { 'ETag': etag, ...CORS });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'ETag': etag,
      'Cache-Control': 'no-store, must-revalidate',
      ...CORS
    });
    res.end(JSON.stringify(payload));
    return;
  }

  // === POST /api/action — WebApp может менять данные напрямую ===
  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    const MAX_ACTION_BODY = 16 * 1024; // 16KB — челлендж с habits до 4 привычек
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_ACTION_BODY) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'payload too large' }));
      }
    });
    req.on('end', () => {
      let action = null;
      try { action = JSON.parse(body); } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      const tgId = parseInt(action.tg_id || 0);
      if (!tgId) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'missing tg_id' }));
        return;
      }
      if (!db.users[tgId]) getUser(tgId);
      const u = db.users[tgId];
      try {
        switch (action.type) {
          case 'check': {
            // toggle check
            const h = getHabit(action.habit_id, tgId);
            if (!h) throw new Error('habit not found');
            const day = action.date || todayKey();
            const was = isChecked(action.habit_id, day);
            setCheck(action.habit_id, day, !was);
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true, checked: !was }));
            return;
          }
          case 'add_habit': {
            const name = String(action.name || '').slice(0, 60).trim();
            if (!name) throw new Error('empty name');
            const emoji = String(action.emoji || '✨').slice(0, 4);
            // Dedup через addHabitSafe
            const result = addHabitSafe(tgId, name, emoji, '#5fb357');
            if (!result.ok) {
              if (result.error === 'limit 30') throw new Error('limit 30');
              throw new Error(result.error || 'add failed');
            }
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true, id: result.id, deduped: result.deduped }));
            return;
          }
          case 'delete_habit': {
            const h = getHabit(action.habit_id, tgId);
            if (!h) throw new Error('not found');
            delete db.habits[action.habit_id];
            // ВАЖНО: очищаем все чеки для удалённой привычки (избегаем утечки)
            const prefix = action.habit_id + '::';
            for (const k of Object.keys(db.checks)) {
              if (k.startsWith(prefix)) delete db.checks[k];
            }
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          case 'set_name': {
            u.name = String(action.name || 'друг').slice(0, 40);
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          case 'set_reminder': {
            u.reminder_time = String(action.value || '09:00');
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          case 'start_challenge': {
            // Найти каталог челленджа
            const cat = CHALLENGES.find(c => c.id === action.challenge_id);
            if (!cat) throw new Error('challenge not found');
            const tgKey = String(tgId);
            // Проверить — может уже есть активный
            const existing = Object.values(db.challenges || {}).find(c =>
              String(c.owner_id) === tgKey && c.title === cat.title && !c.completed
            );
            if (existing) {
              res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
              res.end(JSON.stringify({ ok: true, id: existing.id, deduped: true }));
              return;
            }
            // Создать челлендж
            const chId = uid();
            db.challenges[chId] = {
              id: chId, owner_id: tgId, catalog_id: cat.id,
              title: cat.title, emoji: cat.emoji, desc: cat.desc || cat.description,
              days: cat.days, color: cat.color, checkDays: 0, completed: 0,
              started_at: Date.now(),
            };
            // Создать привычки из челленджа (если есть) — addHabitSafe с dedup
            if (cat.habits && cat.habits.length) {
              for (const h of cat.habits) {
                addHabitSafe(tgId, h.name, h.emoji, cat.color);
              }
            } else if (cat.habitName) {
              addHabitSafe(tgId, cat.habitName, cat.habitEmoji, cat.color);
            }
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true, id: chId }));
            return;
          }
          case 'check_challenge': {
            const ch = db.challenges[action.challenge_id];
            if (!ch || String(ch.owner_id) !== String(tgId)) throw new Error('challenge not found');
            ch.checkDays = (ch.checkDays || 0) + 1;
            if (ch.checkDays >= ch.days) ch.completed = 1;
            saveDB();
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify({ ok: true, checkDays: ch.checkDays, completed: ch.completed }));
            return;
          }
          default:
            throw new Error('unknown action');
        }
      } catch (e) {
        // Проверяем, не отправлен ли уже ответ (при 413)
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(PORT, '0.0.0.0', () => logger.info(`HTTP API on :${PORT}`));

// ---------- Start ----------
// ВАЖНО: НЕ завершать процесс на unhandledRejection (Node 15+ поведение по умолчанию)
process.on('unhandledRejection', (reason, p) => {
  // Не падаем — просто логируем
  logger.critical('UNHANDLED REJECTION (ignored, process continues)', String(reason?.message || reason));
});
process.on('uncaughtException', (err) => {
  logger.critical('UNCAUGHT EXCEPTION (ignored, process continues)', err);
});
await loadDB();
logger.info('Трекер привычек bot started');
bot.catch((err, ctx) => {
  logger.error('=== BOT ERROR ===');
  logger.error('MSG:', err.message);
  if (ctx) {
    if (ctx.callbackQuery) {
      logger.error('TYPE: callback');
      logger.error('DATA:', ctx.callbackQuery.data);
      try { safeAnswerCb(ctx, 'Ошибка, попробуй ещё раз').catch(()=>{}); } catch {}
    }
    if (ctx.message) {
      logger.error('TYPE: message');
      logger.error('TEXT:', ctx.message.text);
    }
  }
  logger.error('STACK:', (err.stack || '').slice(0, 800));
});

// Запуск: webhook если задан WEBHOOK_URL, иначе polling
const WEBHOOK_URL = process.env.WEBHOOK_URL;
setImmediate(async () => {
  if (WEBHOOK_URL) {
    // Webhook режим — бот НЕ polling, Telegram шлёт updates на /webhook
    try {
      await bot.init(); // Нужен для handleUpdate
      logger.info(`Webhook mode: ${WEBHOOK_URL}/webhook`);
    } catch (e) {
      logger.critical('Bot init failed, webhook may not work', e.message);
    }
  } else {
    // Polling режим (по умолчанию)
    bot.start().catch((err) => {
      logger.critical('Bot polling failed, HTTP API continues', err.message);
    });
  }
});
