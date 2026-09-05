# Build context is the PARENT directory of this repo (not this repo itself),
# because package.json depends on the sibling repo AI_settings_card via a
# `file:../AI_settings_card/packages/ai-settings-ui` path (not published to
# npm — see publish.sh in that repo). See docker-compose.yml `build.context`.
# Expected layout on the VPS:
#   ~/apps/gold-cockpit/AI_settings_card/
#   ~/apps/gold-cockpit/gold-cockpit/   <- this repo, cloned as "gold-cockpit"
FROM node:20-slim

WORKDIR /app

# Sibling dependency first (rarely changes) so npm install layer caches well.
COPY AI_settings_card /app/AI_settings_card

WORKDIR /app/gold-cockpit
COPY gold-cockpit/package.json gold-cockpit/package-lock.json ./
RUN npm install

COPY gold-cockpit/ .

EXPOSE 8787 3577

CMD ["sh", "-c", "npm run server & npm run dev -- --host 0.0.0.0"]
