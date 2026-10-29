import currenciesData from "@/lib/currency.json";

export type CurrencyCode = keyof typeof currenciesData;

export interface CurrencyInfo {
  symbol: string;
  name: string;
  symbol_native: string;
  decimal_digits: number;
  rounding: number;
  code: CurrencyCode;
  name_plural: string;
}

export type PaymentMethod =
  | "Credit Card"
  | "PayNow"
  | "Cash"
  | "Bank Transfer"
  | "Debit Card"
  | "Apple Pay";

export type EntryRole = "PAYER" | "BENEFICIARY";

export interface Member {
  id: string;
  name: string;
  avatarColor: string;
}

/**
 * Atomic sub-row ("MiniTransaction").
 * By convention, each TransactionEntry represents EITHER:
 * - 1 Payer (role === "PAYER"): money paid into the transaction by `memberId`
 * - 1 Beneficiary (role === "BENEFICIARY"): value/item consumed by `memberId`
 */
export interface TransactionEntry {
  id: string;
  role: EntryRole;
  memberId: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  label?: string; // e.g., "Milk & Eggs", "Own insurance premium", "Card payment"
}

/**
 * Main row representing a group event, receipt, or bill.
 * Records shared metadata (currency, date, category) for all entries within it.
 */
export interface Transaction {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  currency: CurrencyCode;
  category: string;
  notes?: string;
  entries: TransactionEntry[];
}
