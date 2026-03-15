FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_PRICING_API_URL
ENV NEXT_PUBLIC_PRICING_API_URL=$NEXT_PUBLIC_PRICING_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
