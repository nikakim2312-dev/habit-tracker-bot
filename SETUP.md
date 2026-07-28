# 📖 Пошаговый деплой на Render

## Что понадобится

✅ Аккаунт на [github.com](https://github.com) (бесплатно)
✅ Аккаунт на [render.com](https://render.com) (через GitHub, бесплатно)
✅ **5-10 минут** времени

---

## Шаг 1 — Создать репозиторий на GitHub

1. Открой [github.com/new](https://github.com/new)
2. Заполни форму:
   - **Repository name:** `habit-tracker-bot`
   - **Description:** `Telegram habit tracker bot with WebApp`
   - **Public** ← выбери это
3. ❌ **НЕ** ставь галочки "Add README", "Add .gitignore", "Choose a license"
4. Нажми **Create repository**

---

## Шаг 2 — Залить файлы

На открывшейся странице репо увидишь:
> Quick setup — if you've done this kind of thing before
> …or create a new file on the command line
> …**or upload an existing file** ← нажми эту ссылку

Откроется страница загрузки:

1. **Перетащи** в большое окно **ZIP-файл** `habit-tracker-render.zip` (или все файлы из распакованной папки)
2. **Commit message:** напиши `Initial commit`
3. Нажми зелёную кнопку **Commit changes**

✅ Файлы залиты. Через 30 секунд увидишь их в репо.

---

## Шаг 3 — Зарегистрироваться на Render

1. Открой [render.com](https://render.com)
2. Нажми **Get Started for Free**
3. Нажми **Sign up with GitHub** ← самый быстрый способ
4. Подтверди доступ (нажми **Authorize**)

---

## Шаг 4 — Создать Web Service

На дашборде Render:

1. Нажми **New +** (синяя кнопка вверху справа)
2. Выбери **Web Service**
3. В разделе **GitHub Account** найди свой репо `habit-tracker-bot`
4. Нажми **Connect** справа от него

---

## Шаг 5 — Заполнить настройки

На странице конфигурации заполни каждое поле:

| Поле | Что писать |
|------|-----------|
| **Name** | `habit-tracker-bot` |
| **Region** | `Frankfurt` (ближе к РФ, выбери из списка) |
| **Branch** | `main` |
| **Runtime** | **Docker** ← выбери из выпадающего списка! |
| **Instance Type** | **Free** ← выбери radio button |

---

## Шаг 6 — Environment Variables

Прокрути вниз до раздела **Environment Variables**.

Нажми **Add Environment Variable** и добавь **3 переменные**:

### Переменная 1
```
Key:    BOT_TOKEN
Value:  8989431839:AAGVkTqJ7_cws8PAqhGuVI_VjshWe09PUVI
```

### Переменная 2
```
Key:    WEBAPP_URL
Value:  https://xspjdovv46lcb.space.minimax.io
```

### Переменная 3
```
Key:    PORT
Value:  10000
```

---

## Шаг 7 — Deploy

Прокрути в самый низ страницы. Нажми синюю кнопку:

**Create Web Service**

⏳ **Жди 2-3 минуты**. Render:
1. Склонирует репо
2. Соберёт Docker-образ
3. Установит зависимости
4. Запустит бота

В логах увидишь:
```
Cloning from GitHub...
Building Docker image...
npm install
> grammy@1.45.1 added 47 packages
> node bot-v2.js
Трекер привычек bot started
Bot polling started
HTTP API on :10000
```

Когда статус вверху станет зелёным **Live** — готово! 🎉

---

## Шаг 8 — Получить URL

В самом верху страницы будет URL:
```
https://habit-tracker-bot-xxxx.onrender.com
```

**Скопируй его** — это публичный адрес твоего бота.

---

## Шаг 9 — Проверить

### Проверка 1: HTTP API
Открой в браузере:
```
https://habit-tracker-bot-xxxx.onrender.com/api/health
```
Должно вернуть:
```json
{"ok":true,"users":3}
```

### Проверка 2: Telegram
1. Открой Telegram
2. Найди `@treker_habits_pro_bot`
3. Нажми `/start`
4. Должна появиться кнопка **📱 Открыть трекер**
5. Нажми — WebApp откроется 🎉

---

## ⚠️ Важно про Free план

**Засыпание:**
- Через 15 минут без запросов сервис засыпает
- Просыпается за 30-50 секунд при новом запросе
- Для бота это не критично — ты жмёшь `/start`, бот просыпается

**Данные:**
- Free план имеет **ephemeral disk** — `data.json` стирается при редеплое
- **Решение:** сохранять данные в Supabase / Upstash Redis (бесплатно)

**Как не дать заснуть:**
- Подключи [UptimeRobot](https://uptimerobot.com) — пингует `/api/health` каждые 14 минут

---

## 🔧 Частые проблемы

| Проблема | Решение |
|----------|---------|
| **Build failed** | Проверь что `Dockerfile` залит в репо |
| **Module not found** | Убедись что `package.json` правильный |
| **Bot not responding** | Проверь `BOT_TOKEN` (без лишних пробелов) |
| **WebApp not opening** | Проверь `WEBAPP_URL` доступен в браузере |
| **Application error** | Открой вкладку **Logs** в Render, прочитай ошибку |

---

## 🎉 Готово!

Бот работает 24/7 на Render. Через 2 недели попробуй [Starter план](https://render.com/pricing) за $7/мес — бот не будет засыпать, и данные не потеряются.

---

## 🆘 Если что-то не работает

Скинь мне:
- Скрин ошибки
- Текст из вкладки **Logs**
- На каком шаге застряла

Разберёмся! 💪
