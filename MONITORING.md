# 📊 Мониторинг — UptimeRobot

Чтобы бот не засыпал на Free плане и получать алерты если упал.

## Настройка (5 минут)

### Шаг 1: Регистрация
1. Открой [uptimerobot.com](https://uptimerobot.com)
2. Sign Up Free
3. Подтверди email

### Шаг 2: Добавить монитор
1. **+ Add New Monitor**
2. Заполни:
   ```
   Monitor Type:     HTTP(s)
   Friendly Name:    Habit Tracker Bot
   URL:              https://habit-tracker-bot-v51n.onrender.com/api/health
   Monitoring Interval: 5 minutes
   ```
3. **Create Monitor**

### Шаг 3: Telegram алерты (опционально)
1. Найди [@UptimeRobotBot](https://t.me/UptimeRobotBot) в Telegram
2. Нажми Start
3. Получишь код активации
4. В UptimeRobot: **My Settings** → **Alert Contacts** → **Add Alert Contact** → **Telegram**
5. Вставь код
6. Подтверди

### Шаг 4: Публичная страница (опционально)
1. **My Settings** → **Public Status Page**
2. Создай страницу
3. Подели URL — друзья увидят статус бота

## Что отслеживается

✅ **HTTP 200** каждые 5 минут → бот жив
✅ **users > 0** → есть активные юзеры
✅ **uptime_sec** → время работы

## Алерты

Если бот упадёт:
- 📧 Email уведомление
- 📱 Telegram сообщение (если настроил)
- 🔔 Push в браузер

## Что НЕ мониторится

- ❌ WebApp (хостится на space.minimax.io)
- ❌ Telegram API (внешний сервис)
- ❌ Токен бота (защищён GitHub)
