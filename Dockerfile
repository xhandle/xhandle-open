# syntax=docker/dockerfile:1
FROM public.ecr.aws/lambda/nodejs:20

# Deterministic prod install, no noisy npm features
ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    npm_config_audit=false \
    npm_config_fund=false

WORKDIR /var/task

# Install only production deps using the lockfile if present
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
      npm ci --omit=dev ; \
    else \
      npm install --omit=dev ; \
    fi

# Then copy the app
COPY . .

# Lambda entry (server.js exports `exports.handler = serverlessExpress({ app })`)
CMD ["server.handler"]
