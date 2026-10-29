"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Coins,
  CreditCard,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  Wand2,
  Wrench,
  X,
  AlertCircle,
  CopyCheck,
} from "lucide-react";
import {
  CurrencyCode,
  EntryRole,
  Member,
  PaymentMethod,
  Transaction,
  TransactionEntry,
} from "@/types/budget";
import { INITIAL_MEMBERS, INITIAL_TRANSACTIONS } from "@/lib/sample-data";
import {
  CURRENCY_LIST,
  FALLBACK_USD_RATES,
  computeBalancesByCurrency,
  computeConvertedBalances,
  formatCurrency,
  getCurrenciesWithBalance,
  getCurrencyInfo,
  getDefaultExchangeRate,
  roundCents,
  summarizeTransaction,
} from "@/lib/ledger";
import {
  ExecutedToolCallSummary,
  parseTransactionJson,
  serializeTransactionToJson,
} from "@/lib/transaction-json";

const PAYMENT_METHODS: PaymentMethod[] = [
  "Credit Card",
  "PayNow",
  "Cash",
  "Bank Transfer",
  "Debit Card",
  "Apple Pay",
];
const CATEGORIES = [
  "Groceries",
  "Dining",
  "Insurance",
  "Accommodation",
  "Transport",
  "Utilities",
  "Entertainment",
  "Other",
];
const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-indigo-500",
];

const STORAGE_KEYS = {
  members: "treasurer:members",
  transactions: "treasurer:transactions",
  activeCurrency: "treasurer:activeCurrency",
  openAiKey: "treasurer:openAiKey",
} as const;

const AI_EXAMPLE_PROMPTS = [
  "Alice paid $84.50 by Credit Card for groceries; Bob had $14.50 cold brew, Charlie had $28 steak, Alice had $12 yogurt, and split the rest equally among Alice, Bob, and Charlie",
  "Bob paid $120 on Credit Card and Diana paid $40 Cash for Hotpot dinner, split equally among Alice, Bob, Charlie, and Diana",
  "Group Travel Insurance: Alice paid $115 via PayNow for Standard Plan, Bob paid $145 via Credit Card for Winter Sports Plan, Charlie paid $115 via PayNow for Standard Plan (each person's own coverage)",
];

