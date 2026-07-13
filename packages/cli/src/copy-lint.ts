export const BANNED_PRODUCT_WORDS = ["simply", "powerful", "seamless", "blazing", "easily"] as const;

export function bannedProductWords(text: string): string[] {
  return BANNED_PRODUCT_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "iu").test(text));
}
