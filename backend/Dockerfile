# --- Build a minimal production Node image for the backend ---
FROM node:20-alpine

# ---- Timezone (India) ----
ARG TZ=Asia/Kolkata
ENV TZ=$TZ
RUN apk add --no-cache tzdata \
  && cp /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone
# --------------------------


WORKDIR /app
ENV NODE_ENV=production
# Make sure your package.json has a proper "start": "node server.js"
COPY package*.json ./

RUN npm install --production
# Copy the rest of the backend
COPY . .

# Let the app pick PORT env or default 3001
ENV PORT=3001 HOST=0.0.0.0
EXPOSE 3001

CMD ["node", "server.js"]

