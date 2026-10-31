import type { Backup } from "./backup";
import type { ReferenceRow } from "./foods";
import type { Food, Goals, LogEntry } from "./nutrition";

const DB_NAME = "calorie-tracker";
const FOODS = "myFoods";
const ENTRIES = "entries";
const META = "meta";

let opened: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(FOODS, { keyPath: "id" });
      db.createObjectStore(ENTRIES, { keyPath: "id" }).createIndex("date", "date");
      db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

export async function getMyFoods(): Promise<Food[]> {
  const foods = await wrap<Food[]>((await store(FOODS)).getAll());
  return foods.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveMyFood(food: Food): Promise<void> {
  await wrap((await store(FOODS, "readwrite")).put(food));
}

export async function deleteMyFood(id: string): Promise<void> {
  await wrap((await store(FOODS, "readwrite")).delete(id));
}

export async function getEntries(date: string): Promise<LogEntry[]> {
  const entries = await wrap<LogEntry[]>((await store(ENTRIES)).index("date").getAll(date));
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAllEntries(): Promise<LogEntry[]> {
  return wrap<LogEntry[]>((await store(ENTRIES)).getAll());
}

export async function saveEntry(entry: LogEntry): Promise<void> {
  await wrap((await store(ENTRIES, "readwrite")).put(entry));
}

export async function deleteEntry(id: string): Promise<void> {
  await wrap((await store(ENTRIES, "readwrite")).delete(id));
}

export async function getGoals(): Promise<Goals | null> {
  return (await wrap<Goals | undefined>((await store(META)).get("goals"))) ?? null;
}

export async function saveGoals(goals: Goals): Promise<void> {
  await wrap((await store(META, "readwrite")).put(goals, "goals"));
}

// The USDA library is cached so that search keeps working without a connection.
export async function getReferenceRows(url: string): Promise<ReferenceRow[]> {
  const cached = await wrap<ReferenceRow[] | undefined>((await store(META)).get("referenceRows"));
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Food library download failed (${response.status})`);
  const rows = (await response.json()) as ReferenceRow[];
  await wrap((await store(META, "readwrite")).put(rows, "referenceRows"));
  return rows;
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: "calorie-tracker",
    version: 1,
    myFoods: await getMyFoods(),
    entries: await getAllEntries(),
    goals: await getGoals(),
  };
}

// Merges by ID in one transaction, so a failed import changes nothing.
export async function importBackup(backup: Backup): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([FOODS, ENTRIES, META], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    for (const food of backup.myFoods) tx.objectStore(FOODS).put(food);
    for (const entry of backup.entries) tx.objectStore(ENTRIES).put(entry);
    if (backup.goals) tx.objectStore(META).put(backup.goals, "goals");
  });
}
