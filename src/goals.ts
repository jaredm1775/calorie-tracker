import type { Goals } from "./nutrition";

export type Sex = "female" | "male";
export type Aim = "lose" | "maintain" | "gain";
export type Activity = "sedentary" | "light" | "moderate" | "very";

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: "Mostly sitting, little exercise",
  light: "Light exercise 1–3 days a week",
  moderate: "Moderate exercise 3–5 days a week",
  very: "Hard exercise 6–7 days a week",
};

const ACTIVITY_FACTORS: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };

const MAX_DEFICIT_KCAL = 500;
const MAX_DEFICIT_SHARE = 0.2;
const SURPLUS_KCAL = 250;
const MIN_KCAL: Record<Sex, number> = { female: 1200, male: 1500 };
const UNDERWEIGHT_BMI = 18.5;
const HEALTHY_TOP_BMI = 25;
const PROTEIN_PER_KG = 1.6;
const FAT_SHARE = 0.3;

export const MIN_AGE = 18;
const LIMITS = { age: [MIN_AGE, 100], heightCm: [120, 230], weightKg: [35, 300] } as const;

export interface GoalInput {
  age: number;
  heightCm: number;
  weightKg: number;
  sex: Sex;
  activity: Activity;
  aim: Aim;
}

export interface GoalSuggestion {
  goals: Goals;
  restingKcal: number;
  maintenanceKcal: number;
  // Why the suggestion differs from the aim that was chosen, if it does.
  limit: "underweight" | "minimum" | null;
}

export function feetToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function poundsToKg(pounds: number): number {
  return pounds * 0.45359237;
}

export function isValidGoalInput({ age, heightCm, weightKg }: GoalInput): boolean {
  const within = (value: number, [low, high]: readonly [number, number]) => value >= low && value <= high;
  return within(age, LIMITS.age) && within(heightCm, LIMITS.heightCm) && within(weightKg, LIMITS.weightKg);
}

function bmi(weightKg: number, heightCm: number): number {
  return weightKg / (heightCm / 100) ** 2;
}

function targetKcal(input: GoalInput, maintenance: number): { kcal: number; limit: GoalSuggestion["limit"] } {
  if (input.aim === "gain") return { kcal: maintenance + SURPLUS_KCAL, limit: null };
  if (input.aim === "maintain") return { kcal: maintenance, limit: null };
  if (bmi(input.weightKg, input.heightCm) < UNDERWEIGHT_BMI) return { kcal: maintenance, limit: "underweight" };
  const wanted = maintenance - Math.min(MAX_DEFICIT_KCAL, maintenance * MAX_DEFICIT_SHARE);
  const minimum = MIN_KCAL[input.sex];
  // Someone who maintains below the minimum gets maintenance, never a surplus labelled as loss.
  return wanted >= minimum ? { kcal: wanted, limit: null } : { kcal: Math.min(maintenance, minimum), limit: "minimum" };
}

// Calories use the Mifflin-St Jeor equation. Protein stops scaling at the top of
// the healthy weight range, because it follows lean mass rather than total weight.
export function suggestGoals(input: GoalInput): GoalSuggestion {
  const { age, heightCm, weightKg, sex, activity } = input;
  const resting = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
  const maintenance = resting * ACTIVITY_FACTORS[activity];
  const { kcal: target, limit } = targetKcal(input, maintenance);
  const kcal = Math.round(target / 10) * 10;
  const proteinWeight = Math.min(weightKg, HEALTHY_TOP_BMI * (heightCm / 100) ** 2);
  const protein = Math.round(proteinWeight * PROTEIN_PER_KG);
  const fat = Math.round((kcal * FAT_SHARE) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    goals: { kcal, protein, carbs, fat },
    restingKcal: Math.round(resting),
    maintenanceKcal: Math.round(maintenance),
    limit,
  };
}
