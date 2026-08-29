import example from "./example.js";
import type { TranslationPack } from "../types.js";

export const translationPacks = Object.freeze([
  example,
]) satisfies readonly TranslationPack[];
