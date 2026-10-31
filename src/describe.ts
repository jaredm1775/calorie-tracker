import { searchFoods } from "./foods";
import type { Food } from "./nutrition";

export const MAX_DESCRIPTION_LENGTH = 1000;

export type Quantity = { grams: number } | { amount: number; unit: string | null; size: string | null };

export interface ParsedItem {
  text: string;
  query: string;
  quantity: Quantity | null;
}

const GRAMS_PER_UNIT: Record<string, number> = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };

const UNIT_ALIASES: [string, string][] = [
  ["grams", "g"],
  ["gram", "g"],
  ["g", "g"],
  ["kilograms", "kg"],
  ["kilogram", "kg"],
  ["kg", "kg"],
  ["fluid ounces", "fl oz"],
  ["fluid ounce", "fl oz"],
  ["fl oz", "fl oz"],
  ["ounces", "oz"],
  ["ounce", "oz"],
  ["oz", "oz"],
  ["pounds", "lb"],
  ["pound", "lb"],
  ["lbs", "lb"],
  ["lb", "lb"],
  ["millilitres", "ml"],
  ["milliliters", "ml"],
  ["ml", "ml"],
  ["cups", "cup"],
  ["cup", "cup"],
  ["tablespoons", "tablespoon"],
  ["tablespoon", "tablespoon"],
  ["tbsp", "tablespoon"],
  ["teaspoons", "teaspoon"],
  ["teaspoon", "teaspoon"],
  ["tsp", "teaspoon"],
  ["slices", "slice"],
  ["slice", "slice"],
  ["pieces", "piece"],
  ["piece", "piece"],
  ["cans", "can"],
  ["can", "can"],
  ["bottles", "bottle"],
  ["bottle", "bottle"],
  ["servings", "serving"],
  ["serving", "serving"],
  ["pats", "pat"],
  ["pat", "pat"],
];
const UNIT_NAMES = new Map(UNIT_ALIASES);
const UNIT_PATTERN = UNIT_ALIASES.map(([alias]) => alias).join("|");

