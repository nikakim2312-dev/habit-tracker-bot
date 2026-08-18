// Интеграционный тест онбординга v2
const fs = require('fs');
const path = require('path');

(async () => {
  const TEST_DATA = path.join(__dirname, 'data-onboard-test.json');
  try { fs.unlinkSync(TEST_DATA); } catch (e) {}

  process.env.DATA_FILE = TEST_DATA;
  process.env.BOT_TOKEN = 'TEST_TOKEN';
  process.env.LOG_LEVEL = 'critical';
  process.env.NODE_ENV = 'test';

  // Динамически загружаем бот (он ESM)
  await import('./test-bot.js');
  // Достаём API через global
  const api = global.__testApi;
  if (!api) {
    console.error('❌ global.__testApi не найден — NODE_ENV=test не сработал');
    process.exit(1);
  }
  const { getObState, setObState, clearObState, buildOnboardKeyboard, getUser, db, getHabits, saveDB } = api;

  let passed = 0, failed = 0;
  function assert(cond, name) {
    if (cond) { console.log(`✅ ${name}`); passed++; }
    else { console.log(`❌ ${name}`); failed++; }
  }

  const tgId = 123456;
  console.log('\n🧪 ОНБОРДИНГ v2 — ИНТЕГРАЦИОННЫЕ ТЕСТЫ\n');

  // 1
  clearObState(tgId);
  assert(getObState(tgId) === null, '1.1 Нет state после clear');

  // 2
  setObState(tgId, { step: 'pick_habits', picked: new Set() });
  const st1 = getObState(tgId);
  assert(st1 !== null, '2.1 State создан');
  assert(st1.step === 'pick_habits', '2.2 step = pick_habits');
  assert(st1.picked instanceof Set, '2.3 picked это Set');

  // 3
  setObState(tgId, { picked: new Set(['А', 'В']) });
  const st2 = getObState(tgId);
  assert(st2.picked.has('А'), '3.1 А в picked');
  assert(st2.picked.has('В'), '3.2 В в picked');
  assert(st2.step === 'pick_habits', '3.3 step сохранился');

  // 4
  const kb = buildOnboardKeyboard(tgId);
  assert(Array.isArray(kb), '4.1 kb это массив');
  assert(kb.length === 5, '4.2 5 рядов (4 привычки + 1 done)');
  const lastRow = kb[kb.length - 1];
  assert(lastRow[0].text.includes('✅ Готово'), '4.3 кнопка Готово');
  assert(lastRow[0].text.includes('(2)'), '4.4 счётчик (2)');
  assert(lastRow[1].text === '⏭ Пропустить', '4.5 кнопка Пропустить');

  // 5
  clearObState(tgId);
  const u = getUser(tgId);
  assert(u !== null, '5.1 User создан');
  assert(u.palette === 'forest', '5.2 default palette = forest');
  assert(u.name === 'друг', '5.3 default name = друг');

  // 6 — TTL работает через getObState (а не setObState, который обновляет _ts)
  // Используем прямой onboardState.set
  clearObState(tgId);
  const { onboardState } = api;
  onboardState.set(tgId, { step: 'pick_habits', picked: new Set(), _ts: Date.now() - 10 * 60 * 1000 });
  assert(getObState(tgId) === null, '6.1 State с TTL > 5 мин удаляется при getObState');

  // 7
  clearObState(tgId);
  setObState(tgId, { step: 'pick_habits', picked: new Set(['А', 'Б', 'Г']) });
  const stDone = getObState(tgId);
  if (stDone?.picked?.size > 0) {
    for (const letter of stDone.picked) {
      const habitKey = { 'А': 'water', 'Б': 'sport', 'В': 'read', 'Г': 'meditate' }[letter];
      if (!habitKey) continue;
      const id = 'test_' + Math.random().toString(36).slice(2, 8);
      db.habits[id] = { id, owner_id: tgId, name: 'Test', emoji: '✨', color: '#5fb357', streak: 0, best: 0, created_at: Date.now() };
    }
  }
  saveDB();
  const habits = getHabits(tgId);
  assert(habits.length === 3, '7.1 Создано 3 привычки');

  // 8
  setObState(tgId, { step: 'pick_reminder' });
  const stRem = getObState(tgId);
  assert(stRem.step === 'pick_reminder', '8.1 step обновился');

  console.log(`\n📊 ИТОГО: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
