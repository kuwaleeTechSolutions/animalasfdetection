# =====================================================================================
# Assam Livestock Biosecurity & Disease Contact-Tracing Platform -- Pilot Dockerfile
#
# [DECIDE] Single-image build: the backend (Node.js, built-in HTTP server) also serves
# the static frontend (vanilla JS SPA -- see frontend/public/index.html for why no
# separate Vite build step exists in this pilot). This keeps docker-compose simple
# (one app service) while the database is an embedded SQLite file mounted as a volume.
# See README.md "Tech Stack Decisions" for the full rationale and the PostGIS/Postgres
# migration path for a production deployment.
#
# NOTE: This Dockerfile has not been build-tested in the pilot's development sandbox
# (no Docker daemon was available there). It targets a standard Node 22+ Alpine/slim
# base image and uses zero npm dependencies (see package.json), so it should build
# and run in any standard Docker environment -- please verify on first use and file
# an issue if anything needs adjustment.
# =====================================================================================
FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

RUN mkdir -p /app/data

ENV PORT=4000
ENV DB_PATH=/app/data/assam_biosecurity.db
ENV TOKEN_SECRET=change-me-in-production

EXPOSE 4000

# Seed on first boot only if the DB file doesn't already exist, then start the server.
CMD ["sh", "-c", "test -f $DB_PATH || node backend/scripts/seed.mts; node backend/src/server.mts"]
