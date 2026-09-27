import "server-only";
import { randomInt } from "node:crypto";
import { bangkokNow } from "./sheets";

// No 0/O/1/I/L to keep it easy to read aloud over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** e.g. LC-260928-4F7K. 31^4 ≈ 923k combinations per day, plenty for 30/month. */
export function newRequestNo(): string {
  const d = bangkokNow().slice(2, 10).replace(/-/g, ""); // YYMMDD in Bangkok time
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `LC-${d}-${s}`;
}
