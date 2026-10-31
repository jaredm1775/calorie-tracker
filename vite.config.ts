import { defineConfig } from "vite";

const base = process.env.GITHUB_ACTIONS === "true" ? "/calorie-tracker/" : "/";

export default defineConfig({ base });
