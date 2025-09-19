# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install only prod deps first via package*.json
COPY package*.json ./
RUN npm ci --only=production || npm i --only=production

# Copy source
COPY . .

# Expose port
EXPOSE 3000

# Use start script
CMD ["npm","start"]
