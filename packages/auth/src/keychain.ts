import { Entry } from "@napi-rs/keyring";
import type { TokenSet } from "./oauth.ts";

const SERVICE = "grace";
const ACTIVE_ACCOUNT_KEY = "__active__";

export function saveTokens(email: string, tokens: TokenSet): void {
  new Entry(SERVICE, email).setPassword(JSON.stringify(tokens));
}

export function loadTokens(email: string): TokenSet | null {
  try {
    const raw = new Entry(SERVICE, email).getPassword();
    if (!raw) return null;
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function deleteTokens(email: string): void {
  try {
    new Entry(SERVICE, email).deletePassword();
  } catch {
    // already gone
  }
}

export function saveActiveAccount(email: string): void {
  new Entry(SERVICE, ACTIVE_ACCOUNT_KEY).setPassword(email);
}

export function loadActiveAccount(): string | null {
  try {
    return new Entry(SERVICE, ACTIVE_ACCOUNT_KEY).getPassword();
  } catch {
    return null;
  }
}

export function clearActiveAccount(): void {
  try {
    new Entry(SERVICE, ACTIVE_ACCOUNT_KEY).deletePassword();
  } catch {
    // already gone
  }
}
