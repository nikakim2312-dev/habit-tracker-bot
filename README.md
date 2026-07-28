# 🌳 Трекер привычек — Telegram Bot

Персональный Telegram-бот + WebApp для отслеживания привычек, челленджей и достижений.

**Бот:** [@treker_habits_pro_bot](https://t.me/treker_habits_pro_bot)
**WebApp:** https://xspjdovv46lcb.space.minimax.io

## ✨ Возможности

- 📊 **Главная** — ежедневные привычки, растущее дерево прогресса
- 📈 **Статистика** — donut chart, 30 дней активности, календарь
- 🏆 **Награды** — 16 достижений (streak, levels, early bird, night owl)
- 🎯 **Челленджи** — 23 челленджа на 21/30/50/75/100/365 дней
- ⚙️ **Настройки** — 4 зелёные палитры, время напоминания
- 🔔 **Уведомления** — ежедневные напоминания о привычках

## 🛠 Стек

- **Backend:** Node.js 18+ + Grammy (Telegram Bot Framework)
- **Storage:** JSON-файл (data.json) — без БД
- **WebApp:** vanilla HTML/CSS/JS
- **HTTP API:** нативный `http` модуль
- **Deploy:** Docker / Render / любой VPS

## 🚀 Быстрый старт

### Локально

```bash
# Установить зависимости
npm install

# Скопировать и заполнить .env
cp .env.example .env
# Вписать BOT_TOKEN

# Запустить
npm start
```

### Docker

```bash
docker build -t habit-bot .
docker run -d --name habit-bot \
  -e BOT_TOKEN=your_token \
  -e WEBAPP_URL=https://your-app.com \
  -p 10000:10000 \
  -v $(pwd)/data.json:/app/data.json \
  habit-bot
```

### Render (бесплатно)

См. подробную инструкцию в [SETUP.md](./SETUP.md).

## 📁 Структура

```
.
├── bot-v2.js          # Бот + HTTP API (~1400 строк)
├── package.json       # Зависимости (только grammy)
├── package-lock.json  # Lock-файл
├── Dockerfile         # node:22-alpine
├── data.json          # Хранилище (создаётся автоматически)
├── .env.example       # Шаблон переменных окружения
├── .gitignore         # Игнорирует .env, data.json, node_modules
├── README.md          # Этот файл
└── SETUP.md           # Пошаговый деплой на Render
```

## 🔌 HTTP API

| Endpoint | Описание |
|----------|----------|
| `GET /api/health` | Health check: `{"ok":true,"users":3}` |
| `GET /api/webapp-data?tg_id=X` | Полные данные пользователя |

## 📝 Команды бота

- `/start` — приветствие + кнопка открытия WebApp
- `/add <название>` — добавить привычку
- `/delete <название>` — удалить привычку
- `/today` — открыть список на сегодня
- `/stats` — открыть статистику
- `/challenge` — список челленджей
- `/silent` — вкл/выкл уведомления
- `/help` — справка

## 🌐 Переменные окружения

| Переменная | Описание | Пример |
|-----------|----------|--------|
| `BOT_TOKEN` | Токен от @BotFather | `123:ABC...` |
| `WEBAPP_URL` | URL где хостится WebApp | `https://app.com` |
| `PORT` | Порт для HTTP API | `10000` |
| `RENDER_EXTERNAL_URL` | Автоматически на Render | — |

## 📜 Лицензия

ISC
