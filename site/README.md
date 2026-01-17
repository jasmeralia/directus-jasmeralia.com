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

## Notes

- The tier page is in `src/pages/tiers/[slug].astro`.
- Directus helpers live in `src/lib/directus.ts`.
- Styling is in `src/styles/tierlist.css`.
