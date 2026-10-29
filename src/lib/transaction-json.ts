import {
  CurrencyCode,
  EntryRole,
  Member,
  PaymentMethod,
  Transaction,
  TransactionEntry,
} from "@/types/budget";
import { CURRENCIES_MAP, getCurrencyInfo, roundCents } from "@/lib/ledger";

export const VALID_PAYMENT_METHODS: PaymentMethod[] = [
  "Credit Card",
  "PayNow",
  "Cash",
  "Bank Transfer",
  "Debit Card",
  "Apple Pay",
];

export const VALID_CATEGORIES = [
  "Groceries",
  "Dining",
  "Insurance",
  "Accommodation",
  "Transport",
  "Utilities",
  "Entertainment",
  "Other",
] as const;

export interface SerializedTransactionEntry {
  id?: string;
  role: EntryRole;
  memberId: string;
  memberName?: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  label?: string;
}

export interface SerializedTransaction {
  title: string;
  date: string;
  currency: CurrencyCode;
  category: string;
  notes?: string;
  entries: SerializedTransactionEntry[];
}

export interface ParsedTransactionJsonResult {
  title?: string;
  date?: string;
  currency?: CurrencyCode;
  category?: string;
  notes?: string;
  entries: TransactionEntry[];
  newMembersToCreate: { id: string; name: string }[];
}

function normalizeMemberKey(str: string): string {
  return str.trim().toLowerCase();
}

/**
 * Resolves a member reference (either memberId like "m-alice" or a name like "Alice")
 * against the existing group members, or queues a new member if not found.
 */
export function resolveMemberReference(
  ref: string,
  members: Member[],
  pendingNewMembers: Map<string, { id: string; name: string }>
): { memberId: string; memberName: string } {
  const trimmed = (ref || "").trim();
  if (!trimmed) {
    const fallback = members[0];
    return {
      memberId: fallback?.id ?? "m-unknown",
      memberName: fallback?.name ?? "Unknown",
    };
  }

  const key = normalizeMemberKey(trimmed);

  // 1. Match by exact ID or case-insensitive ID
  const byId = members.find((m) => normalizeMemberKey(m.id) === key);
  if (byId) {
    return { memberId: byId.id, memberName: byId.name };
  }

  // 2. Match by case-insensitive name
  const byName = members.find((m) => normalizeMemberKey(m.name) === key);
  if (byName) {
    return { memberId: byName.id, memberName: byName.name };
  }

  // 3. Match if ref is "m-<name>" where <name> matches an existing member
  if (key.startsWith("m-")) {
    const stripped = key.slice(2);
    const byStripped = members.find(
      (m) => normalizeMemberKey(m.name) === stripped
    );
    if (byStripped) {
      return { memberId: byStripped.id, memberName: byStripped.name };
    }
  }

  // 4. Check if already queued in pendingNewMembers
  const existingPending = pendingNewMembers.get(key);
  if (existingPending) {
    return {
      memberId: existingPending.id,
      memberName: existingPending.name,
    };
  }

  // 5. Create a new member entry
  const cleanName = trimmed.startsWith("m-")
    ? trimmed.slice(2).replace(/^\w/, (c) => c.toUpperCase())
    : trimmed;
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const newId = `m-${slug || Date.now()}`;
  const created = { id: newId, name: cleanName };
  pendingNewMembers.set(key, created);
  return { memberId: created.id, memberName: created.name };
}

function normalizeRole(rawRole: unknown): EntryRole {
  if (typeof rawRole === "string") {
    const upper = rawRole.trim().toUpperCase();
    if (upper === "PAYER" || upper === "PAYEE" || upper === "PAID") {
      return "PAYER";
    }
    if (
      upper === "BENEFICIARY" ||
      upper === "CONSUMER" ||
      upper === "OWES" ||
      upper === "SHARE"
    ) {
      return "BENEFICIARY";
    }
  }
  throw new Error(
    `Invalid entry role "${String(rawRole)}". Expected "PAYER" or "BENEFICIARY".`
  );
}

function normalizePaymentMethod(
  rawMethod: unknown,
  role: EntryRole
): PaymentMethod | undefined {
  if (role !== "PAYER") return undefined;
  if (typeof rawMethod !== "string" || !rawMethod.trim()) {
    return "Credit Card";
  }
  const match = VALID_PAYMENT_METHODS.find(
    (pm) => pm.toLowerCase() === rawMethod.trim().toLowerCase()
  );
  return match ?? "Credit Card";
}

/**
 * Serializes a Transaction or draft state into human-friendly JSON
 * that includes both `memberId` and `memberName` for clarity.
 */
