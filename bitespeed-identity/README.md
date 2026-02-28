# Bitespeed Identity Reconciliation Service

A backend web service that identifies and tracks customers across multiple purchases with different contact information.

## Live Endpoint

> **TODO:** Replace with your deployed URL  
> `https://your-app.onrender.com/identify`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| ORM | Prisma |
| Database | SQLite |
| Validation | Zod |
| Security | Helmet, CORS, Rate Limiting |

## Project Structure

```
src/
├── index.ts        # Entry point — Express app setup + server
├── config.ts       # Environment config
├── db.ts           # Prisma client singleton
├── errors.ts       # Custom AppError class
├── middleware.ts    # Helmet, CORS, rate limit, 404 & error handlers
├── routes.ts       # POST /identify endpoint
├── schemas.ts      # Zod request validation
└── service.ts      # Core identity reconciliation logic
```

## Setup & Run

```bash
# 1. Install dependencies
npm install

# 2. Set up database
npx prisma migrate dev

# 3. Build TypeScript
npm run build

# 4. Start the server
npm start
```

For development:

```bash
npm run dev
```

## API

### `POST /identify`

**Request:**
```json
{
  "email": "example@email.com",
  "phoneNumber": "123456"
}
```

At least one of `email` or `phoneNumber` must be non-null.

**Response (200):**
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["primary@email.com", "secondary@email.com"],
    "phoneNumbers": ["123456", "789012"],
    "secondaryContactIds": [2, 3]
  }
}
```

### `GET /health`

Returns `{ "status": "ok" }` — useful for uptime monitoring.

## Security Features

- **Helmet** — Secure HTTP headers (XSS, HSTS, etc.)
- **CORS** — Controlled cross-origin access
- **Rate Limiting** — 100 requests per 15-minute window (configurable)
- **Body Size Limit** — 10KB max JSON payload
- **Content-Type Enforcement** — Rejects non-JSON POST requests (415)
- **Input Validation** — Strict Zod schema validation
- **Graceful Shutdown** — Clean DB disconnect on SIGINT/SIGTERM
- **Global Error Handler** — Never leaks stack traces in production

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment |
| `DATABASE_URL` | `file:./dev.db` | SQLite connection URL |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate limit window |
