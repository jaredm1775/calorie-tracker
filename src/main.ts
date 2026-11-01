import { barcodeFoodId, lookupBarcode, normalizeBarcode } from "./barcode";
import { parseBackup } from "./backup";
import { findFoods, gramsFor, MAX_DESCRIPTION_LENGTH, parseDescription, type ParsedItem } from "./describe";
import {
  deleteEntry,
  deleteMyFood,
  exportBackup,
  getAllEntries,
  getEntries,
  getGoals,
  getMyFoods,
  getReferenceRows,
  importBackup,
  saveEntry,
  saveGoals,
  saveMyFood,
} from "./db";
import { rowToFood, searchFoods, SOURCE_LABELS } from "./foods";
import {
  ACTIVITY_LABELS,
  feetToCm,
  isValidGoalInput,
  MIN_AGE,
  poundsToKg,
  suggestGoals,
  type Activity,
  type Aim,
  type GoalInput,
  type GoalSuggestion,
  type Sex,
} from "./goals";
import {
  isValidGrams,
  localDate,
  LOW_GOAL_KCAL,
  nutrientsFor,
  scaleToPer100g,
  shiftDate,
  sumNutrients,
  type Food,
  type Goals,
  type LogEntry,
  type Nutrients,
} from "./nutrition";

type Tab = "today" | "foods" | "history" | "settings";
type Attrs = Record<string, string | number | boolean | ((event: Event) => void)>;
type Child = Node | string | null;

const app = document.querySelector<HTMLElement>("#app")!;
const tabs = document.querySelector<HTMLElement>("#tabs")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;

const state: { tab: Tab; date: string; reference: Food[]; referenceError: string | null } = {
  tab: "today",
  date: localDate(),
  reference: [],
  referenceError: null,
};

// Builds elements with textContent only, so food names can never inject markup.
function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") element.addEventListener(key, value);
    else if (key in element && key !== "list") (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, String(value));
  }
  element.append(...children.filter((child): child is Node | string => child !== null));
  return element;
}

function numberField(label: string, name: string, value: number | string, step = "any"): HTMLElement {
  return h(
    "label",
    {},
    label,
    h("input", { type: "number", name, value: String(value), min: "0", step, inputMode: "decimal", required: true }),
  );
}

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function macros(item: Nutrients): string {
  return `P ${round(item.protein)}g · C ${round(item.carbs)}g · F ${round(item.fat)}g`;
}

