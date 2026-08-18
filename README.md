# 🌳 Трекер привычек — Telegram Bot

Персональный Telegram-бот + WebApp для отслеживания привычек, челленджей и достижений.

**Бот:** [@treker_habits_pro_bot](https://t.me/treker_habits_pro_bot)
**Render:** https://habit-tracker-bot-v51n.onrender.com
**WebApp:** https://mz5l4ub2zk6ws.space.minimax.io

## ✨ Возможности

- 📊 **Главная** — ежедневные привычки, растущее дерево прогресса
- 📈 **Статистика** — donut chart, 30 дней активности, календарь
- 🏆 **Награды** — 16 достижений (streak, levels, early bird, night owl)
- 🎯 **Челленджи** — 23 челленджа на 21/30/50/75/100/365 дней
- ⚙️ **Настройки** — время напоминания
- 🔔 **Уведомления** — ежедневные напоминания
- 🟢 **Синхронизация** — данные обновляются в WebApp каждые 5 сек

## 🛠 Стек

- **Backend:** Node.js 22 + Grammy
- **Storage:** JSON-файл (data.json)
- **WebApp:** vanilla HTML/CSS/JS
- **HTTP API:** нативный `http` модуль
- **Webhook mode** — мгновенный ответ от Telegram
- **Deploy:** Docker + Render + GitHub Actions

## 🚀 Деплой

См. [RENDER_DEPLOY.md](./RENDER_DEPLOY.md) для подробной инструкции.

### Краткий план:
1. Создать репо на GitHub
2. Залить 7 файлов
3. На [render.com](https://render.com) → New Web Service
4. Подключить репо
5. **Runtime:** Docker
6. **Env vars:** `BOT_TOKEN`, `WEBAPP_URL`, `PORT`, `WEBHOOK_URL`
7. **Create Web Service**

## 📊 API

- `GET /api/health` — health check
- `GET /api/webapp-data?tg_id=X` — данные пользователя
- `POST /webhook` — Telegram updates

## 🔧 Переменные окружения

| Key | Описание |
|-----|----------|
| `BOT_TOKEN` | Токен от @BotFather |
| `WEBAPP_URL` | URL где задеплоен WebApp |
| `PORT` | Порт HTTP API (10000) |
| `WEBHOOK_URL` | URL Render (для webhook режима) |
| `LOG_LEVEL` | debug/info/warning/error/critical |

## 📝 Команды бота

- `/start` — приветствие + кнопка WebApp
- `/add <название>` — добавить привычку
- `/delete <название>` — удалить
- `/today` — отметить на сегодня
- `/stats` — статистика
- `/challenge` — челленджи
- `/silent` — тихий режим
- `/help` — справка

## 🔄 Автодеплой

При push в `main`:
1. GitHub Actions триггерит Render Deploy API
2. Render пересобирает Docker-образ
3. Новый код за 2-3 минуты

## 📜 Лицензия

ISC
