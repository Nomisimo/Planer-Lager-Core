# syntax=docker/dockerfile:1
# Lager-Server (FA-56): Node 22, ohne Entwicklungswerkzeuge, läuft als Benutzer „node“.
# Bauen: docker build -t planer-lager-server .   Betrieb: siehe deploy/BETRIEB.md
FROM node:22-bookworm-slim AS bau
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages ./packages
# Optional: eigenes CA-Zertifikat für Firmen-Proxys (docker build --secret id=npm_ca,src=ca.crt)
RUN --mount=type=secret,id=npm_ca,required=false sh -c '[ -f /run/secrets/npm_ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; npm ci --no-audit --no-fund' && node packages/station-web/build.js

# Browser-Versionen beider Apps (ARCHITEKTUR §10): Apps klonen, mit diesem Core bauen (npm run build:web) → /web/<app>
FROM node:22-bookworm AS web
ARG MATERIALPLANER_REF=main
ARG PRODUCTIONPLANER_REF=main
ARG APPS_GIT=https://github.com/Nomisimo
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 LAGER_CORE_DIR=/app
COPY --from=bau /app /app
COPY scripts/app-build.cjs /app/scripts/app-build.cjs
RUN --mount=type=secret,id=npm_ca,required=false sh -c 'set -e; [ -f /run/secrets/npm_ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; \
  for a in Materialplaner:${MATERIALPLANER_REF} Productionplaner:${PRODUCTIONPLANER_REF}; do n=${a%%:*}; r=${a#*:}; k=$(echo $n | tr A-Z a-z); \
    git clone -q --depth 1 --branch "$r" "$APPS_GIT/$n.git" /src/$k; cd /src/$k; npm ci --no-audit --no-fund --ignore-scripts; npm run build:web; \
    mkdir -p /web && cp -r dist-web /web/$k; done'

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN --mount=type=secret,id=npm_ca,required=false sh -c '[ -f /run/secrets/npm_ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; npm ci --omit=dev --no-audit --no-fund' && rm -rf packages/*/test packages/shell /root/.npm
COPY --from=bau /app/packages/station-web/dist ./packages/station-web/dist
COPY --from=web /web ./web
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME /data
EXPOSE 8080 9101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/server/src/start.js"]