function formatDate(date: string): string {
  if (date === localDate()) return "Today";
  if (date === shiftDate(localDate(), -1)) return "Yesterday";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function meter(label: string, value: number, goal: number | undefined, unit: string): HTMLElement {
  const text = goal ? `${round(value)} / ${goal}${unit}` : `${round(value)}${unit}`;
  const percent = goal ? Math.min(100, (value / goal) * 100) : 0;
  return h(
    "div",
    { className: "meter" },
    h("div", { className: "meter-label" }, h("span", {}, label), h("span", {}, text)),
    goal
      ? h("div", { className: "meter-track" }, h("div", { className: "meter-fill", style: `width:${percent}%` }))
      : null,
  );
}

function openDialog(title: string, ...content: Child[]): void {
  dialog.replaceChildren(
    h(
      "div",
      { className: "dialog-head" },
      h("h1", {}, title),
      h("button", { type: "button", click: () => dialog.close() }, "Close"),
    ),
    ...content.filter((child): child is Node | string => child !== null),
  );
  if (!dialog.open) dialog.showModal();
}

async function allFoods(): Promise<Food[]> {
  return [...(await getMyFoods()), ...state.reference];
}

// ---- Logging ----

function openAddFood(): void {
  const results = h("ul", { className: "list" });
  const note = h("p", { className: "muted" }, state.referenceError ?? "Search your foods and the USDA library.");
  const showResults = async (query: string) => {
    const matches = searchFoods(await allFoods(), query);
    note.textContent = query.trim() && matches.length === 0 ? "No matches. Try fewer words, or add it as your own food." : "";
    results.replaceChildren(
      ...matches.map((food) =>
        h(
          "li",
          {},
          h(
            "button",
            { type: "button", className: "row", click: () => openLogFood(food) },
            h(
              "span",
              { className: "row-main" },
              food.name,
              h("div", { className: "muted" }, SOURCE_LABELS[food.source]),
            ),
            h("span", { className: "row-side muted" }, `${round(food.per100g.kcal)} kcal/100g`),
          ),
        ),
      ),
    );
  };
  const search = h("input", {
    type: "search",
    placeholder: "e.g. banana",
    "aria-label": "Search foods",
    input: (event: Event) => void showResults((event.target as HTMLInputElement).value),
  }) as HTMLInputElement;
  openDialog(
    "Add food",
    h("button", { type: "button", className: "wide", click: () => void openScanner() }, "Scan a barcode"),
    h("div", { style: "height:8px" }),
    h("button", { type: "button", className: "wide", click: () => openDescribe() }, "Describe a meal"),
    h("div", { style: "height:8px" }),
    search,
    note,
    results,
    h("button", { type: "button", className: "wide", click: () => openFoodForm() }, "Add my own food"),
  );
  search.focus();
}

function openDescribe(savedText = ""): void {
  const status = h("p", { className: "muted", role: "status" });
  const textarea = h("textarea", {
    name: "text",
    required: true,
    maxLength: MAX_DESCRIPTION_LENGTH,
    value: savedText,
    placeholder: "2 eggs, a slice of sourdough with butter, 200g rice",
  }) as HTMLTextAreaElement;
  openDialog(
    "Describe a meal",
    h(
      "form",
      {
        submit: async (event: Event) => {
          event.preventDefault();
          const text = textarea.value.trim();
          const foods = await allFoods();
          const items = parseDescription(text, foods);
          if (items.length === 0) {
            status.textContent = "No foods found in that description. Try naming what you ate.";
            return;
          }
          openReview(text, items, foods);
        },
      },
      h("label", {}, "What did you eat?", textarea),
      h("button", { type: "submit", className: "primary wide" }, "Find foods"),
      status,
      h(
        "p",
        { className: "muted" },
        "Separate foods with commas, and add amounts like 2 eggs, 1 cup of rice or chicken 150g. This all happens on your device, and you check everything before it's logged.",
      ),
    ),
  );
  textarea.focus();
}

interface ReviewRow {
  item: ParsedItem;
  matches: Food[];
  chosen: Food | null;
  grams: number;
  gramsEdited: boolean;
  removed: boolean;
}

function openReview(text: string, items: ParsedItem[], foods: Food[]): void {
  const rows: ReviewRow[] = items.map((item) => {
    const matches = findFoods(item.query, foods);
    const chosen = matches[0] ?? null;
    return { item, matches, chosen, grams: chosen ? gramsFor(item.quantity, chosen) ?? 0 : 0, gramsEdited: false, removed: false };
  });
  const isReady = (row: ReviewRow) => row.chosen !== null && isValidGrams(row.grams);
  const active = () => rows.filter((row) => !row.removed);
  const total = h("p", { className: "big" });
  const logButton = h("button", { type: "submit", className: "primary wide" }) as HTMLButtonElement;
  const updateTotal = () => {
    const ready = active().filter(isReady);
    const sum = sumNutrients(ready.map((row) => nutrientsFor(row.chosen!.per100g, row.grams)));
    total.textContent = `${round(sum.kcal)} kcal`;
    logButton.textContent = `Log ${ready.length} ${ready.length === 1 ? "item" : "items"} to ${formatDate(state.date).toLowerCase()}`;
    logButton.disabled = ready.length === 0 || ready.length < active().length;
  };
  const reviewRow = (row: ReviewRow): HTMLElement => {
    const line = h("p", { className: "muted" });
    const foodSelect = h("select", {
      change: (event: Event) => {
        const id = (event.target as HTMLSelectElement).value;
        chooseFood(row.matches.find((food) => food.id === id) ?? null);
      },
    }) as HTMLSelectElement;
    const portionSelect = h("select", {
      change: (event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        if (value) setGrams(Number(value), true);
      },
    }) as HTMLSelectElement;
    const portionLabel = h("label", {}, "Common portion (optional)", portionSelect);
    const gramsInput = h("input", {
      type: "number",
      min: "0",
      step: "any",
      inputMode: "decimal",
      required: true,
      input: (event: Event) => {
        row.grams = Number((event.target as HTMLInputElement).value);
        row.gramsEdited = true;
        update();
      },
    }) as HTMLInputElement;
    const update = () => {
      if (!row.chosen) line.textContent = "No match yet. Search for it above, or remove it.";
      else if (!isValidGrams(row.grams)) line.textContent = "Enter a weight to log this.";
      else {
        const item = nutrientsFor(row.chosen.per100g, row.grams);
        line.textContent = `${round(item.kcal)} kcal · ${macros(item)}`;
      }
      updateTotal();
    };
    const setGrams = (grams: number, edited: boolean) => {
      row.grams = grams;
      row.gramsEdited = edited;
      gramsInput.value = grams > 0 ? String(grams) : "";
      update();
    };
    const chooseFood = (food: Food | null) => {
      row.chosen = food;
      const portions = food?.portions ?? [];
      portionLabel.hidden = portions.length === 0;
      portionSelect.replaceChildren(
        h("option", { value: "" }, "Enter weight below"),
        ...portions.map((portion) => h("option", { value: String(portion.grams) }, `${portion.label} (${portion.grams}g)`)),
      );
      if (food && !row.gramsEdited) setGrams(gramsFor(row.item.quantity, food) ?? 0, false);
      else update();
    };
    const showMatches = () => {
      foodSelect.replaceChildren(
        ...row.matches.map((food) => h("option", { value: food.id }, `${food.name} (${round(food.per100g.kcal)} kcal/100g)`)),
      );
      foodSelect.hidden = row.matches.length === 0;
      chooseFood(row.matches[0] ?? null);
    };
    const element = h(
      "div",
      { className: "review-item" },
      h("p", {}, row.item.text),
      h(
        "label",
        {},
        "Search for a different food",
        h("input", {
          type: "search",
          value: row.item.query,
          input: (event: Event) => {
            row.matches = findFoods((event.target as HTMLInputElement).value.trim().toLowerCase(), foods);
            showMatches();
          },
        }),
      ),
      h("label", {}, "Food", foodSelect),
      portionLabel,
      h("label", {}, "Weight (g)", gramsInput),
      line,
      h(
        "button",
        {
          type: "button",
          click: () => {
            row.removed = true;
            element.remove();
            updateTotal();
          },
        },
        "Remove",
      ),
    );
    const initialGrams = row.grams;
    showMatches();
    setGrams(initialGrams, false);
    return element;
  };
  const list = rows.map(reviewRow);
  updateTotal();
  openDialog(
    "Check your foods",
    h(
      "form",
      {
        submit: async (event: Event) => {
          event.preventDefault();
          if (logButton.disabled) return;
          logButton.disabled = true;
          const createdAt = Date.now();
          for (const [index, row] of active().entries()) {
            await saveEntry({
              ...nutrientsFor(row.chosen!.per100g, row.grams),
              id: newId("entry"),
              date: state.date,
              foodId: row.chosen!.id,
              name: row.chosen!.name,
              grams: row.grams,
              createdAt: createdAt + index,
            });
          }
          dialog.close();
          await render();
        },
      },
      h("p", { className: "muted" }, "Portion weights are typical values, so adjust anything that looks off. Nothing is logged until you confirm."),
      ...list,
      h("div", { className: "review-total" }, total, logButton),
      h("button", { type: "button", className: "wide", click: () => openDescribe(text) }, "Back to description"),
    ),
  );
}

async function openScanner(): Promise<void> {
  const status = h("p", { className: "muted", role: "status" }, "Starting the camera…");
  const video = h("video", { className: "scanner", playsInline: true, muted: true, autoplay: true }) as HTMLVideoElement;
  let stopCamera: (() => void) | null = null;
  let finished = false;
  const stop = () => {
    finished = true;
    stopCamera?.();
    stopCamera = null;
  };
  const handleCode = (input: string) => {
    if (finished) return;
    const barcode = normalizeBarcode(input);
    if (!barcode) {
      status.textContent = "That barcode isn't valid. Check the digits and try again.";
      return;
    }
    stop();
    void showBarcode(barcode);
  };
  const typed = h("input", {
    name: "barcode",
    inputMode: "numeric",
    autocomplete: "off",
    required: true,
    placeholder: "Digits under the bars",
  }) as HTMLInputElement;
  openDialog(
    "Scan a barcode",
    video,
    status,
    h(
      "form",
      {
        submit: (event: Event) => {
          event.preventDefault();
          handleCode(typed.value);
        },
      },
      h("label", {}, "Or type the barcode", typed),
      h("button", { type: "submit", className: "wide" }, "Look up"),
    ),
  );
  dialog.addEventListener("close", stop, { once: true });
  try {
    // Loaded on demand so that people who never scan don't download the library.
    const { startScanner } = await import("./scanner");
    const stopNow = await startScanner(video, handleCode);
    if (finished) stopNow();
    else {
      stopCamera = stopNow;
      status.textContent = "Point the camera at the barcode.";
    }
  } catch {
    video.hidden = true;
    if (!finished) status.textContent = "The camera isn't available. Check its permission, or type the barcode below.";
  }
}

async function showBarcode(barcode: string): Promise<void> {
  const logAfterSaving = { id: barcodeFoodId(barcode), onSaved: (food: Food) => openLogFood(food) };
  const saved = (await getMyFoods()).find((food) => food.id === barcodeFoodId(barcode));
  if (saved) {
    openLogFood(saved);
    return;
  }
  openDialog("Looking up", h("p", { className: "muted", role: "status" }, `Checking barcode ${barcode}…`));
  const result = await lookupBarcode(barcode);
  if (!dialog.open) return;
  switch (result.status) {
    case "found":
      openLogFood(result.food);
      break;
    case "incomplete":
      openFoodForm(undefined, {
        ...logAfterSaving,
        name: result.name,
        note: "This product has no usable nutrition data. Enter the values from its label.",
      });
      break;
    case "not-found":
      openFoodForm(undefined, {
        ...logAfterSaving,
        name: "",
        note: "This barcode isn't in Open Food Facts. Enter the details from the label, and it'll be remembered next time.",
      });
      break;
    case "error":
      openDialog(
        "Lookup failed",
        h("p", {}, "Open Food Facts couldn't be reached. Check your connection and try again."),
        h("button", { type: "button", className: "primary wide", click: () => void showBarcode(barcode) }, "Try again"),
      );
      break;
  }
}

function portionFields(food: Food, initialGrams: number): { fields: HTMLElement[]; grams: () => number } {
  const preview = h("p", { className: "big" });
  const previewMacros = h("p", { className: "muted" });
  const gramsInput = h("input", {
    type: "number",
    name: "grams",
    value: String(initialGrams),
    min: "0",
    step: "any",
    inputMode: "decimal",
    required: true,
    input: () => update(),
  }) as HTMLInputElement;
  const grams = () => Number(gramsInput.value);
  const update = () => {
    const item = nutrientsFor(food.per100g, isValidGrams(grams()) ? grams() : 0);
    preview.textContent = `${round(item.kcal)} kcal`;
    previewMacros.textContent = macros(item);
  };
  update();
  const portionSelect = food.portions.length
    ? h(
        "label",
        {},
        "Common portion (optional)",
        h(
          "select",
          {
            change: (event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (value) {
                gramsInput.value = value;
                update();
              }
            },
          },
          h("option", { value: "" }, "Enter weight below"),
          ...food.portions.map((portion) =>
            h("option", { value: String(portion.grams) }, `${portion.label} (${portion.grams}g)`),
          ),
        ),
      )
    : null;
  return {
    grams,
    fields: [portionSelect, h("label", {}, "Weight (g)", gramsInput), preview, previewMacros].filter(
      (field): field is HTMLElement => field !== null,
    ),
  };
}

function openLogFood(food: Food): void {
  const { fields, grams } = portionFields(food, 100);
  const form = h(
    "form",
    {
      submit: async (event: Event) => {
        event.preventDefault();
        if (!isValidGrams(grams())) return;
        const entry: LogEntry = {
          ...nutrientsFor(food.per100g, grams()),
          id: newId("entry"),
          date: state.date,
          foodId: food.id,
          name: food.name,
          grams: grams(),
          createdAt: Date.now(),
        };
        // Remembering a scanned product means the next scan needs no connection.
        if (food.source === "barcode") await saveMyFood(food);
        await saveEntry(entry);
        dialog.close();
        await render();
      },
    },
    h("p", { className: "muted" }, `${SOURCE_LABELS[food.source]} · ${round(food.per100g.kcal)} kcal per 100g`),
    food.source === "barcode"
      ? h("p", { className: "muted" }, "Added by the Open Food Facts community, so compare it with the label.")
      : null,
    ...fields,
    h("button", { type: "submit", className: "primary wide" }, `Log to ${formatDate(state.date).toLowerCase()}`),
    food.source === "mine"
      ? null
      : h(
          "div",
          { className: "actions" },
          food.source === "barcode"
            ? h("button", { type: "button", click: () => openFoodForm(food, { id: food.id, onSaved: openLogFood }) }, "Edit values")
            : h("button", { type: "button", click: () => openFoodForm(food) }, "Copy to my foods"),
        ),
  );
  openDialog(food.name, form);
}

async function openEditEntry(entry: LogEntry): Promise<void> {
  // Old entries keep their logged values even if the food later changes or is deleted.
  const food = (await allFoods()).find((candidate) => candidate.id === entry.foodId);
  const per100g = nutrientsFor(entry, (100 * 100) / entry.grams);
  const logged: Food = food ?? { id: entry.foodId, name: entry.name, source: "mine", per100g, portions: [] };
  const { fields, grams } = portionFields({ ...logged, per100g }, entry.grams);
  openDialog(
    entry.name,
    h(
      "form",
      {
        submit: async (event: Event) => {
          event.preventDefault();
          if (!isValidGrams(grams())) return;
          await saveEntry({ ...entry, ...nutrientsFor(per100g, grams()), grams: grams() });
          dialog.close();
          await render();
        },
      },
      ...fields,
      h("button", { type: "submit", className: "primary wide" }, "Save"),
      h(
        "div",
        { className: "actions" },
        h(
          "button",
          {
            type: "button",
            click: async () => {
              await deleteEntry(entry.id);
              dialog.close();
              await render();
            },
          },
          "Remove from log",
        ),
      ),
    ),
  );
}

// ---- Foods ----

interface FoodFormOptions {
  id: string;
  name?: string;
  note?: string;
  onSaved: (food: Food) => void;
}

function openFoodForm(existing?: Food, options?: FoodFormOptions): void {
  const isMine = existing?.source === "mine" || existing?.source === "barcode";
  const values = existing?.per100g;
  const form = h(
    "form",
    {
      submit: async (event: Event) => {
        event.preventDefault();
        const data = new FormData(event.target as HTMLFormElement);
        const read = (name: string) => Number(data.get(name));
        const serving = read("serving");
        if (!(serving > 0)) return;
        const food: Food = {
          id: options?.id ?? (isMine ? existing.id : newId("my")),
          name: String(data.get("name")).trim(),
          source: "mine",
          per100g: scaleToPer100g(
            {
              kcal: read("kcal"),
              protein: read("protein"),
              carbs: read("carbs"),
              fat: read("fat"),
              fibre: read("fibre"),
            },
            serving,
          ),
          portions: existing?.portions ?? [],
        };
        await saveMyFood(food);
        if (options) {
          options.onSaved(food);
          return;
        }
        dialog.close();
        await render();
      },
    },
    options?.note ? h("p", { className: "muted" }, options.note) : null,
    h(
      "label",
      {},
      "Name",
      h("input", { name: "name", value: existing?.name ?? options?.name ?? "", required: true, maxLength: 200 }),
    ),
    numberField("Values below are for this many grams", "serving", 100),
    h(
      "div",
      { className: "grid" },
      numberField("Calories", "kcal", values ? round(values.kcal, 1) : ""),
      numberField("Protein (g)", "protein", values ? round(values.protein, 1) : ""),
      numberField("Carbs (g)", "carbs", values ? round(values.carbs, 1) : ""),
      numberField("Fat (g)", "fat", values ? round(values.fat, 1) : ""),
      numberField("Fibre (g)", "fibre", values ? round(values.fibre, 1) : 0),
    ),
    h("button", { type: "submit", className: "primary wide" }, "Save food"),
    isMine && !options
      ? h(
          "div",
          { className: "actions" },
          h(
            "button",
            {
              type: "button",
              click: async () => {
                await deleteMyFood(existing.id);
                dialog.close();
                await render();
              },
            },
            "Delete food",
          ),
        )
      : null,
  );
  openDialog(isMine ? "Edit food" : "Add my own food", form);
}

// ---- Views ----

async function todayView(): Promise<HTMLElement[]> {
  const [entries, goals] = await Promise.all([getEntries(state.date), getGoals()]);
  const total = sumNutrients(entries);
  const today = localDate();
  const remaining = goals ? goals.kcal - total.kcal : null;
  return [
    h(
      "div",
      { className: "date-bar" },
      h(
        "button",
        { type: "button", "aria-label": "Previous day", click: () => goToDate(shiftDate(state.date, -1)) },
        "‹",
      ),
      h("h1", {}, formatDate(state.date)),
      h(
        "button",
        {
          type: "button",
          "aria-label": "Next day",
          disabled: state.date >= today,
          click: () => goToDate(shiftDate(state.date, 1)),
        },
        "›",
      ),
    ),
    h(
      "section",
      { className: "card" },
      h("div", { className: "big" }, `${round(total.kcal)} kcal`),
      remaining === null
        ? h("p", { className: "muted" }, "Goals are optional. You can set them in Settings.")
        : h(
            "p",
            { className: "muted" },
            remaining >= 0 ? `${round(remaining)} of ${goals!.kcal} left` : `${round(-remaining)} past your ${goals!.kcal} goal`,
          ),
      meter("Protein", total.protein, goals?.protein, "g"),
      meter("Carbs", total.carbs, goals?.carbs, "g"),
      meter("Fat", total.fat, goals?.fat, "g"),
    ),
    h("button", { type: "button", className: "primary wide", click: openAddFood }, "Add food"),
    h("h2", {}, "Logged"),
    entries.length === 0
      ? h("p", { className: "muted" }, "Nothing logged for this day yet.")
      : h(
          "ul",
          { className: "list" },
          ...entries.map((entry) =>
            h(
              "li",
              {},
              h(
                "button",
                { type: "button", className: "row", click: () => void openEditEntry(entry) },
                h(
                  "span",
                  { className: "row-main" },
                  entry.name,
                  h("div", { className: "muted" }, `${round(entry.grams, 1)}g · ${macros(entry)}`),
                ),
                h("span", { className: "row-side" }, `${round(entry.kcal)} kcal`),
              ),
            ),
          ),
        ),
  ];
}

async function foodsView(): Promise<HTMLElement[]> {
  const foods = await getMyFoods();
  return [
    h("h1", {}, "My foods"),
    h(
      "p",
      { className: "muted" },
      `These come first in search, ahead of ${state.reference.length.toLocaleString()} USDA foods.`,
    ),
    h("button", { type: "button", className: "primary wide", click: () => openFoodForm() }, "Add my own food"),
    h("h2", {}, "Saved"),
    foods.length === 0
      ? h("p", { className: "muted" }, "No saved foods yet. Add one here, or copy a USDA food when logging.")
      : h(
          "ul",
          { className: "list" },
          ...foods.map((food) =>
            h(
              "li",
              {},
              h(
                "button",
                { type: "button", className: "row", click: () => openFoodForm(food) },
                h("span", { className: "row-main" }, food.name, h("div", { className: "muted" }, macros(food.per100g))),
                h("span", { className: "row-side" }, `${round(food.per100g.kcal)} kcal/100g`),
              ),
            ),
          ),
        ),
  ];
}

async function historyView(): Promise<HTMLElement[]> {
  const entries = await getAllEntries();
  const byDate = new Map<string, LogEntry[]>();
  for (const entry of entries) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  const dates = [...byDate.keys()].sort().reverse();
  return [
    h("h1", {}, "History"),
    dates.length === 0
      ? h("p", { className: "muted" }, "Days you log will appear here.")
      : h(
          "ul",
          { className: "list" },
          ...dates.map((date) => {
            const total = sumNutrients(byDate.get(date)!);
            return h(
              "li",
              {},
              h(
                "button",
                {
                  type: "button",
                  className: "row",
                  click: () => {
                    state.tab = "today";
                    goToDate(date);
                  },
                },
                h("span", { className: "row-main" }, formatDate(date), h("div", { className: "muted" }, macros(total))),
                h("span", { className: "row-side" }, `${round(total.kcal)} kcal`),
              ),
            );
          }),
        ),
  ];
}

function supportNote(): HTMLElement {
  return h(
    "p",
    { className: "muted" },
    "If tracking food ever feels stressful or hard to stop, it's fine to take a break. Support is available from ",
    h(
      "a",
      { href: "https://www.nationaleatingdisorders.org/get-help/", target: "_blank", rel: "noopener" },
      "the National Eating Disorders Association",
    ),
    ".",
  );
}

function selectField(label: string, name: string, options: Record<string, string>): HTMLElement {
  return h(
    "label",
    {},
    label,
    h(
      "select",
      { name, required: true },
      h("option", { value: "" }, "Choose…"),
      ...Object.entries(options).map(([value, text]) => h("option", { value }, text)),
    ),
  );
}

const LIMIT_NOTES = {
  underweight: "Your weight is already in the underweight range, so this is a maintenance estimate rather than a loss target. A doctor or dietitian can help you choose a safe goal.",
  minimum: "This is as low as the helper goes, so the loss will be slower than usual or none at all. A doctor or dietitian can help you choose a target.",
};

function goalResult(suggestion: GoalSuggestion, onUse: (goals: Goals) => void): HTMLElement {
  const { goals, restingKcal, maintenanceKcal, limit } = suggestion;
  return h(
    "div",
    { className: "card" },
    h("div", { className: "big" }, `${goals.kcal} kcal`),
    h("p", {}, `Protein ${goals.protein}g · Carbs ${goals.carbs}g · Fat ${goals.fat}g`),
    h(
      "p",
      { className: "muted" },
      `Estimated ${restingKcal} kcal at rest and about ${maintenanceKcal} kcal a day to stay the same weight (Mifflin-St Jeor). Real needs vary, so adjust if your weight trend says otherwise.`,
    ),
    limit ? h("p", { className: "error" }, LIMIT_NOTES[limit]) : null,
    h("button", { type: "button", className: "primary wide", click: () => onUse(goals) }, "Use these numbers"),
  );
}

function openGoalHelper(onUse: (goals: Goals) => void): void {
  const metricFields = h(
    "div",
    { className: "grid", hidden: true },
    numberField("Height (cm)", "cm", ""),
    numberField("Weight (kg)", "kg", ""),
  );
  const usFields = h(
    "div",
    {},
    h("div", { className: "grid" }, numberField("Height (ft)", "feet", "", "1"), numberField("Height (in)", "inches", "")),
    numberField("Weight (lb)", "pounds", ""),
  );
  const showUnits = (metric: boolean) => {
    metricFields.hidden = !metric;
    usFields.hidden = metric;
    // A hidden required field would block the form without showing why.
    metricFields.querySelectorAll("input").forEach((input) => (input.disabled = !metric));
    usFields.querySelectorAll("input").forEach((input) => (input.disabled = metric));
  };
  showUnits(false);
  const result = h("div", { role: "status" });
  const form = h(
    "form",
    {
      submit: (event: Event) => {
        event.preventDefault();
        const data = new FormData(event.target as HTMLFormElement);
        const metric = data.get("units") === "metric";
        const input: GoalInput = {
          age: Number(data.get("age")),
          heightCm: metric ? Number(data.get("cm")) : feetToCm(Number(data.get("feet")), Number(data.get("inches"))),
          weightKg: metric ? Number(data.get("kg")) : poundsToKg(Number(data.get("pounds"))),
          sex: data.get("sex") as Sex,
          activity: data.get("activity") as Activity,
          aim: data.get("aim") as Aim,
        };
        if (input.age < MIN_AGE) {
          result.replaceChildren(
            h("p", { className: "error" }, `This helper is for adults ${MIN_AGE} and over. A doctor can advise on nutrition for younger people.`),
          );
        } else if (!isValidGoalInput(input)) {
          result.replaceChildren(h("p", { className: "error" }, "Check your age, height and weight. One of them looks out of range."));
        } else {
          result.replaceChildren(goalResult(suggestGoals(input), onUse));
        }
        result.scrollIntoView({ block: "nearest" });
      },
    },
    h(
      "label",
      {},
      "Units",
      h(
        "select",
        { name: "units", change: (event: Event) => showUnits((event.target as HTMLSelectElement).value === "metric") },
        h("option", { value: "us" }, "lb, ft and in"),
        h("option", { value: "metric" }, "kg and cm"),
      ),
    ),
    h("div", { className: "grid" }, numberField("Age", "age", "", "1"), selectField("Sex (for the formula)", "sex", { female: "Female", male: "Male" })),
    usFields,
    metricFields,
    selectField("Activity", "activity", ACTIVITY_LABELS),
    selectField("Aim", "aim", { lose: "Lose weight gradually", maintain: "Stay about the same", gain: "Gain weight gradually" }),
    h("button", { type: "submit", className: "wide" }, "Suggest goals"),
  );
  openDialog(
    "Help me choose",
    h(
      "p",
      { className: "muted" },
      "A starting estimate for adults, not medical advice. If you're pregnant, breastfeeding, or managing a health condition, ask a doctor or dietitian instead. Nothing you enter here is saved.",
    ),
    form,
    result,
  );
}

async function settingsView(): Promise<HTMLElement[]> {
  const goals = await getGoals();
  const lowGoalNote = h(
    "p",
    { className: "muted", hidden: !goals || goals.kcal >= LOW_GOAL_KCAL },
    `Goals under ${LOW_GOAL_KCAL} kcal a day are very low for most adults. A doctor or dietitian can help you choose a safe target.`,
  );
  const message = h("p", { className: "muted", role: "status" });
  const goalsForm = h(
    "form",
    {
      submit: async (event: Event) => {
        event.preventDefault();
        const data = new FormData(event.target as HTMLFormElement);
        const next: Goals = {
          kcal: Number(data.get("kcal")),
          protein: Number(data.get("protein")),
          carbs: Number(data.get("carbs")),
          fat: Number(data.get("fat")),
        };
        await saveGoals(next);
        lowGoalNote.hidden = next.kcal >= LOW_GOAL_KCAL;
        message.textContent = "Goals saved.";
      },
    },
    h(
      "div",
      { className: "grid" },
      numberField("Calories", "kcal", goals?.kcal ?? 2000, "1"),
      numberField("Protein (g)", "protein", goals?.protein ?? 100, "1"),
      numberField("Carbs (g)", "carbs", goals?.carbs ?? 200, "1"),
      numberField("Fat (g)", "fat", goals?.fat ?? 70, "1"),
    ),
    h("button", { type: "submit", className: "primary wide" }, "Save goals"),
  );
  // Fills the form rather than saving, so the numbers can be changed first.
  const fillGoals = (next: Goals) => {
    for (const [name, value] of Object.entries(next)) {
      goalsForm.querySelector<HTMLInputElement>(`[name=${name}]`)!.value = String(value);
    }
    lowGoalNote.hidden = next.kcal >= LOW_GOAL_KCAL;
    message.textContent = "Suggested numbers filled in. Change anything you like, then save.";
    dialog.close();
  };
  const fileInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    "aria-label": "Backup file",
    change: async (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await importBackup(parseBackup(await file.text()));
        message.textContent = "Backup restored.";
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "That backup couldn't be restored.";
      }
      input.value = "";
    },
  });
  return [
    h("h1", {}, "Settings"),
    h("h2", {}, "Daily goals"),
    goalsForm,
    h("button", { type: "button", className: "wide", style: "margin-top:8px", click: () => openGoalHelper(fillGoals) }, "Help me choose goals"),
    lowGoalNote,
    message,
    h("h2", {}, "Backup"),
    h(
      "p",
      { className: "muted" },
      "Your data is stored only in this browser, and iPhones can clear it, so save a backup now and then.",
    ),
    h("button", { type: "button", className: "wide", click: downloadBackup }, "Save a backup file"),
    h("label", { style: "margin-top:12px" }, "Restore from a backup file (merges with what's here)", fileInput),
    h("h2", {}, "About"),
    h(
      "p",
      { className: "muted" },
      "Food data comes from USDA FoodData Central (public domain). Values are estimates and this app doesn't give medical advice.",
    ),
    h(
      "p",
      { className: "muted" },
      "Barcode lookups contain data from ",
      h("a", { href: "https://world.openfoodfacts.org/", target: "_blank", rel: "noopener" }, "Open Food Facts"),
      ", available under the ",
      h("a", { href: "https://opendatacommons.org/licenses/odbl/1-0/", target: "_blank", rel: "noopener" }, "Open Database License"),
      ".",
    ),
    supportNote(),
  ];
}

