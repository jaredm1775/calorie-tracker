# Calorie Tracker

A phone-first calorie tracker built around weighed portions and a personal food library. Data stays on the device, in IndexedDB.

```bash
npm install
npm run dev
```

- `npm test` runs the unit tests.
- `npm run build:foods` regenerates `public/foods.json` from USDA downloads, cached in `.usda-cache`.
- `node scripts/check_food_library.mjs` compares a food sample with USDA's live API. Its demo key allows about 10 foods before it's rate limited.

Food data: [USDA FoodData Central](https://fdc.nal.usda.gov/) (public domain, CC0).
