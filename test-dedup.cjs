// Тест дедупликации addHabitSafe
const fs = require('fs');
const path = require('path');

(async () => {
  const TEST_DATA = path.join(__dirname, 'data-dedup-test.json');
  try { fs.unlinkSync(TEST_DATA); } catch (e) {}

  process.env.DATA_FILE = TEST_DATA;
  process.env.BOT_TOKEN = 'TEST';
  process.env.LOG_LEVEL = 'critical';
  process.env.NODE_ENV = 'test';
  process.env.GIST_ID = '';
  process.env.GIST_TOKEN = '';

  await import('./bot-v2.js');
  const api = global.__testApi;
  const { addHabitSafe, getHabits } = api;
  const tgId = 888888;

  let passed = 0, failed = 0;
  function assert(cond, name) {
    if (cond) { console.log(`✅ ${name}`); passed++; }
    else { console.log(`❌ ${name}`); failed++; }
  }

  console.log('\n🧪 ТЕСТ ДЕДУПЛИКАЦИИ\n');

  // 1. Первое добавление
  const r1 = addHabitSafe(tgId, 'Вода', '💧');
  assert(r1.ok === true, '1.1 Первое добавление успешно');
  assert(r1.deduped === false, '1.2 deduped=false');
  assert(getHabits(tgId).length === 1, '1.3 1 привычка');

  // 2. Повторное добавление (то же имя)
  const r2 = addHabitSafe(tgId, 'Вода', '💧');
  assert(r2.ok === true, '2.1 Повторное — ok');
  assert(r2.deduped === true, '2.2 deduped=true (был дубль)');
  assert(r2.id === r1.id, '2.3 Тот же ID');
  assert(getHabits(tgId).length === 1, '2.4 Всё ещё 1 привычка');

  // 3. Регистр не важен
  const r3 = addHabitSafe(tgId, 'ВОДА', '💧');
  assert(r3.deduped === true, '3.1 Регистр игнорируется');
  assert(getHabits(tgId).length === 1, '3.2 Всё ещё 1');

  // 4. С пробелами
  const r4 = addHabitSafe(tgId, '  Вода  ', '💧');
  assert(r4.deduped === true, '4.1 Пробелы trim');
  assert(getHabits(tgId).length === 1, '4.2 Всё ещё 1');

  // 5. Другое имя
  const r5 = addHabitSafe(tgId, 'Спорт', '🏃');
  assert(r5.deduped === false, '5.1 Новое имя — deduped=false');
  assert(getHabits(tgId).length === 2, '5.2 2 привычки');

  // 6. Лимит 30
  for (let i = 0; i < 30; i++) {
    addHabitSafe(tgId, 'Test' + i, '✨');
  }
  assert(getHabits(tgId).length === 30, '6.1 Ровно 30 привычек');
  const r6 = addHabitSafe(tgId, 'Test30', '✨');
  assert(r6.ok === false, '6.2 Лимит — отказ');
  assert(r6.error === 'limit 30', '6.3 error=limit 30');

  // 7. Empty name
  const r7 = addHabitSafe(tgId, '', '✨');
  assert(r7.ok === false, '7.1 Пустое имя — отказ');
  assert(r7.error === 'empty name', '7.2 error=empty name');

  console.log(`\n📊 ИТОГО: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('Test error:', e); process.exit(1); });