async function downloadBackup(): Promise<void> {
  const blob = new Blob([JSON.stringify(await exportBackup())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  h("a", { href: url, download: `calorie-tracker-${localDate()}.json` }).click();
  URL.revokeObjectURL(url);
}

function goToDate(date: string): void {
  state.date = date;
  void render();
}

const TABS: [Tab, string, () => Promise<HTMLElement[]>][] = [
  ["today", "Log", todayView],
  ["foods", "Foods", foodsView],
  ["history", "History", historyView],
  ["settings", "Settings", settingsView],
];

async function render(): Promise<void> {
  const view = TABS.find(([id]) => id === state.tab)!;
  app.replaceChildren(...(await view[2]()));
  tabs.replaceChildren(
    ...TABS.map(([id, label]) =>
      h(
        "button",
        {
          type: "button",
          "aria-current": id === state.tab ? "page" : "false",
          click: () => {
            state.tab = id;
            if (id === "today") state.date = localDate();
            void render();
          },
        },
        label,
      ),
    ),
  );
}

async function loadReference(): Promise<void> {
  try {
    state.reference = (await getReferenceRows(`${import.meta.env.BASE_URL}foods.json`)).map(rowToFood);
  } catch {
    state.referenceError = "The USDA library couldn't load. Your own foods still work; try again when online.";
  }
}

void render()
  .then(loadReference)
  .then(render);
