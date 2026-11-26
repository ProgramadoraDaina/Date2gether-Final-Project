FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
RUN pnpm install --frozen-lockfile
COPY . .

FROM dependencies AS backend-build
RUN pnpm build

FROM backend-build AS backend
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["pnpm", "start:prod"]

FROM dependencies AS client-build
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
# Docker's default bridge network has no IPv6 route, but fonts.gstatic.com
# resolves dual-stack; without this, Node picks the AAAA record first and
# next/font's fetch fails with an unhelpful null-dereference instead of a
# clear connection error.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN pnpm build:client
RUN chown -R node:node /app/client/.next

FROM client-build AS client
ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["pnpm", "--filter", "client", "start", "--hostname", "0.0.0.0"]
