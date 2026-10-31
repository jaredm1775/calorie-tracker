// Downloads USDA FoodData Central datasets and trims them into public/foods.json.
// Each food is [fdcId, name, source, kcal, protein, carbs, fat, fibre, portions], per 100g.
// Macros may be null when USDA doesn't report them. Portions are [label, grams].
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { unzipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".usda-cache");
const outFile = join(root, "public", "foods.json");
const baseUrl = "https://fdc.nal.usda.gov/fdc-datasets/";

// Listed best first: when names collide, the earlier source wins.
const DATASETS = [
  { source: "F", key: "FoundationFoods", file: "FoodData_Central_foundation_food_json_2026-10-29.zip" },
  { source: "S", key: "SRLegacyFoods", file: "FoodData_Central_sr_legacy_food_json_2018-04.zip" },
  { source: "N", key: "SurveyFoods", file: "FoodData_Central_survey_food_json_2024-10-31.zip" },
];

// Some Foundation foods have no plain energy value, only Atwater-factor ones.
const ENERGY_NUMBERS = ["208", "958", "957"];
const NUTRIENT_NUMBERS = { protein: "203", carbs: "205", fat: "204", fibre: "291" };

async function loadDataset({ key, file }) {
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, file);
  if (!existsSync(zipPath)) {
    console.log(`Downloading ${file}`);
    const response = await fetch(baseUrl + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  }
  const entries = Object.values(unzipSync(readFileSync(zipPath)));
  if (entries.length !== 1) throw new Error(`${file}: expected one file, found ${entries.length}`);
  const foods = JSON.parse(Buffer.from(entries[0]).toString("utf8"))[key];
  if (!Array.isArray(foods)) throw new Error(`${file}: missing ${key}`);
  return foods;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function nutrientMap(food) {
  const map = new Map();
  for (const entry of food.foodNutrients ?? []) {
    const number = entry.nutrient?.number;
    if (number && typeof entry.amount === "number" && !map.has(number)) map.set(number, entry.amount);
  }
  return map;
}

function portionLabel(portion) {
  const description = portion.portionDescription?.trim();
  if (description) return /not specified/i.test(description) ? null : description;
  const unit = portion.measureUnit?.name;
  const parts = [portion.amount, unit && unit !== "undetermined" ? unit : null, portion.modifier];
  const label = parts.filter((part) => part !== null && part !== undefined && part !== "").join(" ").trim();
  return label || null;
}

function trimPortions(food) {
  const seen = new Set();
  const portions = [];
  for (const portion of food.foodPortions ?? []) {
    const label = portionLabel(portion);
    if (!label || !(portion.gramWeight > 0) || seen.has(label)) continue;
    seen.add(label);
    portions.push([label, round(portion.gramWeight)]);
  }
  return portions;
}

function trimFood(food, source) {
  const nutrients = nutrientMap(food);
  const energyNumber = ENERGY_NUMBERS.find((number) => nutrients.has(number));
  if (!energyNumber) return { rejected: "no calories" };
  const kcal = nutrients.get(energyNumber);
  const macro = (name) => {
    const value = nutrients.get(NUTRIENT_NUMBERS[name]);
    return value === undefined ? null : round(value);
  };
  const [protein, carbs, fat, fibre] = ["protein", "carbs", "fat", "fibre"].map(macro);
  // Fat is 9 kcal/g, so nothing can exceed about 900 kcal per 100g.
  if (kcal < 0 || kcal > 910) return { rejected: "impossible calories" };
  // USDA figures are rounded and carbs are by difference, so allow slight overshoot.
  if ((protein ?? 0) + (carbs ?? 0) + (fat ?? 0) > 105) return { rejected: "impossible macros" };
  return {
    row: [food.fdcId, food.description.replace(/\s*\(Includes foods for USDA.*?\)/i, "").trim(), source, Math.round(kcal), protein, carbs, fat, fibre, trimPortions(food)],
  };
}

const byName = new Map();
const rejected = {};
const counts = {};
for (const dataset of DATASETS) {
  const foods = await loadDataset(dataset);
  counts[dataset.key] = { read: foods.length, kept: 0 };
  for (const food of foods) {
    const result = trimFood(food, dataset.source);
    if (result.rejected) {
      rejected[result.rejected] = (rejected[result.rejected] ?? 0) + 1;
      continue;
    }
    const name = result.row[1].toLowerCase();
    if (byName.has(name)) {
      rejected["duplicate name"] = (rejected["duplicate name"] ?? 0) + 1;
      continue;
    }
    byName.set(name, result.row);
    counts[dataset.key].kept += 1;
  }
}

const rows = [...byName.values()].sort((a, b) => a[1].localeCompare(b[1]));
const json = JSON.stringify(rows);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, json);

console.log(counts);
console.log("Left out:", rejected);
console.log(`${rows.length} foods, ${(json.length / 1e6).toFixed(2)} MB, ${(gzipSync(json).length / 1e6).toFixed(2)} MB gzipped`);
