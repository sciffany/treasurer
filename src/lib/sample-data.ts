import { Member, Transaction } from "@/types/budget";

export const INITIAL_MEMBERS: Member[] = [
  { id: "m-alice", name: "Alice", avatarColor: "bg-emerald-500" },
  { id: "m-bob", name: "Bob", avatarColor: "bg-sky-500" },
  { id: "m-charlie", name: "Charlie", avatarColor: "bg-amber-500" },
  { id: "m-diana", name: "Diana", avatarColor: "bg-rose-500" },
];

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-grocery",
    title: "Supermarket Grocery Run",
    date: "2026-10-28",
    currency: "SGD",
    category: "Groceries",
    notes: "Alice paid at checkout; split by item and shared groceries",
    entries: [
      // Payer entry (1 payer)
      {
        id: "e-1",
        role: "PAYER",
        memberId: "m-alice",
        amount: 84.5,
        paymentMethod: "Credit Card",
        label: "Paid full receipt at checkout",
      },
      // Beneficiary entries (itemized per person)
      {
        id: "e-2",
        role: "BENEFICIARY",
        memberId: "m-bob",
        amount: 14.5,
        label: "Oat milk & cold brew",
      },
      {
        id: "e-3",
        role: "BENEFICIARY",
        memberId: "m-charlie",
        amount: 28.0,
        label: "Ribeye steak & chips",
      },
      {
        id: "e-4",
        role: "BENEFICIARY",
        memberId: "m-alice",
        amount: 12.0,
        label: "Greek yogurt & berries",
      },
      {
        id: "e-5",
        role: "BENEFICIARY",
        memberId: "m-alice",
        amount: 10.0,
        label: "Shared veggies & eggs (1/3)",
      },
      {
        id: "e-6",
        role: "BENEFICIARY",
        memberId: "m-bob",
        amount: 10.0,
        label: "Shared veggies & eggs (1/3)",
      },
      {
        id: "e-7",
        role: "BENEFICIARY",
        memberId: "m-charlie",
        amount: 10.0,
        label: "Shared veggies & eggs (1/3)",
      },
    ],
  },
  {
    id: "tx-insurance",
    title: "Group Travel Insurance",
    date: "2026-10-26",
    currency: "SGD",
    category: "Insurance",
    notes: "Everyone paid their own respective tier into the group policy",
    entries: [
      // Multiple Payers: each person paid their own amount
      {
        id: "e-8",
        role: "PAYER",
        memberId: "m-alice",
        amount: 115.0,
        paymentMethod: "PayNow",
        label: "Alice paid Standard Plan",
      },
      {
        id: "e-9",
        role: "PAYER",
        memberId: "m-bob",
        amount: 145.0,
        paymentMethod: "Credit Card",
        label: "Bob paid Winter Sports Plan",
      },
      {
        id: "e-10",
        role: "PAYER",
        memberId: "m-charlie",
        amount: 115.0,
        paymentMethod: "PayNow",
        label: "Charlie paid Standard Plan",
      },
      // Matching Beneficiary entries
      {
        id: "e-11",
        role: "BENEFICIARY",
        memberId: "m-alice",
        amount: 115.0,
        label: "Alice policy coverage",
      },
      {
        id: "e-12",
        role: "BENEFICIARY",
        memberId: "m-bob",
        amount: 145.0,
        label: "Bob policy coverage + add-on",
      },
      {
        id: "e-13",
        role: "BENEFICIARY",
        memberId: "m-charlie",
        amount: 115.0,
        label: "Charlie policy coverage",
      },
    ],
  },
  {
    id: "tx-dinner",
    title: "Hotpot & Drinks Night",
    date: "2026-10-25",
    currency: "SGD",
    category: "Dining",
    notes: "Bob & Diana split the payment; all 4 shared the meal",
    entries: [
      {
        id: "e-14",
        role: "PAYER",
        memberId: "m-bob",
        amount: 120.0,
        paymentMethod: "Credit Card",
        label: "Card payment at counter",
      },
      {
        id: "e-15",
        role: "PAYER",
        memberId: "m-diana",
        amount: 40.0,
        paymentMethod: "Cash",
        label: "Cash for craft beers",
      },
      {
        id: "e-16",
        role: "BENEFICIARY",
        memberId: "m-alice",
        amount: 40.0,
        label: "Equal dinner share",
      },
      {
        id: "e-17",
        role: "BENEFICIARY",
        memberId: "m-bob",
        amount: 40.0,
        label: "Equal dinner share",
      },
      {
        id: "e-18",
        role: "BENEFICIARY",
        memberId: "m-charlie",
        amount: 40.0,
        label: "Equal dinner share",
      },
      {
        id: "e-19",
        role: "BENEFICIARY",
        memberId: "m-diana",
        amount: 40.0,
        label: "Equal dinner share",
      },
    ],
  },
];
