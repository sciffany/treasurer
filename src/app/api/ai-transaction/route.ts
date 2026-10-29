import { NextRequest, NextResponse } from "next/server";
import { CurrencyCode, Member, PaymentMethod } from "@/types/budget";
import {
  DeterministicTransactionBuilder,
  VALID_CATEGORIES,
  VALID_PAYMENT_METHODS,
} from "@/lib/transaction-json";

/**
 * Builds OpenAI strict function-calling tools (`strict: true`).
 * OpenAI compiles these schemas into a context-free grammar during token sampling,
 * guaranteeing that tool arguments strictly match our schema and enums.
 */
function buildStrictLedgerTools(memberNames: string[]) {
  const memberDescription =
    memberNames.length > 0
      ? `Member name from the group (${memberNames.join(", ")}) or a new person's name if not in the list.`
      : "Name of the member involved.";

  return [
    {
      type: "function" as const,
      function: {
        name: "set_metadata",
        description:
          "Set the parent transaction's metadata (title, date, currency, category, notes). Always call this first.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["title", "date", "currency", "category", "notes"],
          properties: {
            title: {
              type: "string",
              description:
                "Concise title for the transaction (e.g., 'FairPrice Groceries', 'Hotpot Dinner').",
            },
            date: {
              type: ["string", "null"],
              description:
                "Transaction date in YYYY-MM-DD format, or null to keep default date.",
            },
            currency: {
              type: ["string", "null"],
              description:
                "3-letter ISO currency code (e.g., 'SGD', 'USD', 'EUR', 'JPY'), or null to keep default currency.",
            },
            category: {
              type: "string",
              enum: [...VALID_CATEGORIES],
              description: "Transaction category.",
            },
            notes: {
              type: ["string", "null"],
              description: "Optional summary notes about how the bill was split.",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "add_payer",
        description:
          "Record an atomic PAYER mini-transaction for a single person who paid money at checkout.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["member", "amount", "paymentMethod", "label"],
          properties: {
            member: {
              type: "string",
              description: memberDescription,
            },
            amount: {
              type: "number",
              description:
                "Amount paid by this member. Use 0 only if the total paid equals the sum of itemized beneficiary entries and will be auto-calculated.",
            },
            paymentMethod: {
              type: "string",
              enum: [...VALID_PAYMENT_METHODS],
              description: "Payment method used by this payer.",
            },
            label: {
              type: ["string", "null"],
              description:
                "Short note for what they paid (e.g., 'Paid full receipt at checkout', 'Cash for drinks').",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "add_beneficiary",
        description:
          "Record an atomic BENEFICIARY mini-transaction for a specific item or exact amount consumed by one person.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["member", "amount", "label"],
          properties: {
            member: {
              type: "string",
              description: memberDescription,
            },
            amount: {
              type: "number",
              description: "Exact amount this member benefited / consumed.",
            },
            label: {
              type: "string",
              description:
                "Item or share description (e.g., 'Oat milk & cold brew', 'Ribeye steak').",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "split_equally",
        description:
          "Deterministically split an amount (or the remaining unallocated balance) equally across a list of members, handling exact cent-rounding automatically.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["members", "amount", "useRemainingUnallocated", "label"],
          properties: {
            members: {
              type: "array",
              items: {
                type: "string",
              },
              description:
                "List of member names sharing this split. Pass all relevant group member names.",
            },
            amount: {
              type: ["number", "null"],
              description:
                "Total amount to split equally across the members, or null if useRemainingUnallocated is true.",
            },
            useRemainingUnallocated: {
              type: "boolean",
              description:
                "Set to true to split whatever balance remains (totalPaid minus already itemized beneficiaries) equally.",
            },
            label: {
              type: "string",
              description:
                "Description for the shared split (e.g., 'Shared veggies & eggs', 'Equal dinner share').",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "record_self_paid",
        description:
          "Record a self-paid item where a member both paid for and benefited from their own specific tier/item (e.g., individual insurance policy tier in a group booking). Creates both the PAYER and matching BENEFICIARY entry.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["member", "amount", "paymentMethod", "label"],
          properties: {
            member: {
              type: "string",
              description: memberDescription,
            },
            amount: {
              type: "number",
              description: "Amount paid and consumed by this member.",
            },
            paymentMethod: {
              type: "string",
              enum: [...VALID_PAYMENT_METHODS],
              description: "Payment method used by this member.",
            },
            label: {
              type: "string",
              description:
                "Description of the self-paid tier or item (e.g., 'Standard Plan', 'Winter Sports Plan').",
            },
          },
        },
      },
    },
  ];
}

interface AiTransactionRequestBody {
  prompt: string;
  members: Member[];
  defaultCurrency?: CurrencyCode;
  defaultDate?: string;
  apiKey?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AiTransactionRequestBody;
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return NextResponse.json(
        { error: "Please provide a transaction description." },
        { status: 400 }
      );
    }

    const apiKey = body.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Please enter your OpenAI API key to use AI auto-fill.",
          missingApiKey: true,
        },
        { status: 401 }
      );
    }

    const members: Member[] = Array.isArray(body.members) ? body.members : [];
    const defaultCurrency: CurrencyCode = body.defaultCurrency ?? "SGD";
    const defaultDate: string =
      body.defaultDate ?? new Date().toISOString().slice(0, 10);

    const memberNames = members.map((m) => m.name);
    const tools = buildStrictLedgerTools(memberNames);

    const systemMessage = [
      "You are a precise ledger assistant for a group expense tracker.",
      "You do NOT output raw JSON directly. Instead, you MUST call the provided deterministic ledger tools to construct the transaction.",
      `Current group members: ${memberNames.length > 0 ? memberNames.join(", ") : "None yet"}.`,
      `Default currency: ${defaultCurrency}. Default date: ${defaultDate}.`,
      "",
      "Tool execution order rules:",
      "1. Call `set_metadata` first to set the title, category, currency, date, and notes.",
      "2. Call `add_payer` for each person who paid money at checkout (or `record_self_paid` when someone paid for their own specific coverage/item).",
      "3. Call `add_beneficiary` for specific individual items consumed by one person.",
      "4. Call `split_equally` whenever an amount or the remaining unallocated receipt balance is shared equally among a set of members. Always call `add_payer` and specific `add_beneficiary` calls BEFORE `split_equally` when `useRemainingUnallocated: true`.",
      "5. Emit all necessary tool calls in a single turn.",
    ].join("\n");

    const openAiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          tools,
          tool_choice: "required",
          parallel_tool_calls: true,
        }),
      }
    );

    if (!openAiResponse.ok) {
      const errData = await openAiResponse.json().catch(() => ({}));
      const errMessage =
        errData?.error?.message ||
        `OpenAI API error (${openAiResponse.status})`;
      return NextResponse.json({ error: errMessage }, { status: openAiResponse.status });
    }

    const completion = await openAiResponse.json();
    const message = completion?.choices?.[0]?.message;
    const rawToolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = message?.tool_calls ?? [];

    if (rawToolCalls.length === 0) {
      return NextResponse.json(
        { error: "Couldn't understand that expense. Try describing who paid and how it was split." },
        { status: 422 }
      );
    }

    // Order tool calls so that:
    // 1. set_metadata runs first
    // 2. add_payer & record_self_paid run next (establishing totalPaid)
    // 3. add_beneficiary runs next (allocating fixed items)
    // 4. split_equally runs last (so useRemainingUnallocated has accurate remaining balance)
    const priority: Record<string, number> = {
      set_metadata: 1,
      add_payer: 2,
      record_self_paid: 2,
      add_beneficiary: 3,
      split_equally: 4,
    };

    const sortedToolCalls = [...rawToolCalls].sort((a, b) => {
      const pa = priority[a.function.name] ?? 5;
      const pb = priority[b.function.name] ?? 5;
      return pa - pb;
    });

    const builder = new DeterministicTransactionBuilder({
      members,
      defaultCurrency,
      defaultDate,
    });

    for (const tc of sortedToolCalls) {
      const fnName = tc.function.name;
      const args = JSON.parse(tc.function.arguments);

      switch (fnName) {
        case "set_metadata":
          builder.setMetadata(args);
          break;
        case "add_payer":
          builder.addPayer({
            member: args.member,
            amount: args.amount,
            paymentMethod: args.paymentMethod as PaymentMethod,
            label: args.label,
          });
          break;
        case "add_beneficiary":
          builder.addBeneficiary({
            member: args.member,
            amount: args.amount,
            label: args.label,
          });
          break;
        case "split_equally":
          builder.splitEqually({
            members: args.members,
            amount: args.amount,
            useRemainingUnallocated: args.useRemainingUnallocated,
            label: args.label,
          });
          break;
        case "record_self_paid":
          builder.recordSelfPaid({
            member: args.member,
            amount: args.amount,
            paymentMethod: args.paymentMethod as PaymentMethod,
            label: args.label,
          });
          break;
      }
    }

    const result = builder.buildResult();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Error in /api/ai-transaction:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to generate transaction from prompt.",
      },
      { status: 500 }
    );
  }
}
