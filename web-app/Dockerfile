# syntax=docker/dockerfile:1
#
# Open-Cluely Web — single image: HTTP API + WebSocket + the React SPA, one Node process.
#
# IMPORTANT: build from the REPO ROOT, not from web-app/. The interviewer brain
# lives in /src and is re-exported by @open-cluely/copilot-core (../../../src), so
# both /src and /web-app must be in the build context:
#
#   docker build -f web-app/Dockerfile -t open-cluely-web:latest .
#   docker run --rm -p 8787:8787 -e DASHSCOPE_API_KEY=sk-xxxx open-cluely-web:latest
#   # open http://localhost:8787
#
# The DashScope key is NEVER baked into the image — pass it at runtime via -e / compose.

# ---------- build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Brain (Electron-free: pipeline, prompts, runtime) re-exported by copilot-core.
COPY src ./src
# The web monorepo (workspaces: contract, copilot-core, question-bank, server, web).
COPY web-app ./web-app
WORKDIR /app/web-app
RUN npm ci
# Builds the web SPA (vite -> web/dist) and bundles the server (esbuild -> server/dist).
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
# Brain source is required at runtime (copilot-core resolves ../../../src).
COPY --from=build /app/src ./src
# Monorepo incl. built artifacts (web/dist, server/dist), node_modules, and the
# committed question-bank data (bank.json + vectors.bin).
COPY --from=build /app/web-app ./web-app
# The server resolves ../web/dist and ../.env relative to its own dir, and the
# question-bank data via require.resolve — all satisfied by this layout.
WORKDIR /app/web-app/server
EXPOSE 8787
CMD ["node", "dist/index.js"]
