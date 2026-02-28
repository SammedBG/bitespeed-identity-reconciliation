# Bitespeed Identity Reconciliation Service

A production-grade backend service that identifies and tracks customers across multiple purchases made with different contact information (email/phone). Built for the Bitespeed Backend Task.

**Live Endpoint:** `https://bitespeed-identity-reconciliation-cr0u.onrender.com` 

---
## Table of Contents

- [Problem Understanding](#problem-understanding)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Identity Merging Algorithm](#identity-merging-algorithm)
- [Concurrency & Safety](#concurrency--safety)
- [API Reference](#api-reference)
- [Setup & Run](#setup--run)
- [Testing](#testing)
- [Deployment (Render)](#deployment-render)
- [Performance & Scalability](#performance--scalability)

---

## Problem Understanding

A customer (Doc Brown) places multiple orders on FluxKart.com using different email addresses and phone numbers. The service must link all these disparate contact details to a single identity by:

- Treating the **oldest** contact as "primary"
- Linking newer contacts as "secondary"
- Merging two separate identity groups when a new request connects them
- Preventing duplicate records
- Returning a consolidated view of the customer's identity

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript (strict) | Type safety, modern async/await |
| Framework | Express.js | Mature, lightweight, ecosystem |
| ORM | Prisma | Type-safe queries, migrations, transactions |
| Database | PostgreSQL | ACID, serializable isolation, production-ready |
| Validation | Zod | Runtime schema validation with type inference |
| Security | Helmet + CORS + Rate Limiter | HTTP hardening, DDoS protection |
| Logging | Pino | Structured JSON logs, high performance |
| Testing | Vitest + Supertest | Fast, TypeScript-native, HTTP testing |
| Container | Docker (multi-stage) | Reproducible builds, small images |

---

## Architecture

```
src/
├── index.ts          # Express app bootstrap, graceful shutdown
├── config.ts         # Environment configuration (validated)
├── logger.ts         # Pino structured logger
├── db.ts             # Prisma singleton + DB health check
├── errors.ts         # Custom AppError + Prisma error codes
├── schemas.ts        # Zod validation (email, phone, at-least-one)
├── middleware.ts      # Helmet, CORS, rate limit, request logger, 404, error handler
├── routes.ts         # POST /identify endpoint
├── service.ts        # Core identity reconciliation (transaction-wrapped)
└── identify.test.ts  # Comprehensive test suite
```

**Separation of concerns:** Each file has a single responsibility. The service layer contains zero HTTP logic; routes contain zero business logic.

---

## Identity Merging Algorithm

The `/identify` endpoint handles **6 scenarios** inside a single serializable transaction:

### Scenario 1: No Match
Request has email/phone not seen before → **Create new primary contact**.

### Scenario 2: Partial Match
Email OR phone matches, but the other field is new → **Create secondary contact** linked to the existing primary.

### Scenario 3: Exact Match (Idempotent)
Both email AND phone already belong to the same group → **Return existing consolidated group** (no new row).

### Scenario 4: Two Primaries Merge
Email matches Group A, phone matches Group B → **Merge**: older primary survives, newer becomes secondary, all of newer's children re-link.

### Scenario 5: Multi-Primary Cascade
Three+ separate groups indirectly connected over time → The algorithm resolves **all** primaries to the oldest one in a single pass.

### Scenario 6: Duplicate Prevention
Unique constraint `(email, phoneNumber, linkedId)` + application-level idempotency check prevents duplicate rows even under concurrent requests.

### Why Transactions?

Without a transaction, two concurrent requests could both read "no match" and create two primaries for the same person. Serializable isolation ensures one completes before the other reads, maintaining the **single-primary invariant**.

### How Single Primary is Guaranteed

1. **On creation:** Only the first contact in a group is primary.
2. **On merge:** `createdAt` determines seniority — oldest always wins.
3. **On re-link:** All children of a demoted primary are atomically reassigned.
4. **DB constraint:** The unique index prevents silent duplicates.

---

## Concurrency & Safety

| Mechanism | Purpose |
|---|---|
| `Prisma.$transaction` with `Serializable` isolation | Prevents phantom reads; ensures sequential consistency |
| Unique constraint `(email, phoneNumber, linkedId)` | DB-level duplicate prevention |
| Application-level idempotency check | Avoids inserting when exact combo already exists |
| Retry on `P2002` (unique violation) | Handles race condition gracefully by re-reading |
| `maxWait: 5000ms`, `timeout: 10000ms` | Prevents hanging transactions |
| Graceful shutdown (SIGINT/SIGTERM) | Drains connections cleanly |
| Global error handler | Catches all unhandled errors; never leaks stack traces in production |

---

## API Reference

### `POST /identify`

**Request:**
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

At least one of `email` or `phoneNumber` must be non-null. Email is validated for format. Phone accepts string or number.

**Response (200):**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"],
    "phoneNumbers": ["123456"],
    "secondaryContactIds": [23]
  }
}
```

**Error (400):**
```json
{
  "error": "Validation failed",
  "details": ["At least one of email or phoneNumber must be provided"]
}
```

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": "2026-02-28T15:46:54.359Z",
  "database": "connected",
  "uptime": 123.456
}
```

Returns `503` with `"database": "unreachable"` if PostgreSQL is down.

---

## Setup & Run

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- npm 9+

### Steps

```bash
# 1. Clone and install
git clone <your-repo-url>
cd bitespeed-identity
npm install

# 2. Configure environment — create a .env file:
#    DATABASE_URL="postgresql://user:password@localhost:5432/bitespeed"
#    NODE_ENV=development
#    PORT=3000

# 3. Run migrations
#    For local development (requires shadow DB access):
npx prisma migrate dev --name init
#    For hosted/remote databases (e.g. Render):
#    npx prisma migrate deploy

# 4. Build
npm run build

# 5. Start
npm start
```

### Development mode
```bash
npm run dev
```

### Sample curl commands

```bash
# New customer
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"doc@hillvalley.edu","phoneNumber":"555-0100"}'

# Link with same phone
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"emmett@time.travel","phoneNumber":"555-0100"}'

# Query by email only
curl -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"doc@hillvalley.edu"}'

# Health check
curl http://localhost:3000/health
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests cover:
- Validation (empty body, invalid email, bad phone, number coercion)
- New customer creation (email only, phone only, both)
- Secondary contact linking (new email, new phone)
- Idempotency (repeated requests don't create duplicates)
- Multi-primary merge (two groups, three groups)
- Single primary guarantee (DB count assertion)
- Response format (primary first, no duplicates)

---

## Deployment (Render)

### 1. Create a PostgreSQL database on Render
- Go to Render → New → PostgreSQL
- Note the **Internal Database URL**

### 2. Create a Web Service
- Connect your GitHub repo
- **Build Command:** `npm install && npx prisma migrate deploy && npm run build`
- **Start Command:** `npm start`
- **Environment Variables:**
  - `DATABASE_URL` = your Render PostgreSQL internal URL
  - `NODE_ENV` = `production`
  - `PORT` = `3000`

### 3. Using Docker (alternative)
```bash
docker build -t bitespeed-identity .
docker run -p 3000:3000 -e DATABASE_URL="postgresql://..." bitespeed-identity
```

---

## Performance & Scalability

| Aspect | Implementation |
|---|---|
| **Indexes** | Email, phone, linkedId all indexed for O(log n) lookups |
| **Connection pooling** | Prisma's built-in pool (configurable via `?connection_limit=N`) |
| **Transaction scope** | Kept minimal — only the reconciliation logic |
| **Soft deletes** | `deletedAt` filtered in all queries; data is never lost |
| **Logging** | Pino (fastest Node.js logger); JSON in prod, pretty in dev |
| **Docker** | Multi-stage build; ~50MB production image |
| **Horizontal scaling** | Stateless app; scale by adding instances behind a load balancer |

### Commit Message Strategy

```
feat: add identity reconciliation service
feat: implement POST /identify with Prisma transactions
feat: add Zod validation and security middleware
feat: add structured logging with pino
feat: add Dockerfile for containerized deployment
test: add comprehensive vitest test suite
docs: add production README with algorithm explanation
```

---

## Final Notes

This service is designed with correctness as the highest priority.  
All identity reconciliation logic is transactionally safe, idempotent, and concurrency-aware.

The system guarantees:
- Exactly one primary per identity group
- Deterministic response formatting
- No duplicate records
- Safe concurrent execution
- Production-ready deployment

---