export function serializeTransactionToJson(
  tx: {
    title: string;
    date: string;
    currency: CurrencyCode;
    category: string;
    notes?: string;
    entries: TransactionEntry[];
  },
  members: Member[]
): string {
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const payload: SerializedTransaction = {
    title: tx.title,
    date: tx.date,
    currency: tx.currency,
    category: tx.category,
    ...(tx.notes ? { notes: tx.notes } : {}),
    entries: tx.entries.map((e) => ({
      id: e.id,
      role: e.role,
      memberId: e.memberId,
      memberName: memberMap.get(e.memberId) ?? e.memberId,
      amount: e.amount,
      ...(e.role === "PAYER"
        ? { paymentMethod: e.paymentMethod ?? "Credit Card" }
        : {}),
      ...(e.label ? { label: e.label } : {}),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Parses and validates a JSON string representing either:
 * 1. A full Transaction object `{ title?, date?, currency?, category?, notes?, entries: [...] }`
 * 2. A Transaction object with `{ payers: [...], beneficiaries: [...] }` shorthand
 * 3. A standalone array of mini-transactions `[ { role, memberId/memberName, amount, ... } ]`
 */
export function parseTransactionJson(
  jsonText: string,
  members: Member[],
  fallbackCurrency: CurrencyCode = "SGD"
): ParsedTransactionJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const pendingNewMembers = new Map<string, { id: string; name: string }>();

  let rawEntries: unknown[] = [];
  let title: string | undefined;
  let date: string | undefined;
  let currency: CurrencyCode | undefined;
  let category: string | undefined;
  let notes: string | undefined;

  if (Array.isArray(raw)) {
    rawEntries = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (typeof obj.title === "string") title = obj.title;
    if (typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)) {
      date = obj.date;
    }
    if (typeof obj.currency === "string") {
      const upperCurr = obj.currency.trim().toUpperCase() as CurrencyCode;
      if (upperCurr in CURRENCIES_MAP) {
        currency = upperCurr;
      }
    }
    if (typeof obj.category === "string" && obj.category.trim()) {
      category = obj.category.trim();
    }
    if (typeof obj.notes === "string") {
      notes = obj.notes;
    }

    if (Array.isArray(obj.entries)) {
      rawEntries = obj.entries;
    } else if (Array.isArray(obj.payers) || Array.isArray(obj.beneficiaries)) {
      const payers = Array.isArray(obj.payers)
        ? obj.payers.map((p) =>
            typeof p === "object" && p !== null
              ? { ...p, role: "PAYER" }
              : p
          )
        : [];
      const beneficiaries = Array.isArray(obj.beneficiaries)
        ? obj.beneficiaries.map((b) =>
            typeof b === "object" && b !== null
              ? { ...b, role: "BENEFICIARY" }
              : b
          )
        : [];
      rawEntries = [...payers, ...beneficiaries];
    } else {
      throw new Error(
        'JSON object must contain an "entries" array (or "payers" and "beneficiaries" arrays).'
      );
    }
  } else {
    throw new Error(
      "JSON must be a Transaction object or an array of mini-transaction entries."
    );
  }

  const activeCurr = currency ?? fallbackCurrency;
  const decimals = getCurrencyInfo(activeCurr).decimal_digits;

  const entries: TransactionEntry[] = rawEntries.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Entry at index ${idx} must be an object.`);
    }
    const rec = item as Record<string, unknown>;
    const role = normalizeRole(rec.role);

    const rawMemberRef =
      (typeof rec.memberId === "string" && rec.memberId) ||
      (typeof rec.memberName === "string" && rec.memberName) ||
      (typeof rec.member === "string" && rec.member) ||
      "";

    if (!rawMemberRef) {
      throw new Error(
        `Entry at index ${idx} is missing "memberId" or "memberName".`
      );
    }

    const { memberId } = resolveMemberReference(
      rawMemberRef,
      members,
      pendingNewMembers
    );

    const parsedAmount = Number(rec.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      throw new Error(
        `Entry at index ${idx} has an invalid amount "${String(rec.amount)}".`
      );
    }

    const amount = roundCents(parsedAmount, decimals);
    const paymentMethod = normalizePaymentMethod(rec.paymentMethod, role);
    const label =
      typeof rec.label === "string" && rec.label.trim()
        ? rec.label.trim()
        : undefined;
    const id =
      typeof rec.id === "string" && rec.id.trim()
        ? rec.id.trim()
        : `entry-${Date.now()}-${idx}`;

    return {
      id,
      role,
      memberId,
      amount,
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(label ? { label } : {}),
    };
  });

  return {
    title,
    date,
    currency,
    category,
    notes,
    entries,
    newMembersToCreate: Array.from(pendingNewMembers.values()),
  };
}

/**
 * Deterministic Composable Ledger Builder used by AI Tool Calls.
 * Executes high-level tool invocations (set_metadata, add_payer, add_beneficiary,
 * split_equally, record_self_paid) so all split math and cent rounding is 100% exact.
 */
export interface ExecutedToolCallSummary {
  toolName: string;
  args: Record<string, unknown>;
  description: string;
}

export class DeterministicTransactionBuilder {
  private title: string;
  private date: string;
  private currency: CurrencyCode;
  private category: string;
  private notes?: string;
  private entries: TransactionEntry[] = [];
  private members: Member[];
  private pendingNewMembers = new Map<string, { id: string; name: string }>();
  private toolLog: ExecutedToolCallSummary[] = [];
  private entryCounter = 1;

  constructor(options: {
    members: Member[];
    defaultCurrency: CurrencyCode;
    defaultDate: string;
    initialDraft?: Partial<Transaction>;
  }) {
    this.members = options.members;
    this.currency = options.initialDraft?.currency ?? options.defaultCurrency;
    this.date = options.initialDraft?.date ?? options.defaultDate;
    this.title = options.initialDraft?.title ?? "Group Expense";
    this.category = options.initialDraft?.category ?? "Other";
    this.notes = options.initialDraft?.notes;
    if (options.initialDraft?.entries?.length) {
      this.entries = [...options.initialDraft.entries];
    }
  }

  private nextEntryId(prefix: string): string {
    return `${prefix}-${Date.now()}-${this.entryCounter++}`;
  }

  private get decimals(): number {
    return getCurrencyInfo(this.currency).decimal_digits;
  }

  public get totalPaid(): number {
    return roundCents(
      this.entries
        .filter((e) => e.role === "PAYER")
        .reduce((sum, e) => sum + e.amount, 0),
      this.decimals
    );
  }

  public get totalBenefited(): number {
    return roundCents(
      this.entries
        .filter((e) => e.role === "BENEFICIARY")
        .reduce((sum, e) => sum + e.amount, 0),
      this.decimals
    );
  }

  public setMetadata(args: {
    title: string;
    date?: string | null;
    currency?: string | null;
    category?: string | null;
    notes?: string | null;
  }) {
    if (args.title?.trim()) {
      this.title = args.title.trim();
    }
    if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date.trim())) {
      this.date = args.date.trim();
    }
    if (args.currency) {
      const upper = args.currency.trim().toUpperCase() as CurrencyCode;
      if (upper in CURRENCIES_MAP) {
        this.currency = upper;
      }
    }
    if (args.category?.trim()) {
      this.category = args.category.trim();
    }
    if (args.notes !== undefined && args.notes !== null) {
      this.notes = args.notes.trim() || undefined;
    }

    this.toolLog.push({
      toolName: "set_metadata",
      args,
      description: `Set transaction "${this.title}" (${this.category}, ${this.currency})`,
    });
  }

  public addPayer(args: {
    member: string;
    amount: number;
    paymentMethod?: PaymentMethod | null;
    label?: string | null;
  }) {
    const resolved = resolveMemberReference(
      args.member,
      this.members,
      this.pendingNewMembers
    );
    const amount = roundCents(Number(args.amount) || 0, this.decimals);
    const paymentMethod = normalizePaymentMethod(
      args.paymentMethod ?? "Credit Card",
      "PAYER"
    );
    const label = args.label?.trim() || "Paid at checkout";

    this.entries.push({
      id: this.nextEntryId("ai-p"),
      role: "PAYER",
      memberId: resolved.memberId,
      amount,
      paymentMethod,
      label,
    });

    this.toolLog.push({
      toolName: "add_payer",
      args,
      description: `Added payer ${resolved.memberName}: ${amount} (${paymentMethod})`,
    });
  }

  public addBeneficiary(args: {
    member: string;
    amount: number;
    label?: string | null;
  }) {
    const resolved = resolveMemberReference(
      args.member,
      this.members,
      this.pendingNewMembers
    );
    const amount = roundCents(Number(args.amount) || 0, this.decimals);
    const label = args.label?.trim() || "Item / share";

    this.entries.push({
      id: this.nextEntryId("ai-b"),
      role: "BENEFICIARY",
      memberId: resolved.memberId,
      amount,
      label,
    });

    this.toolLog.push({
      toolName: "add_beneficiary",
      args,
      description: `Added beneficiary ${resolved.memberName}: ${amount} (${label})`,
    });
  }

  public splitEqually(args: {
    members: string[];
    amount?: number | null;
    useRemainingUnallocated: boolean;
    label?: string | null;
  }) {
    const targetRefs =
      args.members && args.members.length > 0
        ? args.members
        : this.members.map((m) => m.name);

    const resolvedMembers = targetRefs.map((ref) =>
      resolveMemberReference(ref, this.members, this.pendingNewMembers)
    );

    if (resolvedMembers.length === 0) return;

    const decimals = this.decimals;
    let totalToSplit = 0;

    if (args.useRemainingUnallocated) {
      totalToSplit = roundCents(this.totalPaid - this.totalBenefited, decimals);
    } else if (typeof args.amount === "number" && args.amount > 0) {
      totalToSplit = roundCents(args.amount, decimals);
    } else {
      totalToSplit = roundCents(this.totalPaid - this.totalBenefited, decimals);
    }

    if (totalToSplit <= 0) return;

    const count = resolvedMembers.length;
    const factor = 10 ** decimals;
    const unit = 1 / factor;
    const baseShare = Math.floor((totalToSplit / count) * factor) / factor;
    let leftover = roundCents(totalToSplit - baseShare * count, decimals);

    const baseLabel = args.label?.trim() || "Shared split";

    resolvedMembers.forEach((rm) => {
      const extraUnit = leftover > unit / 2 ? unit : 0;
      leftover = roundCents(leftover - extraUnit, decimals);
      const memberAmount = roundCents(baseShare + extraUnit, decimals);

      this.entries.push({
        id: this.nextEntryId("ai-split"),
        role: "BENEFICIARY",
        memberId: rm.memberId,
        amount: memberAmount,
        label: `${baseLabel} (1/${count})`,
      });
    });

    this.toolLog.push({
      toolName: "split_equally",
      args,
      description: `Split ${totalToSplit} equally across ${resolvedMembers
        .map((m) => m.memberName)
        .join(", ")}`,
    });
  }

  public recordSelfPaid(args: {
    member: string;
    amount: number;
    paymentMethod?: PaymentMethod | null;
    label?: string | null;
  }) {
    const resolved = resolveMemberReference(
      args.member,
      this.members,
      this.pendingNewMembers
    );
    const amount = roundCents(Number(args.amount) || 0, this.decimals);
    const paymentMethod = normalizePaymentMethod(
      args.paymentMethod ?? "PayNow",
      "PAYER"
    );
    const baseLabel = args.label?.trim() || `${resolved.memberName}'s tier`;

    this.entries.push({
      id: this.nextEntryId("ai-sp-p"),
      role: "PAYER",
      memberId: resolved.memberId,
      amount,
      paymentMethod,
      label: `${baseLabel} (paid)`,
    });

    this.entries.push({
      id: this.nextEntryId("ai-sp-b"),
      role: "BENEFICIARY",
      memberId: resolved.memberId,
      amount,
      label: `${baseLabel} (own coverage)`,
    });

    this.toolLog.push({
      toolName: "record_self_paid",
      args,
      description: `Recorded self-paid entry for ${resolved.memberName}: ${amount} (${paymentMethod})`,
    });
  }

  /**
   * If the user only described beneficiary items and mentioned who paid the receipt
   * without specifying the total paid (or if there is 1 payer with 0 amount),
   * sync that single payer's amount to match the sum of beneficiary entries.
   */
  public finalizeAndBalanceIfNeeded() {
    const payers = this.entries.filter((e) => e.role === "PAYER");
    const beneficiaries = this.entries.filter((e) => e.role === "BENEFICIARY");

    if (
      payers.length === 1 &&
      payers[0].amount === 0 &&
      this.totalBenefited > 0
    ) {
      payers[0].amount = this.totalBenefited;
    } else if (
      payers.length === 0 &&
      beneficiaries.length > 0 &&
      this.members.length > 0
    ) {
      // Fallback: if no payer was explicitly called, attribute payment to first member
      this.entries.unshift({
        id: this.nextEntryId("ai-p-auto"),
        role: "PAYER",
        memberId: this.members[0].id,
        amount: this.totalBenefited,
        paymentMethod: "Credit Card",
        label: "Paid receipt total",
      });
    }
  }

  public buildResult(): {
    transaction: Omit<Transaction, "id">;
    serializedJson: string;
    newMembersToCreate: { id: string; name: string }[];
    toolCalls: ExecutedToolCallSummary[];
  } {
    this.finalizeAndBalanceIfNeeded();

    const allKnownMembers: Member[] = [
      ...this.members,
      ...Array.from(this.pendingNewMembers.values()).map((nm) => ({
        id: nm.id,
        name: nm.name,
        avatarColor: "bg-violet-500",
      })),
    ];

    const transaction: Omit<Transaction, "id"> = {
      title: this.title,
      date: this.date,
      currency: this.currency,
      category: this.category,
      ...(this.notes ? { notes: this.notes } : {}),
      entries: this.entries,
    };

    const serializedJson = serializeTransactionToJson(
      transaction,
      allKnownMembers
    );

    return {
      transaction,
      serializedJson,
      newMembersToCreate: Array.from(this.pendingNewMembers.values()),
      toolCalls: this.toolLog,
    };
  }
}
