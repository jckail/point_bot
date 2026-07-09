# syntax=docker/dockerfile:1

##### DEPENDENCIES #####
FROM node:22-alpine AS deps
WORKDIR /repo

# Workspace manifests only, to keep this layer cacheable.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
RUN npm ci

##### BUILDER #####
FROM node:22-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# The Clerk publishable key is public by design but inlined at build time.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

ENV NEXT_TELEMETRY_DISABLED=1
# Server env vars are provided at runtime (ECS injects them from Secrets
# Manager), so skip validation during the image build.
RUN SKIP_ENV_VALIDATION=1 npm run build --workspace @pointup/web

##### RUNNER #####
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output preserves the monorepo layout under apps/web.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
