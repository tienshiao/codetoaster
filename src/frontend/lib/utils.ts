import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge has to be told about the v2 type scale. It classifies an
// unknown `text-*` by guessing from the value, and `micro` does not look like a
// size — so it lands in the text-colour group, and `cn("text-micro", "text-…")`
// silently drops the size whenever a colour follows it. Every other step in the
// scale is already a name it knows; only `micro` is new, but the group has to
// be restated in full to extend it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "xs", "sm", "base", "lg", "xl", "2xl"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
