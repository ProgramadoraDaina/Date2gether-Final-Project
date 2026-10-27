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
RUN pnpm build:client
RUN chown -R node:node /app/client/.next

FROM client-build AS client
ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["pnpm", "--filter", "client", "start", "--hostname", "0.0.0.0"]
