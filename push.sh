#!/bin/bash
# push.sh — пушит проект в GitHub
# Использование: ./push.sh <github-логин> <имя-репы> "<сообщение>"
#
# Безопасность: токен запрашивается в момент запуска, не сохраняется

set -e

if [ "$#" -lt 3 ]; then
  echo "❌ Использование: $0 <github-логин> <имя-репы> \"<сообщение>\""
  echo ""
  echo "Пример:"
  echo "  $0 nikakim2312-dev habit-tracker-bot \"Fix 400 error\""
  exit 1
fi

LOGIN="$1"
REPO="$2"
MSG="$3"

echo "═══════════════════════════════════════"
echo "  GitHub Push — Habit Tracker Bot"
echo "═══════════════════════════════════════"
echo ""
echo "📦 Репозиторий: $LOGIN/$REPO"
echo "💬 Коммит: $MSG"
echo ""

# Проверяем что мы в git-репе
if [ ! -d ".git" ]; then
  echo "📁 Инициализирую git..."
  git init
  git branch -M main
fi

# Запрашиваем токен (скрытый ввод)
echo -n "🔑 GitHub токен: "
read -s TOKEN
echo ""
echo ""

if [ -z "$TOKEN" ]; then
  echo "❌ Токен пустой, выходим"
  exit 1
fi

# Настраиваем git (если ещё не настроен)
git config --global user.name "${GIT_NAME:-Mavis Bot}" 2>/dev/null
git config --global user.email "${GIT_EMAIL:-bot@mavis.local}" 2>/dev/null

# Устанавливаем remote с токеном
REMOTE_URL="https://${TOKEN}@github.com/${LOGIN}/${REPO}.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE_URL"

echo "📤 Пушим в GitHub..."
git add .
git commit -m "$MSG" 2>/dev/null || echo "ℹ️  Нет новых изменений"

# Пушим
if git push -u origin main 2>&1 | tee /tmp/push.log; then
  echo ""
  echo "✅ Успешно запушено!"
  echo "🔗 https://github.com/${LOGIN}/${REPO}"
else
  echo ""
  echo "❌ Ошибка пуша (см. выше)"
  # Очищаем remote от токена даже при ошибке
  git remote set-url origin "https://github.com/${LOGIN}/${REPO}.git"
  unset TOKEN
  exit 1
fi

# Очищаем remote от токена
git remote set-url origin "https://github.com/${LOGIN}/${REPO}.git"

# Очищаем токен из памяти
unset TOKEN

echo ""
echo "🧹 Токен очищен из памяти"
echo "═══════════════════════════════════════"
