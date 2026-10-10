# Hexit Monad services on Railway (build context = repo root, from a `git archive` export: no keys, no env files).
# Keys come from sealed env vars HEXIT_KEY_{RECORDER,QUOTER,RELAYER,KEEPER}; DATABASE_URL from the project's Postgres;
# Railway sets PORT. One replica only: the relayer and keeper keep their nonces in this process.
FROM node:22-slim
WORKDIR /app
COPY packages/monad/package.json packages/monad/
COPY packages/monad/dist packages/monad/dist
COPY packages/pricing/package.json packages/pricing/
COPY packages/pricing/dist packages/pricing/dist
COPY services/game/package.json services/game/package-lock.json services/game/.npmrc services/game/
RUN cd services/game && npm ci --omit=dev

COPY services/game/src services/game/src
COPY deployment/monad.json deployment/monad.json
CMD ["node", "services/game/src/main.ts"]
