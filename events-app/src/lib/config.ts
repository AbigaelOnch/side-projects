import pkg from "../../package.json";

export const APP_NAME = process.env.APP_NAME || "Afro Social";
export const VERSION: string = pkg.version;

export const CATEGORIES = [
  { id: "networking", label: "Networking" },
  { id: "career", label: "Career & tech" },
  { id: "social", label: "Social & culture" },
  { id: "wellness", label: "Wellness" },
  { id: "dating", label: "Dating" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];
export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const TABS = [
  { id: "tonight", label: "Tonight" },
  { id: "weekend", label: "This weekend" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All upcoming" },
] as const;
export type TabId = (typeof TABS)[number]["id"];
export const DEFAULT_TAB: TabId = "week";

export const PAGE_SIZE = 12;
