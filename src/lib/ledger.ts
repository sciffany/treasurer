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
