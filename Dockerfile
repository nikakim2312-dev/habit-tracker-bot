FROM node:22-alpine
WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Ставим зависимости
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Копируем код
COPY . .

# Render выдаёт порт через переменную PORT
# По умолчанию 10000
EXPOSE 10000

# Запускаем бот (теперь с WebApp встроенным!)
CMD ["node", "bot-v2.js"]
