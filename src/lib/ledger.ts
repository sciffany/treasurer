import currenciesData from "@/lib/currency.json";
import {
  CurrencyCode,
  CurrencyInfo,
  Member,
  Transaction,
  TransactionEntry,
} from "@/types/budget";

export const CURRENCIES_MAP: Record<CurrencyCode, CurrencyInfo> =
  currenciesData as Record<CurrencyCode, CurrencyInfo>;

export const CURRENCY_LIST: CurrencyInfo[] = Object.values(CURRENCIES_MAP);

export const CURRENCY_CODES: CurrencyCode[] = Object.keys(
  CURRENCIES_MAP
) as CurrencyCode[];

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = Object.fromEntries(
  CURRENCY_LIST.map((c) => [c.code, c.symbol])
) as Record<CurrencyCode, string>;

export function getCurrencyInfo(currency: CurrencyCode): CurrencyInfo {
  return CURRENCIES_MAP[currency] ?? CURRENCIES_MAP.USD;
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const info = getCurrencyInfo(currency);
  const symbol = info?.symbol ?? "$";
  const decimals = info?.decimal_digits ?? 2;
  return `${symbol}${amount.toFixed(decimals)}`;
}

export interface TransactionSummary {
  payerEntries: TransactionEntry[];
  beneficiaryEntries: TransactionEntry[];
  totalPaid: number;
  totalBenefited: number;
  discrepancy: number; // totalPaid - totalBenefited
  isBalanced: boolean;
}

export function summarizeTransaction(tx: Transaction): TransactionSummary {
  const decimals = getCurrencyInfo(tx.currency).decimal_digits;
  const epsilon = 0.5 * 10 ** -decimals;
  const payerEntries = tx.entries.filter((e) => e.role === "PAYER");
  const beneficiaryEntries = tx.entries.filter((e) => e.role === "BENEFICIARY");

  const totalPaid = roundCents(
    payerEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    decimals
  );
  const totalBenefited = roundCents(
    beneficiaryEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    decimals
  );
  const discrepancy = roundCents(totalPaid - totalBenefited, decimals);

  return {
    payerEntries,
    beneficiaryEntries,
    totalPaid,
    totalBenefited,
    discrepancy,
    isBalanced: Math.abs(discrepancy) < epsilon && totalPaid > 0,
  };
}

export interface MemberBalance {
  member: Member;
  totalPaid: number;
  totalBenefited: number;
  netBalance: number; // positive = owed money back, negative = owes group
}

export interface SettlementTransfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

