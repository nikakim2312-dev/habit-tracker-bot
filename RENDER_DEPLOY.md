# 🚀 Полная инструкция: Деплой на Render

## 📋 Что понадобится

✅ GitHub аккаунт (https://github.com)
✅ Аккаунт на Render (https://render.com — регистрация через GitHub)
✅ 5-10 минут времени

---

## Шаг 1: Создать репозиторий на GitHub

1. Открой **https://github.com/new**
2. Заполни форму:
   ```
   Repository name:  habit-tracker-bot
   Description:      Telegram habit tracker bot with WebApp
   Public:           ✅ ВЫБЕРИ ЭТО
   ```
3. ❌ **НЕ** ставь галочки:
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license
4. Нажми **Create repository**

---

## Шаг 2: Залить файлы в репозиторий

### Вариант A: Через веб-интерфейс GitHub (рекомендую для новичков)

1. На странице нового репо нажми ссылку **uploading an existing file**
2. Открой папку `habit-bot-render-package` (из архива что я отправил)
3. Перетащи **ВСЕ 7 файлов** из неё в окно браузера:
   - `bot-v2.js`
   - `package.json`
   - `Dockerfile`
   - `.gitignore`
   - `.env.example`
   - `README.md`
   - `SETUP.md`
4. **Commit message:** `Initial commit`
5. Нажми **Commit changes**

### Вариант B: Через push.sh (если у тебя есть токен)

```bash
cd habit-tracker-bot
chmod +x push.sh
./push.sh ТВОЙ-ЛОГИН habit-tracker-bot "Initial commit"
```

Скрипт сам попросит токен и запушит.

---

## Шаг 3: Создать Web Service на Render

1. Открой **https://dashboard.render.com**
2. Нажми **New +** (синяя кнопка вверху справа)
3. Выбери **Web Service**
4. В разделе **GitHub Account** найди свой репозиторий `habit-tracker-bot`
   - Если не видишь — нажми **Configure account** → разреши доступ к репо
5. Нажми **Connect** справа от `habit-tracker-bot`

---

## Шаг 4: Заполнить настройки

На странице конфигурации:

| Поле | Значение |
|------|----------|
| **Name** | `habit-tracker-bot` |
| **Region** | `Frankfurt` (ближе к РФ) |
| **Branch** | `main` |
| **Root Directory** | (оставь пустым) |
| **Runtime** | **`Docker`** ⚠️ ВАЖНО! |
| **Instance Type** | **`Free`** (0$/мес) |

---

## Шаг 5: Environment Variables

Прокрути вниз до **Environment Variables** и нажми **Add Environment Variable** 3 раза:

### Переменная 1
```
Key:    BOT_TOKEN
Value:  8989431839:AAGVkTqJ7_cws8PAqhGuVI_VjshWe09PUVI
```

### Переменная 2
```
Key:    WEBAPP_URL
Value:  https://sqjtv3ndd0zzt.space.minimax.io
```

### Переменная 3
```
Key:    PORT
Value:  10000
```

### Переменная 4 (опционально — webhook режим)
```
Key:    WEBHOOK_URL
Value:  https://habit-tracker-bot-v51n.onrender.com
```

*(опционально)*
```
Key:    LOG_LEVEL
Value:  info
```

**Примечание:** Если задан `WEBHOOK_URL`, бот работает в webhook-режиме (Telegram сам шлёт updates на сервер). Если не задан — polling каждые 30 сек. Webhook надёжнее на Free плане.

---

## Шаг 6: Advanced Settings (опционально)

Нажми **Advanced** если хочешь настроить:
- **Health Check Path:** `/api/health` (для мониторинга Render)

Остальное оставь по умолчанию.

---

## Шаг 7: Deploy

Прокрути в самый низ → нажми **Create Web Service**

⏳ **Жди 2-3 минуты**. Render:
1. Склонирует репозиторий
2. Соберёт Docker-образ
3. Установит зависимости
4. Запустит бота

В логах должно появиться:
```
[INFO] Трекер привычек bot started
[INFO] HTTP API on :10000
[INFO] Bot polling started
```

Когда статус станет 🟢 **Live** — готово!

---

## Шаг 8: Получить URL

В самом верху страницы будет URL типа:
```
https://habit-tracker-bot-xxxx.onrender.com
```

**Скопируй его!**

---

## Шаг 9: Проверить работу

### Проверка 1: Health endpoint
Открой в браузере:
```
https://habit-tracker-bot-xxxx.onrender.com/api/health
```

Должно вернуть JSON:
```json
{
  "ok": true,
  "users": 1,
  "habits": 0,
  "uptime_sec": 42,
  "memory_mb": 18,
  "node": "v22.x.x"
}
```

### Проверка 2: Telegram
1. Открой Telegram
2. Найди бота: **@treker_habits_pro_bot**
3. Нажми `/start`
4. Должна появиться кнопка **📱 Открыть трекер**
5. Нажми — WebApp откроется

### Проверка 3: WebApp
- В WebApp должно быть имя (по умолчанию "друг")
- Можно добавить привычку
- Видна статистика (если есть отметки)

---

## 🔧 Что делать после первого деплоя

### Обновить WebApp URL в bot
Render URL может использоваться ботом для API. Если хочешь:

1. Render → твой сервис → **Environment**
2. Измени `WEBAPP_URL` на свой Render URL
3. **Save Changes** → автопередеплой

### Настроить мониторинг (чтобы бот не засыпал)

1. Открой **https://uptimerobot.com** (бесплатно)
2. Sign Up → подтверди email
3. **+ Add New Monitor**:
   - **Type:** HTTP(s)
   - **URL:** `https://habit-tracker-bot-xxxx.onrender.com/api/health`
   - **Interval:** 5 minutes
4. **Create Monitor**

Теперь бот не будет засыпать!

---

## ⚠️ Частые проблемы

### "Build failed"
- Проверь что `Dockerfile` залит в репо (в корне, не в подпапке)
- Проверь что `package.json` есть и содержит `grammy`

### "Application error"
- Открой вкладку **Logs** в Render
- Прочитай последние 20-30 строк
- Скинь мне — разберёмся

### "Bot not responding in Telegram"
- Проверь `BOT_TOKEN` в Environment Variables (без лишних пробелов)
- В логах должно быть `Bot polling started`

### "WebApp shows 'Друг' / 0%"
- WebApp не получил данные с API
- Проверь что `WEBAPP_URL` правильный
- Открой в браузере `/api/health` — должен ответить

### "CORS error" в браузере
- Render автоматически добавляет HTTPS
- В коде уже есть CORS headers
- Если ошибка — перезагрузи WebApp (Ctrl+Shift+R)

---

## 🔄 Как обновить код после изменений

### Через Git push:
```bash
cd habit-tracker-bot
# Внеси изменения
git add .
git commit -m "Fix something"
git push
# Render автоматически задеплоит через 1-2 мин
```

### Или вручную на Render:
1. Внеси изменения в GitHub (через веб-интерфейс)
2. Render → сервис → **Manual Deploy** → **Clear build cache & deploy**

---

## 💰 Стоимость

| План | Цена | Ограничения |
|------|------|-------------|
| **Free** | 0$ | Засыпает через 15 мин, нет persistent disk |
| **Starter** | 7$/мес | 24/7, persistent disk |

Для личного использования Free достаточно. Если хочешь 24/7 без засыпания — Starter.

---

## 🆘 Нужна помощь?

Скинь:
- Скрин ошибки
- Логи Render (вкладка Logs)
- На каком шаге застряла

Разберёмся! 💪

---

## 📊 Итоговая структура проекта

```
habit-tracker-bot/         (GitHub repo)
├── bot-v2.js              (66 КБ — основной код)
├── package.json           (зависимости)
├── Dockerfile             (Docker-конфиг)
├── .gitignore             (игнорирует .env, data.json)
├── .env.example           (шаблон env vars)
├── README.md              (описание)
└── SETUP.md               (подробная инструкция)

После деплоя:
└── https://habit-tracker-bot-xxxx.onrender.com
    ├── /api/health        (health check)
    ├── /api/webapp-data   (data для WebApp)
    └── WebApp доступен
```

Готово! 🎉
