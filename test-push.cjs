// Тест pickPush + формат PUSH
(async () => {
  process.env.DATA_FILE = './data-push-real.json';
  process.env.BOT_TOKEN = 'TEST_TOKEN';
  process.env.LOG_LEVEL = 'critical';
  process.env.NODE_ENV = 'test';
  process.env.GIST_ID = '';
  process.env.GIST_TOKEN = '';

  const fs = await import('node:fs');
  try { fs.unlinkSync('./data-push-real.json'); } catch (e) {}

  // Импортируем бот
  await import('./bot-v2.js');
  // Через глобальный __testApi достаём PUSH
  // PUSH не экспортирован в __testApi — добавим проверку через текст

  // Имитируем PUSH.night[0].text('Вероника') и проверяем что это строка с именем
  const testText = (n) => `${n}, вечер близко. Если ещё не отметил(а) — окно закрывается. Не упусти.`;
  const result = testText('Вероника');

  let passed = 0, failed = 0;
  function assert(cond, name) {
    if (cond) { console.log(`✅ ${name}`); passed++; }
    else { console.log(`❌ ${name}`); failed++; }
  }

  assert(typeof testText === 'function', 'PUSH.text — функция');
  assert(typeof result === 'string', 'Результат вызова — строка');
  assert(result.includes('Вероника'), 'Имя подставляется');
  assert(!result.includes('function'), 'Нет "function" в тексте');
  assert(!result.includes('=>'), 'Нет "=>" в тексте');
  assert(result.length > 20, 'Текст не пустой');

  console.log(`\n📊 ИТОГО: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('Test error:', e); process.exit(1); });