export default function GroupBudgetPage() {
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [transactions, setTransactions] =
    useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [expandedTxIds, setExpandedTxIds] = useState<Record<string, boolean>>(
    {},
  );
  const [activeCurrency, setActiveCurrency] = useState<CurrencyCode>("SGD");
  const [isHydrated, setIsHydrated] = useState(false);

  // Per-transaction inline JSON editor state on main list cards
  const [cardJsonOpenIds, setCardJsonOpenIds] = useState<
    Record<string, boolean>
  >({});
  const [cardJsonTexts, setCardJsonTexts] = useState<Record<string, string>>(
    {},
  );
  const [cardJsonErrors, setCardJsonErrors] = useState<
    Record<string, string | null>
  >({});
  const [cardJsonSavedIds, setCardJsonSavedIds] = useState<
    Record<string, boolean>
  >({});

  // AI & JSON Composer state
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiToolCalls, setAiToolCalls] = useState<ExecutedToolCallSummary[]>([]);
  const [openAiKey, setOpenAiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const [isJsonPanelOpen, setIsJsonPanelOpen] = useState(true);
  const [jsonInputText, setJsonInputText] = useState("");
  const [isJsonDirty, setIsJsonDirty] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonAppliedBadge, setJsonAppliedBadge] = useState(false);

  // Load saved state from localStorage on mount
  useEffect(() => {
    try {
      const savedMembers = localStorage.getItem(STORAGE_KEYS.members);
      if (savedMembers) {
        const parsed = JSON.parse(savedMembers);
        if (Array.isArray(parsed)) setMembers(parsed);
      }

      const savedTransactions = localStorage.getItem(STORAGE_KEYS.transactions);
      if (savedTransactions) {
        const parsed = JSON.parse(savedTransactions);
        if (Array.isArray(parsed)) setTransactions(parsed);
      }

      const savedCurrency = localStorage.getItem(STORAGE_KEYS.activeCurrency);
      if (savedCurrency) {
        setActiveCurrency(savedCurrency as CurrencyCode);
      }

      const savedKey = localStorage.getItem(STORAGE_KEYS.openAiKey);
      if (savedKey) {
        setOpenAiKey(savedKey);
      }
    } catch (err) {
      console.error("Failed to load data from localStorage:", err);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEYS.members, JSON.stringify(members));
      localStorage.setItem(
        STORAGE_KEYS.transactions,
        JSON.stringify(transactions),
      );
      localStorage.setItem(STORAGE_KEYS.activeCurrency, activeCurrency);
      if (openAiKey) {
        localStorage.setItem(STORAGE_KEYS.openAiKey, openAiKey);
      } else {
        localStorage.removeItem(STORAGE_KEYS.openAiKey);
      }
    } catch (err) {
      console.error("Failed to save data to localStorage:", err);
    }
  }, [members, transactions, activeCurrency, openAiKey, isHydrated]);

  // New & Edit Member state
  const [newMemberName, setNewMemberName] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState("");
  const [editingMemberColor, setEditingMemberColor] = useState(
    AVATAR_COLORS[0],
  );

  // Transaction Form Modal / Drawer state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("2026-10-29");
  const [currency, setCurrency] = useState<CurrencyCode>("SGD");
  const [category, setCategory] = useState("Groceries");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<TransactionEntry[]>([]);

  // Temporary currency translation state (non-destructive preview)
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateCurrency, setTranslateCurrency] =
    useState<CurrencyCode>("USD");
  const [combineAllInLedger, setCombineAllInLedger] = useState(false);
  const [usdRates, setUsdRates] =
    useState<Record<string, number>>(FALLBACK_USD_RATES);
  // Per-source-currency custom conversion overrides: { [fromCode]: { base: string, target: string } }
  const [customConversions, setCustomConversions] = useState<
    Record<string, { base: string; target: string }>
  >({});

  // Fetch live exchange rates in background (falls back to FALLBACK_USD_RATES offline)
  useEffect(() => {
    let cancelled = false;
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.rates && typeof data.rates === "object") {
          setUsdRates((prev) => ({ ...prev, ...data.rates }));
        }
      })
      .catch(() => {
        // Ignore network errors; FALLBACK_USD_RATES will be used
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  // Only currencies that actually have balance in the ledger
  const ledgerCurrencies = useMemo(() => {
    const withBalance = getCurrenciesWithBalance(transactions, members);
    if (withBalance.length > 0) return withBalance;
    return [getCurrencyInfo(activeCurrency)];
  }, [transactions, members, activeCurrency]);

  // Ensure activeCurrency stays valid among currencies that actually have balance
  useEffect(() => {
    if (
      ledgerCurrencies.length > 0 &&
      !ledgerCurrencies.some((c) => c.code === activeCurrency)
    ) {
      setActiveCurrency(ledgerCurrencies[0].code);
    }
  }, [ledgerCurrencies, activeCurrency]);

  const getDefaultPairValues = useCallback(
    (from: CurrencyCode, to: CurrencyCode) => {
      if (from === to) {
        return { base: "1", target: "1" };
      }
      const rawRate = getDefaultExchangeRate(from, to, usdRates);
      const baseNum = rawRate < 0.05 ? 100 : 1;
      const toDecimals = Math.max(2, getCurrencyInfo(to).decimal_digits);
      const targetVal = roundCents(
        baseNum * rawRate,
        rawRate * baseNum < 1 ? 4 : toDecimals
      );
      return {
        base: String(baseNum),
        target: String(targetVal),
      };
    },
    [usdRates]
  );

  const getConversionPair = useCallback(
    (from: CurrencyCode) => {
      const key = `${from}->${translateCurrency}`;
      return (
        customConversions[key] ?? getDefaultPairValues(from, translateCurrency)
      );
    },
    [customConversions, translateCurrency, getDefaultPairValues]
  );

  const getRateToTarget = useCallback(
    (from: CurrencyCode): number => {
      if (!isTranslating) return 1;
      const key = `${from}->${translateCurrency}`;
      const custom = customConversions[key];
      if (custom) {
        const b = parseFloat(custom.base);
        const t = parseFloat(custom.target);
        if (b > 0 && t >= 0) {
          return t / b;
        }
      }
      return getDefaultExchangeRate(from, translateCurrency, usdRates);
    },
    [isTranslating, translateCurrency, customConversions, usdRates]
  );

  const updateCustomConversion = (
    from: CurrencyCode,
    patch: Partial<{ base: string; target: string }>
  ) => {
    const key = `${from}->${translateCurrency}`;
    const current = getConversionPair(from);
    setCustomConversions((prev) => ({
      ...prev,
      [key]: { ...current, ...patch },
    }));
  };

  const resetCustomConversion = (from: CurrencyCode) => {
    const key = `${from}->${translateCurrency}`;
    setCustomConversions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleToggleTranslate = () => {
    if (!isTranslating) {
      // Pick a sensible default target currency if all ledger currencies match current translateCurrency
      if (
        ledgerCurrencies.length === 1 &&
        ledgerCurrencies[0].code === translateCurrency
      ) {
        setTranslateCurrency(
          ledgerCurrencies[0].code === "SGD" ? "USD" : "SGD"
        );
      }
      setIsTranslating(true);
    } else {
      setIsTranslating(false);
      setCombineAllInLedger(false);
    }
  };

  const formatDisplayedAmount = useCallback(
    (amount: number, fromCurrency: CurrencyCode): string => {
      if (!isTranslating) {
        return formatCurrency(amount, fromCurrency);
      }
      const rate = getRateToTarget(fromCurrency);
      const converted = amount * rate;
      return formatCurrency(converted, translateCurrency);
    },
    [isTranslating, getRateToTarget, translateCurrency]
  );

  const isAmountTranslated = useCallback(
    (fromCurrency: CurrencyCode): boolean => {
      if (!isTranslating) return false;
      const rate = getRateToTarget(fromCurrency);
      return fromCurrency !== translateCurrency || Math.abs(rate - 1) > 1e-6;
    },
    [isTranslating, getRateToTarget, translateCurrency]
  );

  // Balances for selected currency (or converted when temporary translation is active)
  const { balances, settlements } = useMemo(() => {
    if (isTranslating) {
      return computeConvertedBalances(
        transactions,
        members,
        combineAllInLedger && ledgerCurrencies.length > 1
          ? "ALL"
          : activeCurrency,
        translateCurrency,
        getRateToTarget
      );
    }
    return computeBalancesByCurrency(transactions, members, activeCurrency);
  }, [
    transactions,
    members,
    activeCurrency,
    isTranslating,
    combineAllInLedger,
    ledgerCurrencies.length,
    translateCurrency,
    getRateToTarget,
  ]);

  const rawActiveBalances = useMemo(
    () => computeBalancesByCurrency(transactions, members, activeCurrency),
    [transactions, members, activeCurrency]
  );
  const rawBalanceByMemberId = useMemo(() => {
    const map = new Map<string, (typeof rawActiveBalances.balances)[number]>();
    rawActiveBalances.balances.forEach((b) => map.set(b.member.id, b));
    return map;
  }, [rawActiveBalances]);

  // Composer summary
  const draftSummary = useMemo(
    () =>
      summarizeTransaction({
        id: "draft",
        title,
        date,
        currency,
        category,
        entries,
      }),
    [title, date, currency, category, entries],
  );

  // Keep JSON input box in sync with visual draft fields unless user is editing raw JSON
  useEffect(() => {
    if (!isComposerOpen || isJsonDirty) return;
    const serialized = serializeTransactionToJson(
      {
        title,
        date,
        currency,
        category,
        notes: notes.trim() || undefined,
        entries,
      },
      members,
    );
    setJsonInputText(serialized);
    setJsonError(null);
  }, [
    isComposerOpen,
    isJsonDirty,
    title,
    date,
    currency,
    category,
    notes,
    entries,
    members,
  ]);

  function registerNewMembersIfNeeded(
    newMembersToCreate: { id: string; name: string }[],
  ) {
    if (!newMembersToCreate || newMembersToCreate.length === 0) return;
    setMembers((prev) => {
      const existingIds = new Set(prev.map((m) => m.id.toLowerCase()));
      const existingNames = new Set(prev.map((m) => m.name.toLowerCase()));
      const additions: Member[] = [];
      newMembersToCreate.forEach((nm, idx) => {
        if (
          !existingIds.has(nm.id.toLowerCase()) &&
          !existingNames.has(nm.name.toLowerCase())
        ) {
          additions.push({
            id: nm.id,
            name: nm.name,
            avatarColor:
              AVATAR_COLORS[(prev.length + idx) % AVATAR_COLORS.length],
          });
        }
      });
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }

  function handleApplyJsonToDraft(customJsonText?: string) {
    const textToParse = customJsonText ?? jsonInputText;
    try {
      const parsed = parseTransactionJson(textToParse, members, currency);
      registerNewMembersIfNeeded(parsed.newMembersToCreate);

      if (parsed.title !== undefined) setTitle(parsed.title);
      if (parsed.date !== undefined) setDate(parsed.date);
      if (parsed.currency !== undefined) setCurrency(parsed.currency);
      if (parsed.category !== undefined) setCategory(parsed.category);
      if (parsed.notes !== undefined) setNotes(parsed.notes);
      setEntries(parsed.entries);

      setIsJsonDirty(false);
      setJsonError(null);
      setJsonAppliedBadge(true);
      setTimeout(() => setJsonAppliedBadge(false), 2500);
    } catch (err) {
      setJsonError(
        err instanceof Error ? err.message : "Failed to parse JSON.",
      );
    }
  }

  async function handleGenerateFromAi() {
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) return;

    setIsAiGenerating(true);
    setAiError(null);
    setAiToolCalls([]);

    try {
      const res = await fetch("/api/ai-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          members,
          defaultCurrency: currency,
          defaultDate: date,
          apiKey: openAiKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data?.missingApiKey) {
          setShowApiKeyInput(true);
        }
        throw new Error(data?.error || "Failed to generate transaction JSON.");
      }

      if (Array.isArray(data.newMembersToCreate)) {
        registerNewMembersIfNeeded(data.newMembersToCreate);
      }

      if (Array.isArray(data.toolCalls)) {
        setAiToolCalls(data.toolCalls);
      }

      if (typeof data.serializedJson === "string") {
        setJsonInputText(data.serializedJson);
        setIsJsonDirty(false);
        setIsJsonPanelOpen(true);
        handleApplyJsonToDraft(data.serializedJson);
      } else if (data.transaction) {
        const tx = data.transaction;
        if (tx.title) setTitle(tx.title);
        if (tx.date) setDate(tx.date);
        if (tx.currency) setCurrency(tx.currency);
        if (tx.category) setCategory(tx.category);
        setNotes(tx.notes ?? "");
        if (Array.isArray(tx.entries)) setEntries(tx.entries);
        setIsJsonDirty(false);
      }
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : "AI generation failed.",
      );
    } finally {
      setIsAiGenerating(false);
    }
  }

  function toggleCardJsonEditor(tx: Transaction) {
    const isCurrentlyOpen = !!cardJsonOpenIds[tx.id];
    setCardJsonOpenIds((prev) => ({ ...prev, [tx.id]: !isCurrentlyOpen }));
    if (!isCurrentlyOpen) {
      setExpandedTxIds((prev) => ({ ...prev, [tx.id]: true }));
      setCardJsonTexts((prev) => ({
        ...prev,
        [tx.id]: serializeTransactionToJson(tx, members),
      }));
      setCardJsonErrors((prev) => ({ ...prev, [tx.id]: null }));
    }
  }

  function handleApplyCardJson(tx: Transaction) {
    const rawText = cardJsonTexts[tx.id] ?? "";
    try {
      const parsed = parseTransactionJson(rawText, members, tx.currency);
      registerNewMembersIfNeeded(parsed.newMembersToCreate);

      const updatedTx: Transaction = {
        ...tx,
        title: parsed.title?.trim() || tx.title,
        date: parsed.date || tx.date,
        currency: parsed.currency || tx.currency,
        category: parsed.category || tx.category,
        notes: parsed.notes !== undefined ? parsed.notes : tx.notes,
        entries: parsed.entries.filter((e) => e.amount > 0),
      };

      setTransactions((prev) =>
        prev.map((item) => (item.id === tx.id ? updatedTx : item)),
      );
      setCardJsonErrors((prev) => ({ ...prev, [tx.id]: null }));
      setCardJsonSavedIds((prev) => ({ ...prev, [tx.id]: true }));
      setTimeout(() => {
        setCardJsonSavedIds((prev) => ({ ...prev, [tx.id]: false }));
      }, 2000);
    } catch (err) {
      setCardJsonErrors((prev) => ({
        ...prev,
        [tx.id]: err instanceof Error ? err.message : "Invalid JSON",
      }));
    }
  }

  function toggleExpand(id: string) {
    setExpandedTxIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;
    const newMember: Member = {
      id: `m-${Date.now()}`,
      name: trimmed,
      avatarColor: AVATAR_COLORS[members.length % AVATAR_COLORS.length],
    };
    setMembers((prev) => [...prev, newMember]);
    setNewMemberName("");
  }

  function startEditingMember(member: Member) {
    setEditingMemberId(member.id);
    setEditingMemberName(member.name);
    setEditingMemberColor(member.avatarColor);
  }

  function cancelEditingMember() {
    setEditingMemberId(null);
    setEditingMemberName("");
  }

  function handleSaveMemberEdit(id: string) {
    const trimmed = editingMemberName.trim();
    if (!trimmed) return;
    setMembers((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, name: trimmed, avatarColor: editingMemberColor }
          : m,
      ),
    );
    setEditingMemberId(null);
    setEditingMemberName("");
  }

  function handleDeleteMember(id: string) {
    if (editingMemberId === id) {
      cancelEditingMember();
    }
    setMembers((prev) => {
      const remaining = prev.filter((m) => m.id !== id);
      const fallbackId = remaining[0]?.id ?? "";
      setEntries((draftEntries) =>
        draftEntries.map((entry) =>
          entry.memberId === id ? { ...entry, memberId: fallbackId } : entry,
        ),
      );
      return remaining;
    });
  }

  function openNewTransactionModal(preset?: "grocery" | "insurance") {
    setEditingTxId(null);
    setAiError(null);
    setAiToolCalls([]);
    setIsJsonDirty(false);
    setJsonError(null);
    const defaultMemberId = members[0]?.id ?? "m-alice";

    if (preset === "insurance") {
      setTitle("Group Policy / Self-Paid Bill");
      setCategory("Insurance");
      setCurrency(activeCurrency);
      setNotes("Each member pays and benefits for their own share");
      const sampleEntries: TransactionEntry[] = members
        .slice(0, 3)
        .flatMap((m, idx) => [
          {
            id: `draft-p-${idx}`,
            role: "PAYER" as EntryRole,
            memberId: m.id,
            amount: 100,
            paymentMethod: "PayNow" as PaymentMethod,
            label: `${m.name}'s payment`,
          },
          {
            id: `draft-b-${idx}`,
            role: "BENEFICIARY" as EntryRole,
            memberId: m.id,
            amount: 100,
            label: `${m.name}'s own share`,
          },
        ]);
      setEntries(sampleEntries);
    } else {
      setTitle("");
      setCategory("Groceries");
      setCurrency(activeCurrency);
      setNotes("");
      setEntries([
        {
          id: `draft-p-1`,
          role: "PAYER",
          memberId: defaultMemberId,
          amount: 0,
          paymentMethod: "Credit Card",
          label: "Paid at checkout",
        },
        {
          id: `draft-b-1`,
          role: "BENEFICIARY",
          memberId: defaultMemberId,
          amount: 0,
          label: "Item 1",
        },
      ]);
    }
    setIsComposerOpen(true);
  }

  function openEditTransactionModal(tx: Transaction) {
    setEditingTxId(tx.id);
    setAiError(null);
    setAiToolCalls([]);
    setIsJsonDirty(false);
    setJsonError(null);
    setTitle(tx.title);
    setDate(tx.date);
    setCurrency(tx.currency);
    setCategory(tx.category);
    setNotes(tx.notes ?? "");
    setEntries(
      tx.entries.map((e) => ({
        ...e,
        paymentMethod:
          e.role === "PAYER"
            ? (e.paymentMethod ?? "Credit Card")
            : e.paymentMethod,
      })),
    );
    setIsComposerOpen(true);
  }

  function addDraftEntry(role: EntryRole) {
    const defaultMemberId = members[0]?.id ?? "";
    setEntries((prev) => [
      ...prev,
      {
        id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        memberId: defaultMemberId,
        amount: 0,
        paymentMethod: role === "PAYER" ? "Credit Card" : undefined,
        label: role === "PAYER" ? "Payment" : "Item / Share",
      },
    ]);
  }

  function updateDraftEntry(entryId: string, patch: Partial<TransactionEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
    );
  }

  function removeDraftEntry(entryId: string) {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  // Smart Helper 1: Mirror Payers -> Beneficiaries (Insurance / Self-paid pattern)
  function mirrorPayersToBeneficiaries() {
    const payers = entries.filter((e) => e.role === "PAYER" && e.amount > 0);
    if (payers.length === 0) return;

    const mirroredBeneficiaries: TransactionEntry[] = payers.map((p, idx) => {
      const memberName = memberMap.get(p.memberId)?.name ?? "Member";
      return {
        id: `mirror-${Date.now()}-${idx}`,
        role: "BENEFICIARY",
        memberId: p.memberId,
        amount: p.amount,
        label: p.label ? `${p.label} (own share)` : `${memberName}'s own share`,
      };
    });

    setEntries([...payers, ...mirroredBeneficiaries]);
  }

  // Smart Helper 2: Split Remaining Unallocated Amount Equally among all members
  function splitRemainingEqually() {
    const decimals = getCurrencyInfo(currency).decimal_digits;
    const remaining = roundCents(
      draftSummary.totalPaid - draftSummary.totalBenefited,
      decimals
    );
    if (remaining <= 0 || members.length === 0) return;

    const factor = 10 ** decimals;
    const unit = 1 / factor;
    const baseShare = Math.floor((remaining / members.length) * factor) / factor;
    let leftover = roundCents(remaining - baseShare * members.length, decimals);

    const newBeneficiaryEntries: TransactionEntry[] = members.map((m, idx) => {
      const extraUnit = leftover > unit / 2 ? unit : 0;
      leftover = roundCents(leftover - extraUnit, decimals);
      return {
        id: `split-${Date.now()}-${idx}`,
        role: "BENEFICIARY",
        memberId: m.id,
        amount: roundCents(baseShare + extraUnit, decimals),
        label: `Shared split (1/${members.length})`,
      };
    });

    setEntries((prev) => [
      ...prev.filter((e) => !(e.role === "BENEFICIARY" && e.amount === 0)),
      ...newBeneficiaryEntries,
    ]);
  }

  // Smart Helper 3: Match single payer amount to sum of beneficiary items
  function syncPayerToBeneficiaryTotal() {
    const beneficiaryTotal = draftSummary.totalBenefited;
    if (beneficiaryTotal <= 0) return;
    const payerEntries = entries.filter((e) => e.role === "PAYER");
    if (payerEntries.length === 1) {
      updateDraftEntry(payerEntries[0].id, { amount: beneficiaryTotal });
    }
  }

  function handleSaveTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const cleanedEntries = entries.filter((entry) => entry.amount > 0);
    const txPayload: Transaction = {
      id: editingTxId ?? `tx-${Date.now()}`,
      title: title.trim(),
      date,
      currency,
      category,
      notes: notes.trim() || undefined,
      entries: cleanedEntries,
    };

    if (editingTxId) {
      setTransactions((prev) =>
        prev.map((t) => (t.id === editingTxId ? txPayload : t)),
      );
    } else {
      setTransactions((prev) => [txPayload, ...prev]);
    }
    setActiveCurrency(currency);
    setIsComposerOpen(false);
  }

  function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className='min-h-screen bg-slate-50 pb-20'>
      {/* Top Header */}
      <header className='sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm'>
              <Wallet className='h-5 w-5' />
            </div>
            <div>
              <h1 className='text-lg font-bold tracking-tight text-slate-900'>
                Treasurer
              </h1>
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2.5'>
            <button
              type='button'
              onClick={handleToggleTranslate}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-xs transition ${
                isTranslating
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title='Temporarily convert all displayed currencies to make sense of amounts'
            >
              <ArrowLeftRight className='h-3.5 w-3.5 text-indigo-600' />
              {isTranslating
                ? `Translating to ${translateCurrency}`
                : "Translate Currencies"}
            </button>
            <button
              onClick={() => openNewTransactionModal("insurance")}
              className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50'
            >
              <CopyCheck className='h-3.5 w-3.5 text-emerald-600' />
              New Self-Paid Bill (e.g. Insurance)
            </button>
            <button
              onClick={() => openNewTransactionModal()}
              className='inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800'
            >
              <Plus className='h-4 w-4' />
              New Transaction
            </button>
          </div>
        </div>
      </header>

      {/* Temporary Currency Translate Banner */}
      {isTranslating && (
        <div className='mx-auto mt-5 max-w-6xl px-6'>
          <div className='rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-white to-sky-50/80 p-4 shadow-xs'>
            <div className='flex flex-wrap items-center justify-between gap-4'>
              <div className='flex flex-wrap items-center gap-3'>
                <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white'>
                  <Coins className='h-4 w-4' />
                </div>
                <div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-xs font-bold text-slate-900'>
                      Temporary Currency Translate
                    </span>
                    <span className='rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700'>
                      Preview Only
                    </span>
                  </div>
                  <p className='text-[11px] text-slate-500'>
                    All displayed amounts are temporarily converted to help you
                    make sense of them. Your saved data is unchanged.
                  </p>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2.5'>
                <label className='flex items-center gap-1.5 text-xs font-medium text-slate-700'>
                  <span>Show in:</span>
                  <select
                    value={translateCurrency}
                    onChange={(e) =>
                      setTranslateCurrency(e.target.value as CurrencyCode)
                    }
                    className='max-w-[130px] truncate rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-indigo-900 shadow-2xs focus:border-indigo-600 focus:outline-none'
                  >
                    {CURRENCY_LIST.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type='button'
                  onClick={() => {
                    setIsTranslating(false);
                    setCombineAllInLedger(false);
                  }}
                  className='inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                >
                  <X className='h-3.5 w-3.5' />
                  Show Original
                </button>
              </div>
            </div>

            {/* Editable Conversion Rates / Desired Reference Amounts */}
            <div className='mt-3 flex flex-wrap items-center gap-3 border-t border-indigo-100/80 pt-3'>
              <span className='text-[11px] font-semibold text-slate-600'>
                Conversion amount (edit either side to scale):
              </span>
              {ledgerCurrencies.map((c) => {
                const pair = getConversionPair(c.code);
                const key = `${c.code}->${translateCurrency}`;
                const isCustom = Boolean(customConversions[key]);
                return (
                  <div
                    key={c.code}
                    className='inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-white px-2.5 py-1 text-xs shadow-2xs'
                  >
                    <input
                      type='number'
                      min='0.0001'
                      step='any'
                      value={pair.base}
                      onChange={(e) =>
                        updateCustomConversion(c.code, {
                          base: e.target.value,
                        })
                      }
                      aria-label={`Base ${c.code} amount`}
                      className='w-16 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none'
                    />
                    <span className='font-mono text-[11px] font-bold text-slate-700'>
                      {c.code}
                    </span>
                    <span className='text-slate-400'>=</span>
                    <input
                      type='number'
                      min='0'
                      step='any'
                      value={pair.target}
                      onChange={(e) =>
                        updateCustomConversion(c.code, {
                          target: e.target.value,
                        })
                      }
                      aria-label={`Converted ${translateCurrency} amount`}
                      className='w-20 rounded-md border border-indigo-200 bg-indigo-50/40 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-indigo-900 focus:border-indigo-600 focus:bg-white focus:outline-none'
                    />
                    <span className='font-mono text-[11px] font-bold text-indigo-700'>
                      {translateCurrency}
                    </span>
                    {isCustom && (
                      <button
                        type='button'
                        onClick={() => resetCustomConversion(c.code)}
                        className='ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                        title='Reset to market exchange rate'
                      >
                        <RotateCcw className='h-3 w-3' />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className='mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-8 px-6 lg:grid-cols-12'>
        {/* Left Column: Transactions List (8 cols) */}
        <section className='space-y-4 lg:col-span-8'>
          <div className='flex items-center justify-between'>
            <div>
              <h2 className='text-base font-semibold text-slate-900'>
                Transactions ({transactions.length})
              </h2>
              <p className='text-xs text-slate-500'>
                Click any transaction to see who paid and how it was split.
              </p>
            </div>
            {Object.values(expandedTxIds).some(Boolean) && (
              <button
                type='button'
                onClick={() => setExpandedTxIds({})}
                className='rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-2xs transition hover:bg-slate-50'
              >
                Collapse All
              </button>
            )}
          </div>

          {transactions.map((tx) => {
            const summary = summarizeTransaction(tx);
            const isExpanded = !!expandedTxIds[tx.id];
            const txTranslated = isAmountTranslated(tx.currency);

            return (
              <div
                key={tx.id}
                className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition'
              >
                {/* Main Transaction Row */}
                <div
                  onClick={() => toggleExpand(tx.id)}
                  className='flex cursor-pointer flex-wrap items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50/80'
                >
                  <div className='flex items-start gap-3.5'>
                    <div className='mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700'>
                      <Receipt className='h-5 w-5' />
                    </div>
                    <div>
                      <div className='flex flex-wrap items-center gap-2'>
                        <h3 className='font-semibold text-slate-900'>
                          {tx.title}
                        </h3>
                        <span className='rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600'>
                          {tx.category}
                        </span>
                        <span className='rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800'>
                          {txTranslated
                            ? `${tx.currency} → ${translateCurrency}`
                            : tx.currency}
                        </span>
                      </div>

                      {tx.notes && (
                        <p className='mt-1 text-xs text-slate-500'>
                          {tx.notes}
                        </p>
                      )}

                      <div className='mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500'>
                        <span>{tx.date}</span>
                        <span>•</span>
                        <span className='font-medium text-emerald-700'>
                          {summary.payerEntries.length}{" "}
                          {summary.payerEntries.length === 1
                            ? "payer"
                            : "payers"}
                        </span>
                        <span>•</span>
                        <span className='font-medium text-sky-700'>
                          {summary.beneficiaryEntries.length}{" "}
                          {summary.beneficiaryEntries.length === 1
                            ? "share"
                            : "shares"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className='flex items-center gap-4'>
                    <div className='text-right'>
                      <div className='text-base font-bold text-slate-900'>
                        {txTranslated && (
                          <span className='mr-0.5 font-normal text-indigo-500'>
                            ≈
                          </span>
                        )}
                        {formatDisplayedAmount(summary.totalPaid, tx.currency)}
                      </div>
                      {txTranslated && (
                        <div className='font-mono text-[10px] text-slate-400'>
                          orig: {formatCurrency(summary.totalPaid, tx.currency)}{" "}
                          {tx.currency}
                        </div>
                      )}
                      {summary.isBalanced ? (
                        <span className='inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600'>
                          <CheckCircle2 className='h-3 w-3' />
                          Balanced
                        </span>
                      ) : (
                        <span className='inline-flex items-center gap-1 text-[11px] font-medium text-amber-600'>
                          <AlertCircle className='h-3 w-3' />
                          Diff:{" "}
                          {formatDisplayedAmount(
                            Math.abs(summary.discrepancy),
                            tx.currency,
                          )}
                        </span>
                      )}
                    </div>

                    <div className='flex items-center gap-1'>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCardJsonEditor(tx);
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          cardJsonOpenIds[tx.id]
                            ? "bg-slate-900 text-white"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                        title='Inspect or edit JSON for this transaction'
                      >
                        <Code2 className='h-3.5 w-3.5' />
                        JSON
                      </button>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditTransactionModal(tx);
                        }}
                        className='rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      >
                        Edit
                      </button>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTransaction(tx.id);
                        }}
                        className='rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                        title='Delete transaction'
                      >
                        <Trash2 className='h-4 w-4' />
                      </button>
                      <div className='p-1 text-slate-400'>
                        {isExpanded ? (
                          <ChevronUp className='h-4 w-4' />
                        ) : (
                          <ChevronDown className='h-4 w-4' />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Atomic TransactionEntries (Payers vs Beneficiaries) */}
                {isExpanded && (
                  <div className='border-t border-slate-100 bg-slate-50/60 px-5 py-4 space-y-4'>
                    {/* Inline JSON Input for this Transaction */}
                    {cardJsonOpenIds[tx.id] && (
                      <div className='rounded-xl border border-slate-200 bg-slate-900 p-4 text-slate-100'>
                        <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
                          <div className='flex items-center gap-2'>
                            <Code2 className='h-4 w-4 text-emerald-400' />
                            <span className='text-xs font-semibold text-white'>
                              Transaction JSON
                            </span>
                          </div>
                          <div className='flex items-center gap-2'>
                            {cardJsonSavedIds[tx.id] && (
                              <span className='inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300'>
                                <Check className='h-3 w-3' />
                                Applied
                              </span>
                            )}
                            <button
                              type='button'
                              onClick={() => handleApplyCardJson(tx)}
                              className='rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400'
                            >
                              Apply JSON
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows={8}
                          value={
                            cardJsonTexts[tx.id] ??
                            serializeTransactionToJson(tx, members)
                          }
                          onChange={(e) =>
                            setCardJsonTexts((prev) => ({
                              ...prev,
                              [tx.id]: e.target.value,
                            }))
                          }
                          className='w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-emerald-200 focus:border-emerald-400 focus:outline-none'
                          spellCheck={false}
                        />
                        {cardJsonErrors[tx.id] && (
                          <p className='mt-2 text-xs text-rose-400'>
                            {cardJsonErrors[tx.id]}
                          </p>
                        )}
                      </div>
                    )}

                    <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                      {/* Payer Entries Column */}
                      <div className='rounded-xl border border-emerald-200/80 bg-white p-3.5'>
                        <div className='mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2'>
                          <span className='text-xs font-semibold uppercase tracking-wider text-emerald-700'>
                            Who Paid
                          </span>
                          <span className='font-mono text-xs font-semibold text-emerald-700'>
                            {formatDisplayedAmount(
                              summary.totalPaid,
                              tx.currency,
                            )}
                          </span>
                        </div>
                        <div className='space-y-2'>
                          {summary.payerEntries.map((entry) => {
                            const m = memberMap.get(entry.memberId);
                            return (
                              <div
                                key={entry.id}
                                className='flex items-center justify-between gap-2 rounded-lg bg-emerald-50/50 px-2.5 py-1.5 text-xs'
                              >
                                <div className='flex flex-wrap items-center gap-2'>
                                  <span
                                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                                      m?.avatarColor ?? "bg-slate-500"
                                    }`}
                                  >
                                    {m?.name.slice(0, 1) ?? "?"}
                                  </span>
                                  <div>
                                    <span className='font-semibold text-slate-800'>
                                      {m?.name ?? "Unknown"}
                                    </span>
                                    {entry.label && (
                                      <span className='ml-1.5 text-slate-500'>
                                        — {entry.label}
                                      </span>
                                    )}
                                  </div>
                                  {entry.paymentMethod && (
                                    <span className='inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700'>
                                      <CreditCard className='h-2.5 w-2.5' />
                                      {entry.paymentMethod}
                                    </span>
                                  )}
                                </div>
                                <div className='text-right font-mono'>
                                  <div className='font-semibold text-emerald-700'>
                                    +
                                    {formatDisplayedAmount(
                                      entry.amount,
                                      tx.currency,
                                    )}
                                  </div>
                                  {txTranslated && (
                                    <div className='text-[10px] text-slate-400'>
                                      {formatCurrency(
                                        entry.amount,
                                        tx.currency,
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Beneficiary Entries Column */}
                      <div className='rounded-xl border border-sky-200/80 bg-white p-3.5'>
                        <div className='mb-2.5 flex items-center justify-between border-b border-slate-100 pb-2'>
                          <span className='text-xs font-semibold uppercase tracking-wider text-sky-700'>
                            How It&apos;s Split
                          </span>
                          <span className='font-mono text-xs font-semibold text-sky-700'>
                            {formatDisplayedAmount(
                              summary.totalBenefited,
                              tx.currency,
                            )}
                          </span>
                        </div>
                        <div className='space-y-2'>
                          {summary.beneficiaryEntries.map((entry) => {
                            const m = memberMap.get(entry.memberId);
                            return (
                              <div
                                key={entry.id}
                                className='flex items-center justify-between gap-2 rounded-lg bg-sky-50/50 px-2.5 py-1.5 text-xs'
                              >
                                <div className='flex items-center gap-2'>
                                  <span
                                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                                      m?.avatarColor ?? "bg-slate-500"
                                    }`}
                                  >
                                    {m?.name.slice(0, 1) ?? "?"}
                                  </span>
                                  <div>
                                    <span className='font-semibold text-slate-800'>
                                      {m?.name ?? "Unknown"}
                                    </span>
                                    {entry.label && (
                                      <span className='ml-1.5 text-slate-500'>
                                        — {entry.label}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className='text-right font-mono'>
                                  <div className='font-semibold text-sky-700'>
                                    -
                                    {formatDisplayedAmount(
                                      entry.amount,
                                      tx.currency,
                                    )}
                                  </div>
                                  {txTranslated && (
                                    <div className='text-[10px] text-slate-400'>
                                      {formatCurrency(
                                        entry.amount,
                                        tx.currency,
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Right Column: Group Members, Net Balances & Settlements (4 cols) */}
        <aside className='space-y-6 lg:col-span-4'>
          {/* Net Balances Card */}
          <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-xs'>
            <div className='flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5'>
              <div className='flex items-center gap-2'>
                <Scale className='h-4 w-4 text-slate-700' />
                <h2 className='text-sm font-semibold text-slate-900'>
                  Group Balances
                </h2>
              </div>
              <div className='flex items-center gap-1.5'>
                <button
                  type='button'
                  onClick={handleToggleTranslate}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                    isTranslating
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  title='Temporarily translate displayed currencies'
                >
                  <ArrowLeftRight className='h-3 w-3' />
                  Translate
                </button>
                <select
                  value={
                    isTranslating &&
                    combineAllInLedger &&
                    ledgerCurrencies.length > 1
                      ? "ALL"
                      : activeCurrency
                  }
                  onChange={(e) => {
                    if (e.target.value === "ALL") {
                      setCombineAllInLedger(true);
                    } else {
                      setCombineAllInLedger(false);
                      setActiveCurrency(e.target.value as CurrencyCode);
                    }
                  }}
                  aria-label='Ledger currency'
                  className='max-w-[130px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold text-slate-700'
                >
                  {isTranslating && ledgerCurrencies.length > 1 && (
                    <option value='ALL'>All ({translateCurrency})</option>
                  )}
                  {ledgerCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isTranslating && (
              <div className='mt-3 flex items-center justify-between rounded-xl bg-indigo-50/70 px-3 py-1.5 text-[11px] text-indigo-800'>
                <span>
                  Showing in <strong>{translateCurrency}</strong>
                  {combineAllInLedger && ledgerCurrencies.length > 1
                    ? " (all currencies combined)"
                    : activeCurrency !== translateCurrency
                      ? ` (from ${activeCurrency})`
                      : ""}
                </span>
                <button
                  type='button'
                  onClick={() => {
                    setIsTranslating(false);
                    setCombineAllInLedger(false);
                  }}
                  className='font-semibold text-indigo-700 underline hover:text-indigo-900'
                >
                  Reset
                </button>
              </div>
            )}

            <div className='mt-4 space-y-3'>
              {balances.map(
                ({ member, totalPaid, totalBenefited, netBalance }) => {
                  const displayCurrency = isTranslating
                    ? translateCurrency
                    : activeCurrency;
                  const epsilon =
                    0.5 * 10 ** -getCurrencyInfo(displayCurrency).decimal_digits;
                  const rawMemberBal = rawBalanceByMemberId.get(member.id);
                  const showOrigSubtext =
                    isTranslating &&
                    !(combineAllInLedger && ledgerCurrencies.length > 1) &&
                    isAmountTranslated(activeCurrency) &&
                    rawMemberBal &&
                    Math.abs(rawMemberBal.netBalance) > 0.005;

                  return (
                    <div
                      key={member.id}
                      className='flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5'
                    >
                      <div className='flex items-center gap-2.5'>
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${member.avatarColor}`}
                        >
                          {member.name.slice(0, 1)}
                        </span>
                        <div>
                          <div className='text-xs font-semibold text-slate-900'>
                            {member.name}
                          </div>
                          <div className='text-[11px] text-slate-500'>
                            Paid{" "}
                            {formatCurrency(totalPaid, displayCurrency)} · Used{" "}
                            {formatCurrency(totalBenefited, displayCurrency)}
                          </div>
                        </div>
                      </div>

                      <div className='text-right font-mono text-xs font-bold'>
                        {netBalance > epsilon ? (
                          <span className='text-emerald-600'>
                            +{formatCurrency(netBalance, displayCurrency)}
                          </span>
                        ) : netBalance < -epsilon ? (
                          <span className='text-rose-600'>
                            -
                            {formatCurrency(
                              Math.abs(netBalance),
                              displayCurrency,
                            )}
                          </span>
                        ) : (
                          <span className='text-slate-400'>Settled</span>
                        )}
                        {showOrigSubtext && rawMemberBal && (
                          <div className='text-[10px] font-normal text-slate-400'>
                            {rawMemberBal.netBalance > 0 ? "+" : "-"}
                            {formatCurrency(
                              Math.abs(rawMemberBal.netBalance),
                              activeCurrency,
                            )}{" "}
                            {activeCurrency}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>

            {/* Suggested Settlements */}
            <div className='mt-5 border-t border-slate-100 pt-4'>
              <h3 className='text-xs font-semibold uppercase tracking-wider text-slate-500'>
                Suggested Settlements (
                {isTranslating ? translateCurrency : activeCurrency})
              </h3>
              {settlements.length === 0 ? (
                <p className='mt-2 text-xs text-slate-500'>
                  Everyone is settled up in{" "}
                  {isTranslating &&
                  combineAllInLedger &&
                  ledgerCurrencies.length > 1
                    ? "all currencies"
                    : activeCurrency}
                  .
                </p>
              ) : (
                <div className='mt-2.5 space-y-2'>
                  {settlements.map((s, idx) => {
                    const from = memberMap.get(s.fromMemberId);
                    const to = memberMap.get(s.toMemberId);
                    const displayCurrency = isTranslating
                      ? translateCurrency
                      : activeCurrency;
                    return (
                      <div
                        key={idx}
                        className='flex items-center justify-between rounded-lg bg-amber-50/70 px-3 py-2 text-xs'
                      >
                        <div className='flex items-center gap-1.5 font-medium text-slate-800'>
                          <span>{from?.name}</span>
                          <ArrowRight className='h-3.5 w-3.5 text-slate-400' />
                          <span>{to?.name}</span>
                        </div>
                        <span className='font-mono font-bold text-amber-900'>
                          {formatCurrency(s.amount, displayCurrency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Group Members Card */}
          <div className='rounded-2xl border border-slate-200 bg-white p-5 shadow-xs'>
            <div className='flex items-center gap-2 border-b border-slate-100 pb-3'>
              <Users className='h-4 w-4 text-slate-700' />
              <h2 className='text-sm font-semibold text-slate-900'>
                Group Members ({members.length})
              </h2>
            </div>

            <div className='mt-3 space-y-2'>
              {members.length === 0 ? (
                <p className='text-xs text-slate-400'>
                  No members yet. Add a member below.
                </p>
              ) : (
                members.map((m) => {
                  const isEditing = editingMemberId === m.id;
                  return isEditing ? (
                    <div
                      key={m.id}
                      className='rounded-xl border border-slate-300 bg-slate-50 p-2.5 space-y-2'
                    >
                      <div className='flex items-center gap-1.5'>
                        <input
                          type='text'
                          value={editingMemberName}
                          onChange={(e) => setEditingMemberName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveMemberEdit(m.id);
                            } else if (e.key === "Escape") {
                              cancelEditingMember();
                            }
                          }}
                          autoFocus
                          placeholder='Member name...'
                          className='flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none'
                        />
                        <button
                          type='button'
                          onClick={() => handleSaveMemberEdit(m.id)}
                          disabled={!editingMemberName.trim()}
                          className='inline-flex items-center justify-center rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-500 disabled:opacity-40'
                          title='Save changes'
                        >
                          <Check className='h-3.5 w-3.5' />
                        </button>
                        <button
                          type='button'
                          onClick={cancelEditingMember}
                          className='inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                          title='Cancel editing'
                        >
                          <X className='h-3.5 w-3.5' />
                        </button>
                      </div>
                      <div className='flex items-center gap-1.5'>
                        <span className='text-[10px] font-medium text-slate-500'>
                          Color:
                        </span>
                        {AVATAR_COLORS.map((colorClass) => (
                          <button
                            key={colorClass}
                            type='button'
                            onClick={() => setEditingMemberColor(colorClass)}
                            className={`h-4 w-4 rounded-full transition ${colorClass} ${
                              editingMemberColor === colorClass
                                ? "ring-2 ring-slate-900 ring-offset-1"
                                : "opacity-60 hover:opacity-100"
                            }`}
                            title={`Select color`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={m.id}
                      className='flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50'
                    >
                      <div className='flex items-center gap-2 min-w-0'>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${m.avatarColor}`}
                        >
                          {m.name.slice(0, 1)}
                        </span>
                        <span className='truncate font-medium text-slate-800'>
                          {m.name}
                        </span>
                      </div>
                      <div className='flex items-center gap-1 shrink-0'>
                        <button
                          type='button'
                          onClick={() => startEditingMember(m)}
                          className='rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700'
                          title={`Edit ${m.name}`}
                          aria-label={`Edit ${m.name}`}
                        >
                          <Pencil className='h-3.5 w-3.5' />
                        </button>
                        <button
                          type='button'
                          onClick={() => handleDeleteMember(m.id)}
                          className='rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                          title={`Delete ${m.name}`}
                          aria-label={`Delete ${m.name}`}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleAddMember} className='mt-4 flex gap-2'>
              <input
                type='text'
                placeholder='Add member name...'
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                className='flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-slate-900 focus:outline-none'
              />
              <button
                type='submit'
                className='inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800'
              >
                <UserPlus className='h-3.5 w-3.5' />
                Add
              </button>
            </form>
          </div>
        </aside>
      </main>

      {/* Transaction Composer Modal */}
      {isComposerOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs'>
          <div className='max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl'>
            <div className='flex items-center justify-between border-b border-slate-100 pb-4'>
              <div>
                <h2 className='text-base font-bold text-slate-900'>
                  {editingTxId ? "Edit Transaction" : "New Transaction"}
                </h2>
                <p className='text-xs text-slate-500'>
                  Enter who paid on the left and how the bill was split on the
                  right.
                </p>
              </div>
              <button
                type='button'
                onClick={() => setIsComposerOpen(false)}
                className='rounded-lg px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100'
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSaveTransaction} className='mt-5 space-y-6'>
              {/* AI Natural Language -> Strict Composable Tools -> JSON Generator */}
              <div className='rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-4 shadow-2xs'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex items-center gap-2'>
                    <div className='flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white'>
                      <Wand2 className='h-3.5 w-3.5' />
                    </div>
                    <div>
                      <h3 className='text-xs font-bold text-slate-900'>
                        Fill with AI
                      </h3>
                      <p className='text-[11px] text-slate-500'>
                        Describe who paid and how the bill was split, and AI
                        will fill in the details for you.
                      </p>
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={() => setShowApiKeyInput((prev) => !prev)}
                    className='inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50'
                  >
                    <KeyRound className='h-3 w-3 text-slate-500' />
                    {openAiKey ? "API Key Set" : "OpenAI Key"}
                  </button>
                </div>

                {showApiKeyInput && (
                  <div className='mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5'>
                    <span className='text-[11px] font-medium text-slate-600'>
                      OpenAI API Key:
                    </span>
                    <input
                      type='password'
                      placeholder='sk-...'
                      value={openAiKey}
                      onChange={(e) => setOpenAiKey(e.target.value)}
                      className='flex-1 rounded-lg border border-slate-200 px-2.5 py-1 font-mono text-xs focus:border-indigo-600 focus:outline-none'
                    />
                  </div>
                )}

                <div className='mt-3 flex flex-col gap-2.5 sm:flex-row'>
                  <textarea
                    rows={2}
                    placeholder='e.g. Alice paid $84.50 by Credit Card for groceries; Bob had $14.50 cold brew, Charlie had $28 steak, Alice had $12 yogurt, and split the rest equally among Alice, Bob, and Charlie'
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    className='flex-1 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none'
                  />
                  <button
                    type='button'
                    disabled={isAiGenerating || !aiPrompt.trim()}
                    onClick={handleGenerateFromAi}
                    className='inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    {isAiGenerating ? (
                      <>
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                        Filling in...
                      </>
                    ) : (
                      <>
                        <Sparkles className='h-3.5 w-3.5' />
                        Auto-Fill with AI
                      </>
                    )}
                  </button>
                </div>

                {/* Example Prompt Chips */}
                <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
                  <span className='text-[11px] font-medium text-slate-500'>
                    Try example:
                  </span>
                  {AI_EXAMPLE_PROMPTS.map((sample, idx) => (
                    <button
                      key={idx}
                      type='button'
                      onClick={() => setAiPrompt(sample)}
                      className='rounded-full border border-indigo-200/80 bg-white px-2.5 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-50'
                    >
                      Example {idx + 1}
                    </button>
                  ))}
                </div>

                {aiError && (
                  <div className='mt-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700'>
                    {aiError}
                  </div>
                )}

                {/* AI Summary Log */}
                {aiToolCalls.length > 0 && (
                  <div className='mt-3 rounded-xl border border-indigo-200/70 bg-white/90 p-3'>
                    <div className='mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-900'>
                      <Wrench className='h-3.5 w-3.5 text-indigo-600' />
                      What AI filled in:
                    </div>
                    <div className='flex flex-wrap gap-1.5'>
                      {aiToolCalls.map((tc, idx) => (
                        <span
                          key={idx}
                          className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700'
                        >
                          <span>{tc.description}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Transaction JSON Input / Editor */}
              <div className='rounded-2xl border border-slate-200 bg-slate-900 p-4 text-slate-100'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <button
                    type='button'
                    onClick={() => setIsJsonPanelOpen((prev) => !prev)}
                    className='flex items-center gap-2 text-left'
                  >
                    <Code2 className='h-4 w-4 text-emerald-400' />
                    <div>
                      <span className='text-xs font-bold text-white'>
                        Transaction JSON
                      </span>
                      <span className='ml-2 rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300'>
                        {isJsonDirty ? "Unsaved edits" : "Synced"}
                      </span>
                    </div>
                    {isJsonPanelOpen ? (
                      <ChevronUp className='h-4 w-4 text-slate-400' />
                    ) : (
                      <ChevronDown className='h-4 w-4 text-slate-400' />
                    )}
                  </button>

                  <div className='flex items-center gap-2'>
                    {jsonAppliedBadge && (
                      <span className='inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300'>
                        <Check className='h-3 w-3' />
                        Synced
                      </span>
                    )}
                    {isJsonDirty && (
                      <button
                        type='button'
                        onClick={() => {
                          setIsJsonDirty(false);
                          setJsonError(null);
                        }}
                        className='rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800'
                      >
                        Reset
                      </button>
                    )}
                    <button
                      type='button'
                      onClick={() => handleApplyJsonToDraft()}
                      className='rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400'
                    >
                      Apply JSON
                    </button>
                  </div>
                </div>

                {isJsonPanelOpen && (
                  <div className='mt-3'>
                    <p className='mb-2 text-[11px] text-slate-400'>
                      View or edit this transaction in JSON format. Changes sync
                      directly with the form below.
                    </p>
                    <textarea
                      rows={9}
                      value={jsonInputText}
                      onChange={(e) => {
                        setJsonInputText(e.target.value);
                        setIsJsonDirty(true);
                      }}
                      spellCheck={false}
                      className='w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-emerald-200 focus:border-emerald-400 focus:outline-none'
                    />
                    {jsonError && (
                      <p className='mt-2 text-xs text-rose-400'>{jsonError}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Parent Transaction Metadata */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4'>
                <div className='sm:col-span-2'>
                  <label className='block text-xs font-semibold text-slate-700'>
                    Transaction Title
                  </label>
                  <input
                    type='text'
                    required
                    placeholder='e.g. FairPrice Groceries, Travel Insurance'
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none'
                  />
                </div>

                <div>
                  <label className='block text-xs font-semibold text-slate-700'>
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as CurrencyCode)
                    }
                    className='mt-1 w-full truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none'
                  >
                    {CURRENCY_LIST.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className='block text-xs font-semibold text-slate-700'>
                    Date
                  </label>
                  <input
                    type='date'
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none'
                  />
                </div>
              </div>

              <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
                <div>
                  <label className='block text-xs font-semibold text-slate-700'>
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className='mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none'
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='sm:col-span-2'>
                  <label className='block text-xs font-semibold text-slate-700'>
                    Notes (optional)
                  </label>
                  <input
                    type='text'
                    placeholder='e.g. Everyone paid their own tier / Split receipt by item'
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none'
                  />
                </div>
              </div>

              {/* Quick Smart Actions Bar */}
              <div className='flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5'>
                <div className='flex items-center gap-1.5 text-xs font-medium text-slate-600'>
                  <Sparkles className='h-3.5 w-3.5 text-amber-500' />
                  <span>Quick Split:</span>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <button
                    type='button'
                    onClick={mirrorPayersToBeneficiaries}
                    className='rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50'
                  >
                    Everyone Paid Their Own
                  </button>
                  <button
                    type='button'
                    onClick={splitRemainingEqually}
                    className='rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50'
                  >
                    Split Remaining Equally ({members.length})
                  </button>
                  <button
                    type='button'
                    onClick={syncPayerToBeneficiaryTotal}
                    className='rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100'
                  >
                    Match Paid to Split Total
                  </button>
                </div>
              </div>

              {/* Two-Column Atomic Entries Editor */}
              <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
                {/* Left: Payer Entries */}
                <div className='rounded-xl border border-emerald-200 bg-emerald-50/30 p-4'>
                  <div className='flex items-center justify-between pb-3'>
                    <div>
                      <h3 className='text-xs font-bold uppercase tracking-wider text-emerald-800'>
                        Who Paid
                      </h3>
                      <p className='text-[11px] text-emerald-700/80'>
                        Add everyone who paid toward the bill
                      </p>
                    </div>
                    <span className='font-mono text-sm font-bold text-emerald-800'>
                      {formatCurrency(draftSummary.totalPaid, currency)}
                    </span>
                  </div>

                  <div className='space-y-2.5'>
                    {entries
                      .filter((e) => e.role === "PAYER")
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className='grid grid-cols-12 items-center gap-2 rounded-lg border border-emerald-200/70 bg-white p-2'
                        >
                          <select
                            value={entry.memberId}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                memberId: e.target.value,
                              })
                            }
                            className='col-span-3 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium'
                          >
                            {!memberMap.has(entry.memberId) && (
                              <option value={entry.memberId}>
                                Unknown ({entry.memberId})
                              </option>
                            )}
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={entry.paymentMethod ?? "Credit Card"}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                paymentMethod: e.target.value as PaymentMethod,
                              })
                            }
                            className='col-span-3 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700'
                          >
                            {PAYMENT_METHODS.map((pm) => (
                              <option key={pm} value={pm}>
                                {pm}
                              </option>
                            ))}
                          </select>
                          <input
                            type='text'
                            placeholder='Label (e.g. Own policy)'
                            value={entry.label ?? ""}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                label: e.target.value,
                              })
                            }
                            className='col-span-3 rounded-md border border-slate-200 px-2 py-1.5 text-xs'
                          />
                          <input
                            type='number'
                            step={
                              getCurrencyInfo(currency).decimal_digits === 0
                                ? "1"
                                : getCurrencyInfo(currency).decimal_digits === 3
                                  ? "0.001"
                                  : "0.01"
                            }
                            min='0'
                            placeholder={(0).toFixed(
                              getCurrencyInfo(currency).decimal_digits
                            )}
                            value={entry.amount || ""}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                amount: parseFloat(e.target.value) || 0,
                              })
                            }
                            className='col-span-2 rounded-md border border-slate-200 px-2 py-1.5 text-right font-mono text-xs font-semibold'
                          />
                          <button
                            type='button'
                            onClick={() => removeDraftEntry(entry.id)}
                            className='col-span-1 flex justify-center text-slate-400 hover:text-rose-600'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </button>
                        </div>
                      ))}
                  </div>

                  <button
                    type='button'
                    onClick={() => addDraftEntry("PAYER")}
                    className='mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-emerald-300 bg-white py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50'
                  >
                    <Plus className='h-3.5 w-3.5' />
                    Add Payer
                  </button>
                </div>

                {/* Right: Beneficiary Entries */}
                <div className='rounded-xl border border-sky-200 bg-sky-50/30 p-4'>
                  <div className='flex items-center justify-between pb-3'>
                    <div>
                      <h3 className='text-xs font-bold uppercase tracking-wider text-sky-800'>
                        How It&apos;s Split
                      </h3>
                      <p className='text-[11px] text-sky-700/80'>
                        Add individual items or each person&apos;s share
                      </p>
                    </div>
                    <span className='font-mono text-sm font-bold text-sky-800'>
                      {formatCurrency(draftSummary.totalBenefited, currency)}
                    </span>
                  </div>

                  <div className='space-y-2.5'>
                    {entries
                      .filter((e) => e.role === "BENEFICIARY")
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className='grid grid-cols-12 items-center gap-2 rounded-lg border border-sky-200/70 bg-white p-2'
                        >
                          <select
                            value={entry.memberId}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                memberId: e.target.value,
                              })
                            }
                            className='col-span-4 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium'
                          >
                            {!memberMap.has(entry.memberId) && (
                              <option value={entry.memberId}>
                                Unknown ({entry.memberId})
                              </option>
                            )}
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type='text'
                            placeholder='Item (e.g. Milk, Steak)'
                            value={entry.label ?? ""}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                label: e.target.value,
                              })
                            }
                            className='col-span-4 rounded-md border border-slate-200 px-2 py-1.5 text-xs'
                          />
                          <input
                            type='number'
                            step={
                              getCurrencyInfo(currency).decimal_digits === 0
                                ? "1"
                                : getCurrencyInfo(currency).decimal_digits === 3
                                  ? "0.001"
                                  : "0.01"
                            }
                            min='0'
                            placeholder={(0).toFixed(
                              getCurrencyInfo(currency).decimal_digits
                            )}
                            value={entry.amount || ""}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                amount: parseFloat(e.target.value) || 0,
                              })
                            }
                            className='col-span-3 rounded-md border border-slate-200 px-2 py-1.5 text-right font-mono text-xs font-semibold'
                          />
                          <button
                            type='button'
                            onClick={() => removeDraftEntry(entry.id)}
                            className='col-span-1 flex justify-center text-slate-400 hover:text-rose-600'
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </button>
                        </div>
                      ))}
                  </div>

                  <button
                    type='button'
                    onClick={() => addDraftEntry("BENEFICIARY")}
                    className='mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-300 bg-white py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50'
                  >
                    <Plus className='h-3.5 w-3.5' />
                    Add Item or Share
                  </button>
                </div>
              </div>

              {/* Footer / Balance Validation */}
              <div className='flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4'>
                <div className='flex items-center gap-2 text-xs'>
                  {draftSummary.isBalanced ? (
                    <span className='inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700'>
                      <CheckCircle2 className='h-4 w-4' />
                      Balanced:{" "}
                      {formatCurrency(draftSummary.totalPaid, currency)} paid ={" "}
                      {formatCurrency(draftSummary.totalBenefited, currency)}{" "}
                      split
                    </span>
                  ) : (
                    <span className='inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-800'>
                      <AlertCircle className='h-4 w-4' />
                      {draftSummary.discrepancy > 0
                        ? `${formatCurrency(
                            draftSummary.discrepancy,
                            currency,
                          )} left to split`
                        : `Split total is ${formatCurrency(
                            Math.abs(draftSummary.discrepancy),
                            currency,
                          )} over the amount paid`}
                    </span>
                  )}
                </div>

                <div className='flex items-center gap-2'>
                  <button
                    type='button'
                    onClick={() => setIsComposerOpen(false)}
                    className='rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50'
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    className='rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800'
                  >
                    {editingTxId ? "Save Changes" : "Create Transaction"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