const NUMBER_WORDS: Record<string, number> = {
  "a couple of": 2,
  "couple of": 2,
  "half a": 0.5,
  "half an": 0.5,
  "a half": 0.5,
  half: 0.5,
  "a quarter": 0.25,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");
const FRACTIONS: Record<string, string> = { "½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3" };

const LEADING_AMOUNT = new RegExp(
  `^(?:(\\d+/\\d+|\\d+(?:\\.\\d+)?(?:\\s+\\d+/\\d+)?)|(${NUMBER_WORD_PATTERN})\\b)\\s*`,
);
const LEADING_UNIT = new RegExp(`^(${UNIT_PATTERN})(?![a-z])\\s*`);
const LEADING_SIZE = /^(small|medium|large)\b\s*/;
const TRAILING_WEIGHT = new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})$`);

function parseNumber(text: string): number {
  return text.split(/\s+/).reduce((total, part) => {
    const [top, bottom] = part.split("/").map(Number);
    return total + (bottom ? top / bottom : top);
  }, 0);
}

function toQuantity(amount: number, unit: string | null, size: string | null): Quantity {
  const perUnit = unit ? GRAMS_PER_UNIT[unit] : undefined;
  return perUnit ? { grams: Math.round(amount * perUnit * 10) / 10 } : { amount, unit, size };
}

function cleanQuery(text: string): string {
  return text
    .replace(/^(?:of|some|the|my)\s+/, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

export function parseItem(text: string): ParsedItem {
  let rest = text
    .toLowerCase()
    .trim()
    .replace(/^(?:i\s+)?(?:had|ate)\s+/, "");
  const amountMatch = LEADING_AMOUNT.exec(rest);
  if (amountMatch) {
    rest = rest.slice(amountMatch[0].length);
    const amount = amountMatch[1] ? parseNumber(amountMatch[1]) : NUMBER_WORDS[amountMatch[2]];
    const size = LEADING_SIZE.exec(rest);
    if (size) rest = rest.slice(size[0].length);
    const unit = LEADING_UNIT.exec(rest);
    if (unit) rest = rest.slice(unit[0].length);
    // "A large pizza slice" means the same as "a large slice of pizza".
    const trailingUnit = unit ? null : /^(.+?)\s+(slice|piece)s?$/.exec(rest);
    if (trailingUnit) rest = trailingUnit[1];
    const unitName = trailingUnit?.[2] ?? (unit ? UNIT_NAMES.get(unit[1])! : null);
    const quantity = toQuantity(amount, unitName, size?.[1] ?? null);
    return { text: text.trim(), query: cleanQuery(rest), quantity };
  }
  const trailing = TRAILING_WEIGHT.exec(rest);
  if (trailing) {
    const quantity = toQuantity(parseNumber(trailing[2]), UNIT_NAMES.get(trailing[3])!, null);
    return { text: text.trim(), query: cleanQuery(trailing[1]), quantity };
  }
  return { text: text.trim(), query: cleanQuery(rest), quantity: null };
}

// "Eggs and toast" is two foods but "rice and beans" can be one dish, so a
// phrase is only split when the library doesn't know it as a whole.
export function parseDescription(description: string, foods: Food[]): ParsedItem[] {
  const normalized = description.replace(/[½¼¾⅓⅔]/g, (fraction) => FRACTIONS[fraction]);
  const items: ParsedItem[] = [];
  for (const chunk of normalized.split(/[,;\n+&]+/)) {
    const whole = parseItem(chunk);
    const isDish = searchFoods(foods, whole.query, 1).length > 0;
    const parts = isDish ? [chunk] : chunk.split(/\s+(?:and|with|on|plus)\s+/i);
    for (const part of parts) {
      const item = parseItem(part);
      if (item.query) items.push(item);
    }
  }
  return items;
}

const EVERYDAY_NAMES: Record<string, string> = {
  burger: "hamburger",
  coke: "soft drink cola",
  fries: "french fries",
  "mac and cheese": "macaroni and cheese",
  pepsi: "soft drink cola",
  soda: "soft drink cola",
  sourdough: "bread sourdough",
  toast: "bread toasted",
};

function singular(word: string): string {
  return word.replace(/(?:es|s)$/, "");
}

// Search ranks for browsing, but a plain "rice" should mean rice rather than
// rice cake, so names led by the food itself come first and brands come last.
function plainness(food: Food, query: string): number {
  if (food.source === "mine" || food.source === "barcode") return -10;
  let rank = 0;
  if (singular(food.name.split(",")[0].toLowerCase()) !== singular(query)) rank += 4;
  if (/\b(NFS|plain|brewed|cooked|white|whole|salted)\b/.test(food.name)) rank -= 1;
  if (/\b[A-Z]{3,}\b/.test(food.name.replace("NFS", ""))) rank += 8;
  return rank;
}

// Falls back from "sourdough toast" to "toast" when the whole phrase has no match.
export function findFoods(query: string, foods: Food[], limit = 8): Food[] {
  const words = (EVERYDAY_NAMES[query] ?? query).split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    const phrase = words.slice(start).join(" ");
    const matches = searchFoods(foods, phrase, 200);
    if (matches.length > 0) {
      const ranks = new Map(matches.map((food) => [food.id, plainness(food, phrase)]));
      return matches.sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).slice(0, limit);
    }
  }
  return [];
}

const NOT_COUNTABLE = /\b(cup|oz|tablespoon|tbsp|teaspoon|tsp|quart|pint|inch|slice|package|container|jar|bottle|can|nlea|racc|calorie)\b/i;

function portionsOf(food: Food): { amount: number; rest: string; grams: number }[] {
  const portions = [];
  for (const portion of food.portions) {
    const match = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(portion.label);
    if (match && Number(match[1]) > 0) portions.push({ amount: Number(match[1]), rest: match[2], grams: portion.grams });
  }
  return portions.sort((a, b) => a.rest.length - b.rest.length);
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function isSize(text: string, size: string): boolean {
  return hasWord(text, size) && !(size === "large" && /extra large/i.test(text));
}

// Returns null when the food has no matching portion, because a guessed weight
// would look as trustworthy as a real one. The person enters it instead.
export function gramsFor(quantity: Quantity | null, food: Food): number | null {
  if (!quantity) return null;
  if ("grams" in quantity) return quantity.grams;
  const { amount, size } = quantity;
  let unit = quantity.unit;
  let count = amount;
  const portions = portionsOf(food);
  if (unit === "ml") {
    const fluid = portions.find((portion) => hasWord(portion.rest, "fl oz"));
    if (!fluid) return null;
    unit = "fl oz";
    count = amount / 29.57;
  }
  const candidates = portions.filter((candidate) =>
    unit ? hasWord(candidate.rest, unit) : !NOT_COUNTABLE.test(candidate.rest),
  );
  let portion;
  for (const preferred of size ? [size] : ["medium", "regular", "large", "small"]) {
    portion ??= candidates.find((candidate) => isSize(candidate.rest, preferred));
  }
  portion ??= candidates[0];
  return portion ?Math.round((count * portion.grams * 10) / portion.amount) / 10 : null;
}