export function computeBalancesByCurrency(
  transactions: Transaction[],
  members: Member[],
  currency: CurrencyCode
): {
  balances: MemberBalance[];
  settlements: SettlementTransfer[];
} {
  const decimals = getCurrencyInfo(currency).decimal_digits;
  const epsilon = 0.5 * 10 ** -decimals;
  const map = new Map<string, { paid: number; benefited: number }>();
  for (const m of members) {
    map.set(m.id, { paid: 0, benefited: 0 });
  }

  for (const tx of transactions) {
    if (tx.currency !== currency) continue;
    for (const entry of tx.entries) {
      const record = map.get(entry.memberId);
      if (!record) continue;
      if (entry.role === "PAYER") {
        record.paid = roundCents(record.paid + entry.amount, decimals);
      } else {
        record.benefited = roundCents(record.benefited + entry.amount, decimals);
      }
    }
  }

  const balances: MemberBalance[] = members.map((member) => {
    const rec = map.get(member.id) ?? { paid: 0, benefited: 0 };
    return {
      member,
      totalPaid: rec.paid,
      totalBenefited: rec.benefited,
      netBalance: roundCents(rec.paid - rec.benefited, decimals),
    };
  });

  // Compute minimal settlement transfers
  const debtors = balances
    .filter((b) => b.netBalance < -epsilon)
    .map((b) => ({ id: b.member.id, amount: -b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((b) => b.netBalance > epsilon)
    .map((b) => ({ id: b.member.id, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = roundCents(Math.min(debtor.amount, creditor.amount), decimals);

    if (transfer > epsilon) {
      settlements.push({
        fromMemberId: debtor.id,
        toMemberId: creditor.id,
        amount: transfer,
      });
    }

    debtor.amount = roundCents(debtor.amount - transfer, decimals);
    creditor.amount = roundCents(creditor.amount - transfer, decimals);

    if (debtor.amount <= epsilon) i++;
    if (creditor.amount <= epsilon) j++;
  }

  return { balances, settlements };
}

export function roundCents(val: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

/**
 * Returns only the currencies that actually have balance/activity in the ledger,
 * sorted with unsettled net balances first.
 */
export function getCurrenciesWithBalance(
  transactions: Transaction[],
  members: Member[]
): CurrencyInfo[] {
  const seenCodes = new Set<CurrencyCode>();
  for (const tx of transactions) {
    if (tx.currency && CURRENCIES_MAP[tx.currency]) {
      seenCodes.add(tx.currency);
    }
  }

  const withUnsettled: CurrencyInfo[] = [];
  const withActivityOnly: CurrencyInfo[] = [];

  for (const code of seenCodes) {
    const info = getCurrencyInfo(code);
    const epsilon = 0.5 * 10 ** -info.decimal_digits;
    const { balances } = computeBalancesByCurrency(transactions, members, code);

    const hasNetBalance = balances.some((b) => Math.abs(b.netBalance) > epsilon);
    const hasActivity = balances.some(
      (b) => b.totalPaid > epsilon || b.totalBenefited > epsilon
    );

    if (hasNetBalance) {
      withUnsettled.push(info);
    } else if (hasActivity) {
      withActivityOnly.push(info);
    }
  }

  return [...withUnsettled, ...withActivityOnly];
}

/**
 * Compute balances and minimal settlement transfers for a single currency
 * or across all currencies converted into `targetCurrency`.
 */
export function computeConvertedBalances(
  transactions: Transaction[],
  members: Member[],
  filterCurrency: CurrencyCode | "ALL",
  targetCurrency: CurrencyCode,
  getRateToTarget: (from: CurrencyCode) => number
): {
  balances: MemberBalance[];
  settlements: SettlementTransfer[];
} {
  const decimals = getCurrencyInfo(targetCurrency).decimal_digits;
  const epsilon = 0.5 * 10 ** -decimals;
  const map = new Map<string, { paid: number; benefited: number }>();
  for (const m of members) {
    map.set(m.id, { paid: 0, benefited: 0 });
  }

  for (const tx of transactions) {
    if (filterCurrency !== "ALL" && tx.currency !== filterCurrency) continue;
    const rate = getRateToTarget(tx.currency);
    for (const entry of tx.entries) {
      const record = map.get(entry.memberId);
      if (!record) continue;
      const convertedAmount = entry.amount * rate;
      if (entry.role === "PAYER") {
        record.paid = roundCents(record.paid + convertedAmount, decimals);
      } else {
        record.benefited = roundCents(
          record.benefited + convertedAmount,
          decimals
        );
      }
    }
  }

  const balances: MemberBalance[] = members.map((member) => {
    const rec = map.get(member.id) ?? { paid: 0, benefited: 0 };
    return {
      member,
      totalPaid: rec.paid,
      totalBenefited: rec.benefited,
      netBalance: roundCents(rec.paid - rec.benefited, decimals),
    };
  });

  const debtors = balances
    .filter((b) => b.netBalance < -epsilon)
    .map((b) => ({ id: b.member.id, amount: -b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = balances
    .filter((b) => b.netBalance > epsilon)
    .map((b) => ({ id: b.member.id, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: SettlementTransfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = roundCents(
      Math.min(debtor.amount, creditor.amount),
      decimals
    );

    if (transfer > epsilon) {
      settlements.push({
        fromMemberId: debtor.id,
        toMemberId: creditor.id,
        amount: transfer,
      });
    }

    debtor.amount = roundCents(debtor.amount - transfer, decimals);
    creditor.amount = roundCents(creditor.amount - transfer, decimals);

    if (debtor.amount <= epsilon) i++;
    if (creditor.amount <= epsilon) j++;
  }

  return { balances, settlements };
}

/**
 * Built-in approximate exchange rates relative to 1 USD.
 * Used immediately offline and updated when live rates are fetched.
 */
export const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  SGD: 1.34,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 152.0,
  AUD: 1.52,
  CAD: 1.39,
  CHF: 0.88,
  CNY: 7.24,
  HKD: 7.78,
  NZD: 1.66,
  SEK: 10.6,
  KRW: 1380.0,
  MYR: 4.38,
  THB: 33.8,
  IDR: 15700.0,
  INR: 84.0,
  PHP: 58.0,
  TWD: 32.0,
  VND: 25300.0,
  AED: 3.67,
  SAR: 3.75,
  MXN: 20.0,
  BRL: 5.7,
  ZAR: 17.7,
  TRY: 34.2,
  PLN: 4.0,
  DKK: 6.86,
  NOK: 10.9,
  CZK: 23.3,
  HUF: 372.0,
  ILS: 3.74,
  CLP: 960.0,
  COP: 4300.0,
  ARS: 990.0,
  PEN: 3.76,
  EGP: 48.7,
  PKR: 278.0,
  BDT: 119.5,
  LKR: 293.0,
  NPR: 134.0,
  KES: 129.0,
  NGN: 1650.0,
  GHS: 16.0,
  MAD: 9.9,
  QAR: 3.64,
  KWD: 0.31,
  BHD: 0.38,
  OMR: 0.38,
  JOD: 0.71,
  BND: 1.34,
  MOP: 8.01,
  KHR: 4060.0,
  MMK: 2100.0,
};

export function getDefaultExchangeRate(
  from: CurrencyCode,
  to: CurrencyCode,
  usdRates: Record<string, number> = FALLBACK_USD_RATES
): number {
  if (from === to) return 1;
  const fromPerUsd = usdRates[from] ?? FALLBACK_USD_RATES[from] ?? 1;
  const toPerUsd = usdRates[to] ?? FALLBACK_USD_RATES[to] ?? 1;
  if (fromPerUsd <= 0) return 1;
  return toPerUsd / fromPerUsd;
}

