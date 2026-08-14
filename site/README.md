# Astro + Directus Tier Lists

This project renders Directus tier lists at `/tiers/<slug>`.

## Setup

1) Install dependencies:
```
npm install
```

2) Create a `.env` file based on `.env.example` and set your values:
```
cp .env.example .env
```

3) Run the dev server:
```
npm run dev -- --host
```

## Testing

Run the unit test suite with coverage from `site/`:

```
npm test
```

Use `npm run test:watch` for watch mode. From the repository root, the same
one-shot suite is available through `make test-site`.

Tests use fixtures in `src/test/fixtures/` and fetch-level Directus mocks, so
they do not need live Directus credentials or network access. Coverage includes
production TypeScript under `src/lib/` and is written to `coverage/` for CI.

## Notes

- The tier page is in `src/pages/tiers/[slug].astro`.
- Directus helpers live in `src/lib/directus.ts`.
- Styling is in `src/styles/tierlist.css`.
