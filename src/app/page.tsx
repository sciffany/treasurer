"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Sparkles,
  Trash2,
  Upload,
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
  CURRENCIES_MAP,
  CURRENCY_LIST,
  FALLBACK_USD_RATES,
  computeBalancesByCurrency,
  computeConvertedBalances,
  computeConvertedExpenditure,
  computeExpenditureByCurrency,
  computeTransactionPairwiseCreditDebit,
  formatCurrency,
  getCurrenciesWithBalance,
  getCurrencyInfo,
  getDefaultExchangeRate,
  isExchangeTransaction,
  roundCents,
  summarizeTransaction,
} from "@/lib/ledger";
import {
  ExecutedToolCallSummary,
  parseTransactionJson,
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
  "Exchange",
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
  const [showPairwiseCreditDebit, setShowPairwiseCreditDebit] = useState(false);
  const [showHiddenTransactions, setShowHiddenTransactions] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<CurrencyCode>("SGD");
  const [isHydrated, setIsHydrated] = useState(false);

  // AI Composer state (hidden initially)
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiToolCalls, setAiToolCalls] = useState<ExecutedToolCallSummary[]>([]);
  const [openAiKey, setOpenAiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // Export & Import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dataNotice, setDataNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

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
  const [draftHidden, setDraftHidden] = useState(false);
  const [draftIsExchange, setDraftIsExchange] = useState(false);
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

  const hiddenTransactionsCount = useMemo(
    () => transactions.filter((t) => t.hidden).length,
    [transactions],
  );

  const visibleTransactions = useMemo(
    () =>
      showHiddenTransactions
        ? transactions
        : transactions.filter((t) => !t.hidden),
    [transactions, showHiddenTransactions],
  );

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

  // Group Expenditure (Paid & Used excluding exchange transactions not paid to a merchant)
  const { balances: expenditures } = useMemo(() => {
    if (isTranslating) {
      return computeConvertedExpenditure(
        transactions,
        members,
        combineAllInLedger && ledgerCurrencies.length > 1
          ? "ALL"
          : activeCurrency,
        translateCurrency,
        getRateToTarget
      );
    }
    return computeExpenditureByCurrency(transactions, members, activeCurrency);
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

  function showTemporaryNotice(type: "success" | "error", message: string) {
    setDataNotice({ type, message });
    setTimeout(() => {
      setDataNotice((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }

  function handleExportData() {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        activeCurrency,
        members,
        transactions,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `treasurer-backup-${dateStamp}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showTemporaryNotice("success", "Saved data exported.");
    } catch {
      showTemporaryNotice("error", "Could not export data.");
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text);

      if (!raw || typeof raw !== "object") {
        throw new Error("Invalid backup file format.");
      }

      // Case 1: Full backup object with `members` and/or `transactions`
      if (
        !Array.isArray(raw) &&
        ("members" in raw || "transactions" in raw)
      ) {
        const obj = raw as Record<string, unknown>;
        let importedMembers: Member[] = members;

        if (Array.isArray(obj.members)) {
          importedMembers = obj.members
            .filter(
              (m): m is Record<string, unknown> =>
                Boolean(m) && typeof m === "object" && typeof (m as Record<string, unknown>).name === "string",
            )
            .map((m, idx) => ({
              id:
                typeof m.id === "string" && m.id.trim()
                  ? m.id.trim()
                  : `m-${Date.now()}-${idx}`,
              name: String(m.name).trim(),
              avatarColor:
                typeof m.avatarColor === "string" && m.avatarColor.trim()
                  ? m.avatarColor.trim()
                  : AVATAR_COLORS[idx % AVATAR_COLORS.length],
            }));
        }

        let importedTransactions: Transaction[] = transactions;
        const extraMembersMap = new Map<string, Member>();

        if (Array.isArray(obj.transactions)) {
          importedTransactions = obj.transactions
            .filter(
              (tx): tx is Record<string, unknown> =>
                Boolean(tx) && typeof tx === "object",
            )
            .map((tx, idx) => {
              const parsed = parseTransactionJson(
                JSON.stringify(tx),
                [...importedMembers, ...Array.from(extraMembersMap.values())],
                activeCurrency,
              );
              parsed.newMembersToCreate.forEach((nm) => {
                if (!extraMembersMap.has(nm.id)) {
                  extraMembersMap.set(nm.id, {
                    id: nm.id,
                    name: nm.name,
                    avatarColor:
                      AVATAR_COLORS[
                        (importedMembers.length + extraMembersMap.size) %
                          AVATAR_COLORS.length
                      ],
                  });
                }
              });

              return {
                id:
                  typeof tx.id === "string" && tx.id.trim()
                    ? tx.id.trim()
                    : `tx-${Date.now()}-${idx}`,
                title: parsed.title?.trim() || `Transaction ${idx + 1}`,
                date: parsed.date || new Date().toISOString().slice(0, 10),
                currency: parsed.currency || activeCurrency,
                category: parsed.category || "Other",
                ...(parsed.notes ? { notes: parsed.notes } : {}),
                ...(parsed.hidden ? { hidden: true } : {}),
                ...(typeof parsed.isExchange === "boolean"
                  ? { isExchange: parsed.isExchange }
                  : {}),
                entries: parsed.entries,
              };
            });
        }

        const finalMembers = [
          ...importedMembers,
          ...Array.from(extraMembersMap.values()),
        ];

        setMembers(finalMembers);
        setTransactions(importedTransactions);

        if (
          typeof obj.activeCurrency === "string" &&
          obj.activeCurrency.toUpperCase() in CURRENCIES_MAP
        ) {
          setActiveCurrency(obj.activeCurrency.toUpperCase() as CurrencyCode);
        } else if (importedTransactions[0]?.currency) {
          setActiveCurrency(importedTransactions[0].currency);
        }

        showTemporaryNotice(
          "success",
          `Imported ${finalMembers.length} ${
            finalMembers.length === 1 ? "member" : "members"
          } and ${importedTransactions.length} ${
            importedTransactions.length === 1 ? "transaction" : "transactions"
          }.`,
        );
        return;
      }

      // Case 2: Single transaction object or array of entries
      const parsed = parseTransactionJson(text, members, activeCurrency);
      registerNewMembersIfNeeded(parsed.newMembersToCreate);
      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        title: parsed.title?.trim() || "Imported Transaction",
        date: parsed.date || new Date().toISOString().slice(0, 10),
        currency: parsed.currency || activeCurrency,
        category: parsed.category || "Other",
        ...(parsed.notes ? { notes: parsed.notes } : {}),
        ...(parsed.hidden ? { hidden: true } : {}),
        ...(typeof parsed.isExchange === "boolean"
          ? { isExchange: parsed.isExchange }
          : {}),
        entries: parsed.entries,
      };
      setTransactions((prev) => [newTx, ...prev]);
      showTemporaryNotice("success", `Imported transaction "${newTx.title}".`);
    } catch (err) {
      showTemporaryNotice(
        "error",
        err instanceof Error
          ? err.message
          : "Could not read that file. Please select a valid backup file.",
      );
    }
  }

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

  function handleApplyJsonToDraft(customJsonText: string) {
    const parsed = parseTransactionJson(customJsonText, members, currency);
    registerNewMembersIfNeeded(parsed.newMembersToCreate);

    if (parsed.title !== undefined) setTitle(parsed.title);
    if (parsed.date !== undefined) setDate(parsed.date);
    if (parsed.currency !== undefined) setCurrency(parsed.currency);
    if (parsed.category !== undefined) setCategory(parsed.category);
    if (parsed.notes !== undefined) setNotes(parsed.notes);
    if (typeof parsed.isExchange === "boolean") {
      setDraftIsExchange(parsed.isExchange);
    }
    setEntries(parsed.entries);
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
        throw new Error(data?.error || "Failed to auto-fill transaction.");
      }

      if (Array.isArray(data.newMembersToCreate)) {
        registerNewMembersIfNeeded(data.newMembersToCreate);
      }

      if (Array.isArray(data.toolCalls)) {
        setAiToolCalls(data.toolCalls);
      }

      if (typeof data.serializedJson === "string") {
        handleApplyJsonToDraft(data.serializedJson);
      } else if (data.transaction) {
        const tx = data.transaction;
        if (tx.title) setTitle(tx.title);
        if (tx.date) setDate(tx.date);
        if (tx.currency) setCurrency(tx.currency);
        if (tx.category) setCategory(tx.category);
        setNotes(tx.notes ?? "");
        if (Array.isArray(tx.entries)) setEntries(tx.entries);
      }
    } catch (err) {
      setAiError(
        err instanceof Error ? err.message : "AI auto-fill failed.",
      );
    } finally {
      setIsAiGenerating(false);
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
    setIsAiPanelOpen(false);
    setAiError(null);
    setAiToolCalls([]);
    setDraftHidden(false);
    setDraftIsExchange(false);
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
    setIsAiPanelOpen(false);
    setAiError(null);
    setAiToolCalls([]);
    setTitle(tx.title);
    setDate(tx.date);
    setCurrency(tx.currency);
    setCategory(tx.category);
    setNotes(tx.notes ?? "");
    setDraftHidden(Boolean(tx.hidden));
    setDraftIsExchange(isExchangeTransaction(tx));
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
      ...(draftHidden ? { hidden: true } : {}),
      isExchange: draftIsExchange,
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

  function handleToggleHideTransaction(id: string) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, hidden: !t.hidden } : t)),
    );
  }

  function handleToggleExchangeTransaction(id: string) {
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, isExchange: !isExchangeTransaction(t) } : t,
      ),
    );
  }

  function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className='min-h-screen bg-slate-50 pb-20'>
      {/* Top Header */}
      <header className='sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4'>
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

          <div className='flex flex-wrap items-center gap-2'>
            <input
              ref={fileInputRef}
              type='file'
              accept='.json,application/json'
              onChange={handleImportFile}
              className='hidden'
            />
            <button
              type='button'
              onClick={handleExportData}
              className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50'
              title='Export saved members and transactions'
            >
              <Download className='h-3.5 w-3.5 text-slate-600' />
              Export
            </button>
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50'
              title='Import saved data from a backup file'
            >
              <Upload className='h-3.5 w-3.5 text-slate-600' />
              Import
            </button>
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

      {/* Export / Import Status Notice */}
      {dataNotice && (
        <div className='mx-auto mt-4 max-w-6xl px-6'>
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-2xs ${
              dataNotice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <div className='flex items-center gap-2'>
              {dataNotice.type === "success" ? (
                <CheckCircle2 className='h-4 w-4 shrink-0 text-emerald-600' />
              ) : (
                <AlertCircle className='h-4 w-4 shrink-0 text-rose-600' />
              )}
              <span>{dataNotice.message}</span>
            </div>
            <button
              type='button'
              onClick={() => setDataNotice(null)}
              className='rounded p-0.5 opacity-70 hover:opacity-100'
              aria-label='Dismiss notice'
            >
              <X className='h-3.5 w-3.5' />
            </button>
          </div>
        </div>
      )}

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

      <main className='mx-auto mt-6 grid max-w-6xl grid-cols-1 gap-6 px-4 sm:mt-8 sm:gap-8 sm:px-6 lg:grid-cols-12'>
        {/* Left Column: Transactions List (8 cols) */}
        <section className='space-y-4 lg:col-span-8'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h2 className='text-base font-semibold text-slate-900'>
                Transactions ({transactions.length - hiddenTransactionsCount})
                {hiddenTransactionsCount > 0 && (
                  <span className='ml-2 rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-medium text-slate-600'>
                    {hiddenTransactionsCount} hidden
                  </span>
                )}
              </h2>
              <p className='text-xs text-slate-500'>
                Click any transaction to see who paid and how it was split.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                aria-pressed={showPairwiseCreditDebit}
                onClick={() => setShowPairwiseCreditDebit((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-2xs transition ${
                  showPairwiseCreditDebit
                    ? "border-violet-300 bg-violet-600 text-white hover:bg-violet-500"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                title='Toggle credit and debit of each person against each other for every transaction'
              >
                <Scale
                  className={`h-3.5 w-3.5 ${
                    showPairwiseCreditDebit ? "text-white" : "text-violet-600"
                  }`}
                />
                {showPairwiseCreditDebit
                  ? "Hide Credit & Debit vs Each Other"
                  : "Show Credit & Debit vs Each Other"}
              </button>
              {hiddenTransactionsCount > 0 && (
                <button
                  type='button'
                  onClick={() => setShowHiddenTransactions((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-2xs transition ${
                    showHiddenTransactions
                      ? "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200/70"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {showHiddenTransactions ? (
                    <>
                      <EyeOff className='h-3.5 w-3.5 text-slate-600' />
                      Hide Hidden ({hiddenTransactionsCount})
                    </>
                  ) : (
                    <>
                      <Eye className='h-3.5 w-3.5 text-slate-600' />
                      Show Hidden ({hiddenTransactionsCount})
                    </>
                  )}
                </button>
              )}
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
          </div>

          {visibleTransactions.length === 0 && (
            <div className='rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center'>
              <p className='text-sm font-medium text-slate-700'>
                {hiddenTransactionsCount > 0
                  ? `All ${hiddenTransactionsCount} ${
                      hiddenTransactionsCount === 1
                        ? "transaction is"
                        : "transactions are"
                    } currently hidden from the ledger.`
                  : "No transactions yet."}
              </p>
              {hiddenTransactionsCount > 0 && (
                <button
                  type='button'
                  onClick={() => setShowHiddenTransactions(true)}
                  className='mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100'
                >
                  <Eye className='h-3.5 w-3.5' />
                  Show Hidden Transactions
                </button>
              )}
            </div>
          )}

          {visibleTransactions.map((tx) => {
            const summary = summarizeTransaction(tx);
            const isExpanded = !!expandedTxIds[tx.id];
            const txTranslated = isAmountTranslated(tx.currency);
            const isHidden = Boolean(tx.hidden);
            const isExchange = isExchangeTransaction(tx);
            const pairwise = showPairwiseCreditDebit
              ? computeTransactionPairwiseCreditDebit(tx, members)
              : null;
            const txEpsilon =
              0.5 * 10 ** -getCurrencyInfo(tx.currency).decimal_digits;

            return (
              <div
                key={tx.id}
                className={`overflow-hidden rounded-2xl border transition ${
                  isHidden
                    ? "border-dashed border-slate-300 bg-slate-50/70 opacity-75"
                    : "border-slate-200 bg-white shadow-xs"
                }`}
              >
                {/* Main Transaction Row */}
                <div
                  onClick={() => toggleExpand(tx.id)}
                  className='flex cursor-pointer flex-wrap items-start justify-between gap-3 px-4 py-3.5 transition hover:bg-slate-50/80 sm:items-center sm:px-5 sm:py-4'
                >
                  <div className='flex min-w-[200px] flex-1 items-start gap-3'>
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isHidden
                          ? "bg-slate-200/70 text-slate-500"
                          : isExchange
                            ? "bg-indigo-50 text-indigo-600"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {isHidden ? (
                        <EyeOff className='h-4 w-4' />
                      ) : isExchange ? (
                        <ArrowLeftRight className='h-4 w-4' />
                      ) : (
                        <Receipt className='h-4 w-4' />
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <h3
                          className={`text-sm font-semibold ${
                            isHidden
                              ? "text-slate-600 line-through decoration-slate-400"
                              : "text-slate-900"
                          }`}
                        >
                          {tx.title}
                        </h3>
                        {isHidden && (
                          <span className='inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600'>
                            <EyeOff className='h-2.5 w-2.5' />
                            Hidden from ledger
                          </span>
                        )}
                        {isExchange && (
                          <span className='inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700'>
                            <ArrowLeftRight className='h-2.5 w-2.5' />
                            Exchange · Not merchant spend
                          </span>
                        )}
                        <span className='rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600'>
                          {tx.category}
                        </span>
                        <span className='rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800'>
                          {txTranslated
                            ? `${tx.currency} → ${translateCurrency}`
                            : tx.currency}
                        </span>
                      </div>

                      {tx.notes && (
                        <p className='mt-0.5 break-words text-xs text-slate-500'>
                          {tx.notes}
                        </p>
                      )}

                      <div className='mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500'>
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

                  <div className='flex w-full flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 sm:w-auto sm:justify-end sm:gap-3 sm:border-t-0 sm:pt-0'>
                    <div className='text-left leading-tight sm:text-right'>
                      <div
                        className={`text-sm font-bold ${
                          isHidden
                            ? "text-slate-500 line-through"
                            : "text-slate-900"
                        }`}
                      >
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
                      {isHidden ? (
                        <span className='inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500'>
                          Excluded from balances
                        </span>
                      ) : summary.isBalanced ? (
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

                    <div className='flex flex-wrap items-center gap-1'>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleExchangeTransaction(tx.id);
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                          isExchange
                            ? "border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                        title={
                          isExchange
                            ? "Marked as an exchange (excluded from Group Expenditure). Click to count as merchant expenditure."
                            : "Mark as an exchange not paid to a merchant (exclude from Group Expenditure)"
                        }
                      >
                        <ArrowLeftRight className='h-3.5 w-3.5' />
                        Exchange
                      </button>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleHideTransaction(tx.id);
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                          isHidden
                            ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        }`}
                        title={
                          isHidden
                            ? "Unhide transaction and include in ledger balances"
                            : "Hide transaction from ledger and balances"
                        }
                      >
                        {isHidden ? (
                          <>
                            <Eye className='h-3.5 w-3.5' />
                            Unhide
                          </>
                        ) : (
                          <>
                            <EyeOff className='h-3.5 w-3.5' />
                            Hide
                          </>
                        )}
                      </button>
                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditTransactionModal(tx);
                        }}
                        className='rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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

                {/* Per-Transaction Credit & Debit Against Each Other (when toggled on) */}
                {showPairwiseCreditDebit && pairwise && (
                  <div className='border-t border-violet-100 bg-violet-50/40 px-5 py-3.5 space-y-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div className='flex items-center gap-1.5'>
                        <Scale className='h-3.5 w-3.5 text-violet-600' />
                        <span className='text-xs font-semibold uppercase tracking-wider text-violet-800'>
                          Credit &amp; Debit Against Each Other
                        </span>
                      </div>
                      {pairwise.settlements.length > 0 ? (
                        <div className='flex flex-wrap items-center gap-1.5'>
                          {pairwise.settlements.map((s, idx) => {
                            const from = memberMap.get(s.fromMemberId);
                            const to = memberMap.get(s.toMemberId);
                            return (
                              <span
                                key={idx}
                                className='inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-2xs'
                              >
                                <span className='font-semibold text-rose-700'>
                                  {from?.name ?? s.fromMemberId}
                                </span>
                                <ArrowRight className='h-3 w-3 text-slate-400' />
                                <span className='font-semibold text-emerald-700'>
                                  {to?.name ?? s.toMemberId}
                                </span>
                                <span className='ml-0.5 font-mono font-bold text-slate-900'>
                                  {formatDisplayedAmount(s.amount, tx.currency)}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <span className='text-[11px] font-medium text-slate-500'>
                          No inter-person credit or debit (everyone covered their own share)
                        </span>
                      )}
                    </div>

                    <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
                      {pairwise.memberBreakdowns.map((item) => {
                        const isNetCreditor = item.netBalance > txEpsilon;
                        const isNetDebtor = item.netBalance < -txEpsilon;
                        return (
                          <div
                            key={item.member.id}
                            className='rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs'
                          >
                            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2'>
                              <div className='flex items-center gap-2 min-w-0'>
                                <span
                                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${item.member.avatarColor}`}
                                >
                                  {item.member.name.slice(0, 1)}
                                </span>
                                <div className='min-w-0'>
                                  <div className='truncate text-xs font-bold text-slate-900'>
                                    {item.member.name}
                                  </div>
                                  <div className='text-[10px] leading-snug text-slate-500'>
                                    <div>
                                      Paid{" "}
                                      {formatDisplayedAmount(
                                        item.paid,
                                        tx.currency,
                                      )}
                                    </div>
                                    <div>
                                      Share{" "}
                                      {formatDisplayedAmount(
                                        item.benefited,
                                        tx.currency,
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className='ml-auto text-right font-mono text-xs font-bold'>
                                {isNetCreditor ? (
                                  <span className='inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700'>
                                    Credit +
                                    {formatDisplayedAmount(
                                      item.netBalance,
                                      tx.currency,
                                    )}
                                  </span>
                                ) : isNetDebtor ? (
                                  <span className='inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-rose-700'>
                                    Debit -
                                    {formatDisplayedAmount(
                                      Math.abs(item.netBalance),
                                      tx.currency,
                                    )}
                                  </span>
                                ) : (
                                  <span className='inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600'>
                                    Even ({formatDisplayedAmount(0, tx.currency)})
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className='mt-2 space-y-1.5'>
                              {item.counterparties.length === 0 ? (
                                <div className='text-[11px] text-slate-400'>
                                  Covered own share — no credit or debit against others
                                </div>
                              ) : (
                                item.counterparties.map((cp, cIdx) => {
                                  const other = memberMap.get(cp.otherMemberId);
                                  const isCredit = cp.type === "CREDIT";
                                  return (
                                    <div
                                      key={cIdx}
                                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1 text-xs ${
                                        isCredit
                                          ? "bg-emerald-50/70 text-emerald-900"
                                          : "bg-rose-50/70 text-rose-900"
                                      }`}
                                    >
                                      <div className='flex items-center gap-1.5 min-w-0'>
                                        <span
                                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                                            other?.avatarColor ?? "bg-slate-500"
                                          }`}
                                        >
                                          {other?.name.slice(0, 1) ?? "?"}
                                        </span>
                                        <span className='truncate text-[11px] font-medium'>
                                          {isCredit ? (
                                            <>
                                              Credit from{" "}
                                              <strong className='font-semibold'>
                                                {other?.name ?? cp.otherMemberId}
                                              </strong>
                                            </>
                                          ) : (
                                            <>
                                              Debit to{" "}
                                              <strong className='font-semibold'>
                                                {other?.name ?? cp.otherMemberId}
                                              </strong>
                                            </>
                                          )}
                                        </span>
                                      </div>
                                      <div className='ml-auto shrink-0 text-right font-mono text-xs font-bold'>
                                        <span
                                          className={
                                            isCredit
                                              ? "text-emerald-700"
                                              : "text-rose-700"
                                          }
                                        >
                                          {isCredit ? "+" : "-"}
                                          {formatDisplayedAmount(
                                            cp.amount,
                                            tx.currency,
                                          )}
                                        </span>
                                        {txTranslated && (
                                          <span className='ml-1 text-[10px] font-normal text-slate-400'>
                                            ({formatCurrency(cp.amount, tx.currency)})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expanded Atomic TransactionEntries (Payers vs Beneficiaries) */}
                {isExpanded && (
                  <div className='border-t border-slate-100 bg-slate-50/60 px-5 py-4 space-y-4'>
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
                                className='flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50/50 px-2.5 py-1.5 text-xs'
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
                                <div className='ml-auto text-right font-mono'>
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
                                className='flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50/50 px-2.5 py-1.5 text-xs'
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
                                </div>
                                <div className='ml-auto text-right font-mono'>
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

        {/* Right Column: Group Expenditure, Net Balances & Group Members (4 cols) */}
        <aside className='space-y-6 lg:col-span-4'>
          {/* Group Expenditure Card */}
          <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5'>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3'>
              <div className='flex items-center gap-2'>
                <Receipt className='h-4 w-4 shrink-0 text-slate-700' />
                <h2 className='text-sm font-semibold text-slate-900'>
                  Group Expenditure
                </h2>
              </div>
              <div className='flex flex-wrap items-center gap-1.5'>
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
                  aria-label='Expenditure currency'
                  className='max-w-[130px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-semibold text-slate-700'
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
              <div className='mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/70 px-3 py-1.5 text-[11px] text-indigo-800'>
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

            <div className='mt-3 space-y-2.5'>
              {expenditures.map(({ member, totalPaid, totalBenefited }) => {
                const displayCurrency = isTranslating
                  ? translateCurrency
                  : activeCurrency;

                return (
                  <div
                    key={member.id}
                    className='flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5'
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${member.avatarColor}`}
                    >
                      {member.name.slice(0, 1)}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <div className='text-xs font-semibold text-slate-900'>
                        {member.name}
                      </div>
                      <div className='text-[11px] leading-snug text-slate-500'>
                        <div>
                          Paid {formatCurrency(totalPaid, displayCurrency)}
                        </div>
                        <div>
                          Used {formatCurrency(totalBenefited, displayCurrency)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Net Balances Card */}
          <div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5'>
            <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3'>
              <div className='flex items-center gap-2'>
                <Scale className='h-4 w-4 shrink-0 text-slate-700' />
                <h2 className='text-sm font-semibold text-slate-900'>
                  Group Balances
                </h2>
              </div>
              <div className='flex flex-wrap items-center gap-1.5'>
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
                  className='max-w-[130px] truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs font-semibold text-slate-700'
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
              <div className='mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/70 px-3 py-1.5 text-[11px] text-indigo-800'>
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

            <div className='mt-3 space-y-2.5'>
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
                      className='flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5'
                    >
                      <div className='flex min-w-0 items-center gap-2.5'>
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${member.avatarColor}`}
                        >
                          {member.name.slice(0, 1)}
                        </span>
                        <div className='min-w-0'>
                          <div className='text-xs font-semibold text-slate-900'>
                            {member.name}
                          </div>
                          <div className='text-[11px] leading-snug text-slate-500'>
                            <div>
                              Paid {formatCurrency(totalPaid, displayCurrency)}
                            </div>
                            <div>
                              Used{" "}
                              {formatCurrency(totalBenefited, displayCurrency)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className='ml-auto text-right font-mono text-xs font-bold'>
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
                        className='flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50/70 px-3 py-2 text-xs'
                      >
                        <div className='flex flex-wrap items-center gap-1.5 font-medium text-slate-800'>
                          <span>{from?.name}</span>
                          <ArrowRight className='h-3.5 w-3.5 text-slate-400' />
                          <span>{to?.name}</span>
                        </div>
                        <span className='ml-auto text-right font-mono font-bold text-amber-900'>
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
          <div className='max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl'>
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
              {/* Collapsible Fill with AI Section (Hidden Initially) */}
              <div className='rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-3.5 shadow-2xs'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <button
                    type='button'
                    onClick={() => setIsAiPanelOpen((prev) => !prev)}
                    className='flex flex-1 items-center justify-between gap-2 text-left'
                  >
                    <div className='flex items-center gap-2'>
                      <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white'>
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
                    <span className='inline-flex items-center gap-1 rounded-lg border border-indigo-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50'>
                      {isAiPanelOpen ? (
                        <>
                          Hide
                          <ChevronUp className='h-3.5 w-3.5' />
                        </>
                      ) : (
                        <>
                          Show
                          <ChevronDown className='h-3.5 w-3.5' />
                        </>
                      )}
                    </span>
                  </button>

                  {isAiPanelOpen && (
                    <button
                      type='button'
                      onClick={() => setShowApiKeyInput((prev) => !prev)}
                      className='inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50'
                    >
                      <KeyRound className='h-3 w-3 text-slate-500' />
                      {openAiKey ? "API Key Set" : "OpenAI Key"}
                    </button>
                  )}
                </div>

                {isAiPanelOpen && (
                  <div className='mt-3 border-t border-indigo-100/80 pt-3'>
                    {showApiKeyInput && (
                      <div className='mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5'>
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

                    <div className='flex flex-col gap-2.5 sm:flex-row'>
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
                    onChange={(e) => {
                      const nextCat = e.target.value;
                      setCategory(nextCat);
                      if (nextCat === "Exchange") {
                        setDraftIsExchange(true);
                      }
                    }}
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

              <div className='flex flex-col gap-2'>
                <label className='inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100/70'>
                  <input
                    type='checkbox'
                    checked={draftIsExchange}
                    onChange={(e) => setDraftIsExchange(e.target.checked)}
                    className='h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600'
                  />
                  <ArrowLeftRight className='h-3.5 w-3.5 text-indigo-600' />
                  <span>
                    Mark solely as an exchange / transfer not paid to a merchant
                    (included in Group Balances, excluded from Group
                    Expenditure)
                  </span>
                </label>

                <label className='inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100/70'>
                  <input
                    type='checkbox'
                    checked={draftHidden}
                    onChange={(e) => setDraftHidden(e.target.checked)}
                    className='h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900'
                  />
                  <EyeOff className='h-3.5 w-3.5 text-slate-500' />
                  <span>
                    Hide this transaction from the ledger (excludes it from
                    Group Balances &amp; Settlements)
                  </span>
                </label>
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
                          className='flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200/70 bg-white p-2.5'
                        >
                          <select
                            value={entry.memberId}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                memberId: e.target.value,
                              })
                            }
                            className='min-w-[95px] flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium'
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
                            className='min-w-[105px] flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700'
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
                            className='w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs'
                          />
                          <div className='flex w-full items-center gap-1.5'>
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
                              className='min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-right font-mono text-sm font-semibold'
                            />
                            <button
                              type='button'
                              onClick={() => removeDraftEntry(entry.id)}
                              className='shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                            </button>
                          </div>
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
                          className='flex flex-wrap items-center gap-2 rounded-lg border border-sky-200/70 bg-white p-2.5'
                        >
                          <select
                            value={entry.memberId}
                            onChange={(e) =>
                              updateDraftEntry(entry.id, {
                                memberId: e.target.value,
                              })
                            }
                            className='w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium'
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
                            className='w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs'
                          />
                          <div className='flex w-full items-center gap-1.5'>
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
                              className='min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-right font-mono text-sm font-semibold'
                            />
                            <button
                              type='button'
                              onClick={() => removeDraftEntry(entry.id)}
                              className='shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600'
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                            </button>
                          </div>
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
