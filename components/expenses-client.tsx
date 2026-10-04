"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { AlertTriangle, Calendar, Plus, Printer, Trash2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/component";
import { describeDbError, wasSilentlyBlocked } from "@/lib/utils/db-error";
import { useRole } from "@/components/role-provider";
import { clearDrafts, useDraft } from "@/hooks/use-draft";
import {
  MANAGER_BACKDATE_DAYS,
  managerEarliestDay,
  shopToday,
  withinManagerWindow,
} from "@/lib/shop-date";
import { SupplierDuesPanel } from "@/components/supplier-dues-panel";
import { money } from "@/lib/purchase-voucher";
import { PaymentRoute, usePaymentMethods } from "@/components/payment-route";
import { useSubscription } from "@/components/subscription-provider";
import { DateRangeFilter } from "@/components/date-range-filter";
import { shopHeader } from "@/lib/utils/shop-header";
import { ManagerAccessBadge } from "@/components/role-badge";
import { ManageOptionsButton, OptionManager } from "@/components/option-manager";
import { useShopLabels } from "@/hooks/use-shop-labels";
import { isOptionHidden } from "@/lib/shop-labels";
import { labelFor } from "@/lib/shop-labels";
import {
  BUILT_IN_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORIES as expenseCategories,
} from "@/lib/expense-categories";
import { useFieldFlow, useHotkeys } from "@/hooks/use-keyboard-flow";
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt";

const supabase = createClient();

type ExpenseEntry = {
  id?: string;
  date: string;
  category: string;
  custom_category?: string;
  description: string;
  amount: number;
  payment_method: string;
  reference?: string;
  notes?: string;
  user_id?: string;
  organization_id?: string;
  created_at?: string;
  updated_at?: string;
};

type Supplier = {
  id: string;
  name: string;
};


/**
 * The Select carries one string per choice, but a saved category is
 * two facts — the 'other' enum plus the shop's wording. This marks the
 * second kind so they cannot collide with a built-in value.
 */
const CUSTOM_CATEGORY_PREFIX = "custom:";

// Payment methods from your schema
const paymentMethods = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "mobile_banking", label: "Mobile Banking" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

/**
 * A yyyy-mm-dd day as the shop says it: 22/09/2026.
 *
 * Built from the parts rather than through Date, which would read the
 * string as UTC midnight and print the day before in Dhaka.
 */
function dayLabel(day: string) {
  const [y, m, d] = (day || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : day;
}

export function ExpensesClient() {
  const { currentShopId, accountType, shops } = useRole();
  const { canWrite } = useSubscription();
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId));
  const isOwner = accountType === "owner";
  // What this shop calls the built-in categories. Empty for a shop that
  // has renamed nothing, and every label falls back to ours.
  const { labels, hidden, reload: reloadLabels } = useShopLabels();

  /**
   * The heads this shop actually uses.
   *
   * A built-in taken off the list is hidden, never deleted — the value
   * still works and every past record still names itself. It just stops
   * being one more thing to scroll past. "Other (Custom)" is always
   * offered: it is the escape hatch, not a head.
   */
  const visibleCategories = expenseCategories.filter(
    (c) =>
      c.value === "other" ||
      !isOptionHidden(hidden, "expense_category", c.value),
  );
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useDraft(
    "exp.supplier",
    "",
    currentShopId,
  );
  useEffect(() => {
    if (newExpense.category === "party_payment" && selectedSupplier) {
      const supplier = suppliers.find((s) => s.id === selectedSupplier);
      if (supplier) {
        autoDescription.current = supplier.name;
        setNewExpense((prev) => ({
          ...prev,
          description: `${supplier.name}`,
        }));
      }
    }
  }, [selectedSupplier, suppliers]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  // ---- What this supplier is owed, in total
  //
  // A payment goes against the BALANCE, not a delivery. The shop hands
  // over what it can and the database spreads it across the open
  // vouchers oldest first — asking the counter to pick one is asking a
  // question it does not have an answer to.
  //
  // A supplier with nothing outstanding still takes an ordinary
  // expense, exactly as before. That path must keep working: not every
  // payment to a supplier is against a delivery.
  const [supplierDues, setSupplierDues] = useState(0);

  /**
   * Which supplier the payment box was last filled in for.
   *
   * The box shows what is NET still to pay, so it has to follow the
   * supplier — including down to zero for one already paid ahead. But
   * it must not overwrite a figure the manager has typed, and the
   * panel reports more than once per supplier as it loads. Filling
   * once per supplier is what tells those two apart.
   */
  const amountFilledFor = useRef<string | null>(null);

  /**
   * What this form filled in by itself for a supplier payment: the
   * supplier's name as the description, and what is net still to pay.
   *
   * Remembered so that choosing a different category can take them back
   * out. Before, switching from Supplier Payment to Salaries kept the
   * supplier's name and the supplier's bill in the boxes — the next
   * expense was one click from being filed with both. Anything the
   * manager typed is theirs and is kept.
   */
  const autoDescription = useRef<string | null>(null);
  const autoAmount = useRef<number | null>(null);

  // Clearing the supplier — which is what saving a payment does —
  // forgets it, so choosing the SAME supplier again fills the box
  // afresh instead of leaving it on the amount just paid.
  useEffect(() => {
    if (!selectedSupplier) amountFilledFor.current = null;
  }, [selectedSupplier]);
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods();

  // Search filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Filters the rows already loaded, like the dropdowns on Income, so
  // choosing a category costs no query.
  const [filterCategory, setFilterCategory] = useState("all");

  // ---- The shop's own expense categories
  //
  // 'other' used to mean free text typed fresh every time, so the same
  // category was re-typed — and re-mis-typed — on every entry. They are
  // now a list in product_options beside the income types, seeded by
  // script 81 from whatever has already been entered.
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showManageCategories, setShowManageCategories] = useState(false);

  const loadCustomCategories = useCallback(async () => {
    if (!currentShopId) return;
    const { data, error } = await supabase
      .from("product_options")
      .select("value")
      .eq("organization_id", currentShopId)
      .eq("kind", "expense_category")
      .order("value");

    if (error) {
      // A missing list costs the shop its own wording; it must not stop
      // an expense being recorded at all.
      console.warn("Could not load expense categories:", error.message);
      return;
    }
    setCustomCategories((data ?? []).map((r: { value: string }) => r.value));
  }, [currentShopId]);

  useEffect(() => {
    loadCustomCategories();
  }, [loadCustomCategories]);

  /**
   * What to call an expense's category on screen and in print.
   *
   * Built-ins go through the shop's own wording; 'other' shows the
   * wording typed against that expense. Anything unrecognised falls
   * back to its raw value rather than a blank.
   *
   * Both callers used to have their own copy that returned the raw
   * enum for every ordinary category, so a water bill printed as
   * "water_bill".
   */
  const categoryLabel = (expense: { category: string; custom_category?: string | null }) => {
    if (expense.category === "other") return expense.custom_category || "Other";
    const builtIn = expenseCategories.find((c) => c.value === expense.category);
    return labelFor(
      labels,
      "expense_category",
      expense.category,
      builtIn?.label ?? expense.category,
    );
  };

  // The categories the loaded rows actually use, worded as the table
  // prints them — so the dropdown matches the column and offers nothing
  // that would come back empty.
  const categoryOptions = Array.from(
    new Set(expenses.map((e) => categoryLabel(e))),
  ).sort((a, b) => a.localeCompare(b));

  // A category that the new date range no longer contains filters
  // nothing, rather than leaving an empty table behind a dropdown that
  // does not offer it.
  const activeCategory = categoryOptions.includes(filterCategory)
    ? filterCategory
    : "all";
  const filteredExpenses =
    activeCategory === "all"
      ? expenses
      : expenses.filter((e) => categoryLabel(e) === activeCategory);

  /**
   * Remembers a category the moment it is actually used.
   *
   * Typing it into the box is how the shop adds one — asking them to
   * register it separately first would be a second step for no reason.
   * A failure here is deliberately silent: the expense itself is
   * already saved, and the only cost is that the wording is not
   * offered next time.
   */
  const rememberCategory = async (name: string) => {
    const value = name.trim();
    if (!value || !currentShopId) return;
    const { error } = await supabase
      .from("product_options")
      .insert({ organization_id: currentShopId, kind: "expense_category", value });
    // 23505 duplicate: already known. 23514: script 81 not run here yet.
    if (error && error.code !== "23505" && error.code !== "23514") {
      console.warn("Could not remember expense category:", error.message);
    }
    if (!error) await loadCustomCategories();
  };

  // Add expense form
  // Kept if the manager steps away mid-entry. See hooks/use-draft.ts.
  const [newExpense, setNewExpense] = useDraft(
    "exp.new",
    {
      date: shopToday(),
      category: "",
      customCategory: "",
      description: "",
      amount: 0,
      payment_method: "",
      bank_name: "",
      payment_channel: "",
      notes: "",
    },
    currentShopId,
    undefined,
    // Everything else comes back; the date starts again on today. The
    // stored draft is rewritten whenever the form is touched, so on a
    // screen used every day it never ages out, and a date typed once
    // silently files every later payment under it.
    (saved) => ({ ...saved, date: shopToday() }),
  );

  // Whether the form is pointing at today, and how to say a day out
  // loud. Both are used by the warning under the date and by the Add
  // button, which names the day when it is not today.
  const isToday = newExpense.date === shopToday();

  /**
   * Which item the Category box should show.
   *
   * A saved category selects its own entry; a wording being typed
   * fresh keeps the box on "Other (Custom)" rather than pointing at an
   * item that does not exist, which would blank the box mid-keystroke.
   */
  const categorySelectValue = (() => {
    if (newExpense.category !== "other") return newExpense.category;
    const typed = newExpense.customCategory.trim();
    return customCategories.includes(typed)
      ? `${CUSTOM_CATEGORY_PREFIX}${typed}`
      : "other";
  })();

  // The balance belongs to one supplier and one category. Leaving it
  // behind after either changes would settle against the wrong one.
  useEffect(() => {
    setSupplierDues(0);
  }, [selectedSupplier, newExpense.category]);

  // Load suppliers from database - FIXED to handle RLS properly
  const loadSuppliers = async () => {
    setSuppliersLoading(true);
    try {
      // First check if user is authenticated
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData?.user) {
        console.warn("User not authenticated, suppliers may be limited by RLS");
      }

      // Try to fetch suppliers
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        // Removed by the owner (script 92): kept for history, not offered.
        .is("deleted_at", null)
        .eq("organization_id", currentShopId)
        .order("name", { ascending: true });

      if (error) {
        console.error("Error loading suppliers:", error);
        // Don't throw, just log and continue with empty array
        setSuppliers([]);
        return;
      }

      console.log(`Loaded ${data?.length || 0} suppliers:`, data);
      setSuppliers(data || []);
    } catch (err: any) {
      console.error("Failed to load suppliers:", err);
      setSuppliers([]);
    } finally {
      setSuppliersLoading(false);
    }
  };

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return;

    // Load suppliers on mount
    loadSuppliers();

    // Open on today. Setting the dates is enough — the effect below
    // notices and runs the search, so there is no second query here.
    const today = new Date().toISOString().split("T")[0];
    setStartDate(today);
    setEndDate(today);
  }, [currentShopId]);

  /**
   * Choosing the dates IS the search, as on the Income screen.
   *
   * Debounced, because a date input fires on every keystroke, and an
   * earlier query's answer could otherwise land after a later one and
   * overwrite it.
   */
  useEffect(() => {
    if (!currentShopId) return;

    // A date input reports "" until the WHOLE date is valid, so a
    // blank From mid-typing is half a date, not a request for
    // everything. Clearing BOTH is deliberate and means all dates.
    const cleared = !startDate && !endDate;
    if (!startDate && !cleared) return;

    const timer = setTimeout(() => {
      if (cleared) {
        const todayIso = new Date().toISOString().split("T")[0];
        searchExpenses("2000-01-01", todayIso);
      } else {
        searchExpenses(startDate, endDate);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [startDate, endDate, currentShopId]);

  const searchExpenses = async (start?: string, end?: string) => {
    const searchStart = start || startDate;
    const searchEnd = end || endDate;

    if (!searchStart) {
      setError("Please select a start date");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check authentication first
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError) {
        console.error("Auth error:", userError);
        throw new Error("Please sign in to view expenses");
      }

      if (!userData?.user) {
        console.error("No authenticated user found");
        throw new Error("Please sign in to view expenses");
      }

      console.log("Searching expenses for user:", userData.user.id);

      // Build query - RLS policies will handle user filtering
      let query = supabase
        .from("expenses")
        .select("*")
        .eq("organization_id", currentShopId)
        .gte("date", searchStart)
        .order("date", { ascending: false });

      if (searchEnd && searchEnd !== searchStart) {
        query = query.lte("date", searchEnd);
      } else {
        query = query.lte("date", searchStart);
      }

      const { data, error: queryError } = await query;

      console.log("Search result:", { data, queryError, count: data?.length });

      if (queryError) {
        console.error("Database query error:", {
          message: queryError.message,
          details: queryError.details,
          code: queryError.code,
        });

        if (queryError.message?.includes("row-level security")) {
          throw new Error("Access denied. Please check your permissions.");
        } else {
          throw new Error(`Database error: ${queryError.message}`);
        }
      }

      console.log(`Found ${data?.length || 0} expenses`);
      setExpenses(data || []);
    } catch (err: any) {
      const errorMessage = err?.message || "Error loading expenses";
      console.error("Error loading expenses:", err);
      setError(errorMessage);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  const addExpense = async () => {
    // A manager records today only; the owner may pick any day (script
    // 93 enforces it). Worked out here rather than trusted from the
    // form: the form is kept as a draft, and one left open overnight
    // would still hold yesterday.
    // A manager records today or the three days before it; the owner
    // may pick any day. Script 95 enforces the same window, so this is
    // only about saying no early and in plain words. Worked out here
    // rather than trusted from the form: the form is kept as a draft
    // and one left open overnight would still hold yesterday.
    if (!isOwner && !withinManagerWindow(newExpense.date)) {
      toast.error(
        `Managers can record today or the last ${MANAGER_BACKDATE_DAYS} days. For an older date, ask the owner.`,
      );
      return;
    }
    const entryDate = isOwner ? newExpense.date : newExpense.date || shopToday();
    try {
      // Check authentication (still needed for RLS policies)
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError) {
        console.error("Auth error:", userError);
        toast.error("Authentication error. Please sign in.");
        return;
      }

      if (!userData?.user) {
        console.error("No authenticated user found");
        toast.error("Please sign in to add expenses.");
        return;
      }

      console.log("Adding expense for authenticated user");

      // Validation based on your simplified schema constraints
      let finalCategory = newExpense.category;
      let customCategory = null;

      // Special handling for party_payment (supplier payment)
      if (newExpense.category === "party_payment") {
        if (!selectedSupplier) {
          toast.error("Please select a supplier for supplier payment");
          return;
        }

        // Find supplier name from suppliers list
        const supplier = suppliers.find((s) => s.id === selectedSupplier);
        if (!supplier) {
          toast.error("Selected supplier not found");
          return;
        }

        // Set description to include supplier name
        if (!newExpense.description.trim()) {
          // If no description provided, use supplier payment as description
          newExpense.description = `Payment to ${supplier.name}`;
        }
      } else if (newExpense.category === "other") {
        if (!newExpense.customCategory.trim()) {
          toast.error("Please enter a custom category when selecting 'other'");
          return;
        }
        finalCategory = "other";
        customCategory = newExpense.customCategory.trim();
        // Offer it on the next entry rather than making someone type
        // it — and spell it differently — every time.
        void rememberCategory(customCategory);
      } else if (!newExpense.category) {
        toast.error("Please select a category");
        return;
      }

      if (
        newExpense.category === "party_payment" &&
        !newExpense.description.trim()
      ) {
        toast.error("Description is required for supplier payments");
        return;
      }

      if (newExpense.amount <= 0) {
        toast.error("Please enter a valid amount greater than 0");
        return;
      }

      // The picker RENDERS `payment_method || "cash"`, so a form left
      // on its default shows Cash while the stored value is still
      // empty. Reading it the same way the picker draws it is what
      // stops "Please select a payment method" firing at someone
      // looking straight at the word Cash.
      const paymentMethod = newExpense.payment_method || "cash";

      // Without this the expense saves with no account against it and
      // quietly disappears into"Not specified" on the Bank Info page,
      // which is exactly the gap this field exists to close.
      if (paymentMethod === "bank_transfer" && !newExpense.bank_name) {
        toast.error("Please select which bank account this was paid from");
        return;
      }

      // Without the method the entry lands under a bank with no way to
      // tell a card payment from a PULM one on the statement.
      if (paymentMethod !== "cash" && !newExpense.payment_channel) {
        toast.error("Please select how it was paid");
        return;
      }

      // ----------------------------------------------------------
      // Settling what a supplier is owed
      //
      // Two things have to happen together: the expense is recorded,
      // and the vouchers it clears fall by the same amount. Doing them
      // as separate calls from here means a dropped connection between
      // them leaves the shop either paying a debt it still owes or
      // owing one it has paid, with nothing on screen to say which.
      //
      // settle_supplier_dues (script 69) does both in one transaction,
      // spreads the money across the open vouchers oldest first,
      // refuses more than the supplier is owed, and is idempotent on
      // the txn id so a double-click cannot pay twice.
      //
      // A supplier with nothing outstanding falls straight through to
      // the ordinary insert below, exactly as before.
      // ----------------------------------------------------------
      if (newExpense.category === "party_payment" && supplierDues > 0) {
        const { data: settled, error: settleError } = await supabase.rpc(
          "settle_supplier_dues",
          {
            p_organization_id: currentShopId,
            p_client_txn_id: crypto.randomUUID(),
            p_supplier_id: selectedSupplier,
            p_amount: newExpense.amount,
            p_payment: {
              date: entryDate,
              description: newExpense.description.trim(),
              payment_method: paymentMethod,
              bank_name:
                paymentMethod === "cash" ? null : newExpense.bank_name || null,
              payment_channel:
                paymentMethod === "cash"
                  ? null
                  : newExpense.payment_channel || null,
              notes: newExpense.notes || null,
            },
          },
        );

        if (settleError) {
          console.error("settle_supplier_dues failed:", settleError);
          toast.error(`Could not record the payment: ${settleError.message}`);
          return;
        }

        const result = settled as {
          success: boolean;
          message?: string;
          supplier?: string;
          applied_to?: string[];
          vouchers_cleared?: number;
          remaining?: number;
          // Both arrive with script 89. Older databases send neither,
          // and the branches below fall back to what they always said.
          applied?: number;
          advance?: number;
        } | null;

        if (!result?.success) {
          toast.error(result?.message ?? "The payment was not recorded.");
          return;
        }

        const left = Number(result.remaining ?? 0);
        const advance = Number(result.advance ?? 0);
        const touched = result.applied_to ?? [];
        const who = result.supplier ?? "this supplier";

        // Three things can have happened, and the shop needs to know
        // which: some of the debt is left, it is exactly cleared, or it
        // is cleared with money over that is now on account.
        toast.success(
          left > 0
            ? `Paid against ${touched.join(", ")}. ${money(left)} still owed to ${who}.`
            : advance > 0
              ? touched.length > 0
                ? `Paid against ${touched.join(", ")}. ${money(advance)} kept as an advance with ${who}.`
                : `${money(advance)} paid to ${who} in advance.`
              : `${result.supplier ?? "This supplier"} is now paid in full.`,
        );

        setNewExpense({
          // Back to today, not the day just used. An owner filing one
          // old entry must not leave the form pointing at that day for
          // the next payment, which is how 11,700 paid on 22 September
          // came to be recorded on 1 September.
          date: shopToday(),
          category: "",
          customCategory: "",
          description: "",
          amount: 0,
          payment_method: "",
          bank_name: "",
          payment_channel: "",
          notes: "",
        });
        setSelectedSupplier("");
        // The stored copies too, or the expense reappears on the next
        // visit to this page.
        clearDrafts(currentShopId, ["exp.new", "exp.supplier"]);
        setSupplierDues(0);

        // Re-read rather than push a row on: the expense was written
        // by the database, so this is the one version of it.
        await searchExpenses();
        return;
      }

      // expenses.user_id is NOT NULL in the schema — it records who
      // entered the expense. This object previously omitted it, so
      // every save failed on the not-null constraint.
      const expenseToAdd = {
        date: entryDate,
        category: finalCategory,
        custom_category: customCategory,
        description: newExpense.description.trim(),
        amount: newExpense.amount,
        payment_method: paymentMethod,
        // Null for cash: there is no account for it to have come from.
        bank_name:
          paymentMethod === "cash" ? null : newExpense.bank_name || null,
        payment_channel:
          paymentMethod === "cash" ? null : newExpense.payment_channel || null,
        notes: newExpense.notes || null,
        supplier_id:
          newExpense.category === "party_payment" ? selectedSupplier : null,
        organization_id: currentShopId,
        user_id: userData.user.id,
      };

      console.log("Inserting expense:", expenseToAdd);

      const { data, error } = await supabase
        .from("expenses")
        .insert(expenseToAdd)
        .select()
        .single();

      console.log("Insert result:", { data, error });

      if (error) {
        console.error("Insert error details:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });

        // Handle specific errors
        if (error.message?.includes("row-level security") && !isOwner) {
          // Script 95 refuses a manager's entry outside today and the
          // three days before it. The form checks the same window, so
          // reaching this means the device's clock disagrees with the
          // shop's date.
          toast.error(
            `Managers can record today or the last ${MANAGER_BACKDATE_DAYS} days. If this date is inside that, check that this device's date and time are correct.`,
          );
        } else if (error.message?.includes("row-level security")) {
          toast.error("Access denied. Please check database permissions.");
        } else if (error.message?.includes("payment_method_check")) {
          toast.error(
            "Invalid payment method. Please select: cash, card, mobile_banking, or bank_transfer",
          );
        } else if (error.message?.includes("category_check")) {
          // "Paid To Owner" ships in the list but the database only
          // accepts it once script 88 has been run, and the till can
          // update before the migration does. Say which, rather than
          // telling the shop its own category is invalid.
          toast.error(
            newExpense.category === "owner_payment"
              ? "This shop's database has not been updated for Paid To Owner yet. Ask your administrator to run script 88."
              : "Invalid category. Please select from the available options.",
          );
        } else if (error.message?.includes("amount_check")) {
          toast.error("Amount must be greater than 0");
        } else if (error.message?.includes("custom_category")) {
          toast.error("Custom category is required when selecting 'other'");
        } else {
          toast.error(`Failed to add expense: ${error.message}`);
        }
        return;
      }

      if (!data) {
        toast.error("Failed to add expense: No data returned");
        return;
      }

      // Add to local state
      setExpenses([data, ...expenses]);

      // Reset form
      setNewExpense({
        date: shopToday(), // Back to today; see the settle branch above.
        category: "",
        customCategory: "",
        description: "",
        amount: 0,
        payment_method: "",
        bank_name: "",
        payment_channel: "",
        notes: "",
      });
      setSelectedSupplier(""); // Reset supplier selection
      clearDrafts(currentShopId, ["exp.new", "exp.supplier"]);

      console.log("Expense added successfully:", data);
      toast.success("Expense added successfully!");
    } catch (err: any) {
      console.error("Unexpected error adding expense:", err);
      toast.error(`Error adding expense: ${err?.message || "Unknown error"}`);
    }
  };

  // ---- Keyboard-first entry
  //
  // Expenses get logged between customers, so the form has to run off
  // the keyboard alone. Enter walks the fields top to bottom and saves
  // from the last one. F2 opens the form, Esc closes it, F3 jumps back
  // to the date search.
  //
  // The category / supplier / payment-method dropdowns stay out of the
  // Enter chain: Enter has to keep opening them, so Tab moves through
  // those as it always has.

  const addFlow = useFieldFlow();

  useHotkeys(
    {
      // The form is always on screen now, so this only has to put the
      // cursor in it.
      f2: () => addFlow.focusIndex(0),
      f3: () => {
        // DateRangeFilter owns these inputs now, so focus by its
        // generated id rather than a field-flow index.
        const el = document.getElementById(
          "expenses-start",
        ) as HTMLInputElement | null;
        el?.focus();
        el?.select?.();
      },
    },
    { allowInInputs: ["f2", "f3"] },
  );

  // ---- Owner: correcting an expense
  //
  // A plain UPDATE, not an RPC: expenses carry no stock or balance
  // consequences, and RLS already restricts UPDATE on this table to the
  // owner. `.select()` afterwards is what tells a real save apart from
  // one the database silently refused — a row blocked by RLS matches
  // nothing and returns no error, which would otherwise report success.
  const [editExpense, setEditExpense] = useState<ExpenseEntry | null>(null);
  const [editForm, setEditForm] = useState({
    date: "",
    category: "",
    custom_category: "",
    description: "",
    amount: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditExpense = (e: ExpenseEntry) => {
    setEditExpense(e);
    setEditForm({
      date: e.date ?? "",
      category: e.category ?? "",
      custom_category: e.custom_category ?? "",
      description: e.description ?? "",
      amount: e.amount != null ? String(e.amount) : "",
      notes: e.notes ?? "",
    });
  };

  const saveExpenseEdit = async () => {
    if (!editExpense?.id || !currentShopId) return;

    const amount = Number(editForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (!editForm.description.trim()) {
      toast.error("A description is required.");
      return;
    }

    setSavingEdit(true);
    try {
      const { data, error } = await supabase
        .from("expenses")
        .update({
          date: editForm.date,
          category: editForm.category,
          custom_category:
            editForm.category === "other"
              ? editForm.custom_category.trim()
              : null,
          description: editForm.description.trim(),
          amount,
          notes: editForm.notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editExpense.id)
        .eq("organization_id", currentShopId)
        .select("id");

      if (error) {
        const failure = describeDbError(error, {
          subscriptionActive: canWrite,
        });
        toast.error(failure.title, { description: failure.message });
        return;
      }

      if (wasSilentlyBlocked(data)) {
        toast.error("Not allowed", {
          description: "Only the shop owner can change expense records.",
        });
        return;
      }

      setExpenses((prev) =>
        prev.map((e) =>
          e.id === editExpense.id
            ? {
                ...e,
                date: editForm.date,
                category: editForm.category,
                custom_category:
                  editForm.category === "other"
                    ? editForm.custom_category.trim()
                    : undefined,
                description: editForm.description.trim(),
                amount,
                notes: editForm.notes.trim() || undefined,
              }
            : e,
        ),
      );
      setEditExpense(null);
      toast.success(
        "Expense updated",
        editExpense.category === "party_payment" &&
          Number(editExpense.amount) !== amount
          ? { description: "The payment was re-applied to this supplier's vouchers, oldest first." }
          : undefined,
      );
    } catch (err: any) {
      toast.error("Error updating expense", { description: err?.message });
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteExpense = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense?")) return;

    try {
      // .select() so we can tell an actual delete apart from one the
      // database silently refused: a row blocked by row-level security
      // matches nothing and returns no error, which would otherwise
      // make the UI claim success while the record still exists.
      const { data, error } = await supabase
        .from("expenses")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentShopId)
        .select("id");

      if (error) {
        const failure = describeDbError(error, {
          subscriptionActive: canWrite,
        });
        toast.error(failure.title, { description: failure.message });
        return;
      }

      if (wasSilentlyBlocked(data)) {
        toast.error("Not allowed", {
          description: "Only the shop owner can delete expense records.",
        });
        return;
      }

      const removed = expenses.find((e) => e.id === id);
      setExpenses(expenses.filter((e) => e.id !== id));
      // The database takes a supplier payment back off the vouchers it
      // paid (script 101), so they show as due again. Say so, or the
      // dues reappearing looks like a fault.
      toast.success(
        "Expense deleted",
        removed?.category === "party_payment"
          ? { description: "The vouchers it paid are due again." }
          : undefined,
      );
    } catch (err: any) {
      console.error("Error deleting expense:", err);
      toast.error("Error deleting expense");
    }
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Preview did not open", {
        description: "Allow pop-ups for this application, then try again.",
      });
      return;
    }
    const printContent = generatePrintContent();
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  const generatePrintContent = () => {
    const formatDate = (date: string) => {
      return new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    };

    const totalAmount = filteredExpenses.reduce(
      (sum, expense) => sum + (expense.amount || 0),
      0,
    );

    const dateRange =
      startDate === endDate
        ? formatDate(startDate)
        : `${formatDate(startDate)} --- ${formatDate(endDate)}`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Expense Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .company-name { font-size: 24px; font-weight: bold; margin-bottom: 8px; }
          .address { font-size: 12px; margin-bottom: 8px; }
          .period { font-size: 12px; margin-bottom: 20px; }
          .title-oval { 
            border: 2px solid black; 
            border-radius: 50px; 
            padding: 8px 30px; 
            display: inline-block; 
            font-size: 18px; 
            font-weight: bold; 
          }
          .expense-table { 
            width: 100%; 
            border-collapse: collapse; 
            border: 2px solid black; 
            margin-bottom: 30px; 
          }
          .expense-table th, .expense-table td { 
            border: 1px solid black; 
            padding: 8px; 
            text-align: left; 
          }
          .expense-table th { 
            background-color: #f0f0f0; 
            font-weight: bold; 
            text-align: center;
          }
          .amount-cell { text-align: right; }
          .total-row { 
            font-weight: bold; 
            background-color: #f0f0f0; 
          }
          .total-amount { 
            text-align: center; 
            margin: 30px 0; 
          }
          .total-title { 
            font-size: 20px; 
            font-weight: bold; 
            margin-bottom: 10px; 
          }
          .total-value { 
            font-size: 36px; 
            font-weight: bold; 
            border-top: 2px solid black; 
            padding-top: 10px; 
            display: inline-block; 
            min-width: 200px;
          }
        ${DOCUMENT_TOOLBAR_CSS}
        </style>
      </head>
      <body>
        ${documentToolbar("Expense Report")}
        <div class="header">
          <div class="company-name">${header.name}</div>
          <div class="address">${header.addressLine}</div>
          <div class="period">PERIOD : ${dateRange}</div>
          <div class="title-oval">EXPENSE REPORT</div>
        </div>

        <table class="expense-table">
          <thead>
            <tr>
              <th style="width: 15%;">Date</th>
              <th style="width: 20%;">Category</th>
              <th style="width: 20%;">Payment Method</th>
              <th style="width: 25%;">Description</th>
              <th style="width: 20%;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${filteredExpenses
              .map(
                (expense) => `
              <tr>
                <td>${formatDate(expense.date)}</td>
                <td>${categoryLabel(expense)}</td>
                <td>${expense.payment_method}</td>
                <td>${expense.description}</td>
                <td class="amount-cell">৳${expense.amount.toFixed(2)}</td>
              </tr>
            `,
              )
              .join("")}
            <tr class="total-row">
              <td colspan="4" style="text-align: right; font-weight: bold;">TOTAL EXPENSES:</td>
              <td class="amount-cell">৳${totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="total-amount">
          <div class="total-title">Total Expenses ৳${totalAmount.toFixed(2)}</div>
        </div>

      </body>
      </html>
    `;
  };

  const totalAmount = filteredExpenses.reduce(
    (sum, expense) => sum + (expense.amount || 0),
    0,
  );

  return (
    <div className="flex-1 p-8 pt-6">
      {/* Error Display */}
      {error && (
        <Card className="mb-6 border-red-200">
          <CardContent className="p-4">
            <div className="text-red-600 font-medium">Error: {error}</div>
          </CardContent>
        </Card>
      )}

      {/* The form on the left, always open; everything it feeds on
          the right.

          This was a narrow, centred page with a full-width card
          folded behind a "Show Form" button and the search, summary and
          records stacked under it. Recording a few expenses meant clicking
          Show Form every time, and on the shop's screen the whole thing
          sat in the middle third with the records below the fold.

          Entering expenses is what this page is for, so the form is always
          there, and the page runs the full width like Inventory and
          Purchases. The two columns are near enough equal: the form
          needs the room for four fields across, the records for six
          columns. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Add Expense
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                <div>
                  <Label htmlFor="expense-date">Date*</Label>
                  <Input
                    id="expense-date"
                    {...addFlow.field(0)}
                    type="date"
                    value={newExpense.date}
                    // A manager may go back three days, no further and
                    // never forward; the picker itself greys the rest
                    // out, so the rule is visible before it is hit.
                    // Script 95 enforces the same window.
                    min={isOwner ? undefined : managerEarliestDay()}
                    max={isOwner ? undefined : shopToday()}
                    onChange={(e) =>
                      setNewExpense({ ...newExpense, date: e.target.value })
                    }
                    required
                  />
                  {!isOwner && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Today or the last {MANAGER_BACKDATE_DAYS} days. For an older date, ask the
                      owner.
                    </p>
                  )}
                  {!isOwner && !isToday && withinManagerWindow(newExpense.date) && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Not today. This goes in the books on {dayLabel(newExpense.date)}.</span>
                    </p>
                  )}
                  {isOwner && !isToday && (
                    // Loud on purpose. Money filed under another day
                    // leaves that day's cashbook without it, and the
                    // shop finds out weeks later.
                    <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Not today. This goes in the books on {dayLabel(newExpense.date)}, not{" "}
                        {dayLabel(shopToday())}.
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="category">Category*</Label>
                  <div className="flex gap-2">
                    <Select
                      value={categorySelectValue}
                      onValueChange={(value) => {
                        // Worked out BEFORE either branch below, so that
                        // leaving Supplier Payment for a custom category
                        // clears the supplier's name and bill too — that
                        // branch returns early and used to skip this.
                        const leavingSupplier =
                          newExpense.category === "party_payment" &&
                          value !== "party_payment";
                        const supplierName = suppliers.find(
                          (s) => s.id === selectedSupplier,
                        )?.name;
                        const typed = (newExpense.description ?? "").trim();
                        const descriptionWasAuto =
                          typed !== "" &&
                          (typed === autoDescription.current || typed === supplierName);
                        const amountWasAuto =
                          autoAmount.current !== null &&
                          newExpense.amount === autoAmount.current;
                        if (leavingSupplier) {
                          autoDescription.current = null;
                          autoAmount.current = null;
                        }
                        const carried = {
                          description:
                            leavingSupplier && descriptionWasAuto ? "" : newExpense.description,
                          amount: leavingSupplier && amountWasAuto ? 0 : newExpense.amount,
                        };

                        // A saved category is 'other' plus its wording.
                        // Unpacked here so everything downstream keeps
                        // reading plain category / customCategory.
                        if (value.startsWith(CUSTOM_CATEGORY_PREFIX)) {
                          setNewExpense({
                            ...newExpense,
                            ...carried,
                            category: "other",
                            customCategory: value.slice(CUSTOM_CATEGORY_PREFIX.length),
                          });
                          setSelectedSupplier("");
                          return;
                        }
                        setNewExpense({
                          ...newExpense,
                          category: value,
                          // Leaving the old wording behind would file the
                          // next expense under a category nobody picked.
                          customCategory: value === "other" ? newExpense.customCategory : "",
                          // The supplier's name and bill belonged to the
                          // supplier payment, not to whatever comes next.
                          ...carried,
                        });
                        // Reset supplier selection when changing category
                        if (value !== "party_payment") {
                          setSelectedSupplier("");
                        }
                      }}
                    >
                      <SelectTrigger id="category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleCategories.map((category) => (
                          <SelectItem key={category.value} value={category.value}>
                            {labelFor(labels, "expense_category", category.value, category.label)}
                          </SelectItem>
                        ))}
                        {customCategories.map((name) => (
                          <SelectItem
                            key={name}
                            value={`${CUSTOM_CATEGORY_PREFIX}${name}`}
                          >
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Renaming and removing is the owner's: a typo left
                        in this list splits the shop's own reporting, and
                        fixing it is not a job for the till. */}
                    <ManageOptionsButton
                      isOwner={isOwner}
                      onClick={() => setShowManageCategories(true)}
                      label="Manage expense categories"
                    />
                  </div>
                </div>

                {/* Show supplier dropdown when party_payment is selected */}
                {newExpense.category === "party_payment" && (
                  <div>
                    <Label htmlFor="supplier">Select Supplier*</Label>
                    <Select
                      value={selectedSupplier}
                      onValueChange={setSelectedSupplier}
                      disabled={suppliersLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            suppliersLoading
                              ? "Loading suppliers..."
                              : "Select supplier"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.length === 0 ? (
                          <SelectItem value="none" disabled>
                            {suppliersLoading
                              ? "Loading..."
                              : "No suppliers found - Add suppliers in Products page"}
                          </SelectItem>
                        ) : (
                          suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {suppliers.length === 0 && !suppliersLoading && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Add suppliers in the Products → Add Product page
                      </p>
                    )}
                  </div>
                )}

                {/* What this supplier is still owed. Spans the grid
                    because it is a statement, not a field. */}
                {newExpense.category === "party_payment" && selectedSupplier && (
                  <div className="sm:col-span-2 2xl:col-span-4">
                    <SupplierDuesPanel
                      supplierId={selectedSupplier}
                      onTotalChange={(total, _count, advance) => {
                        // The gross decides the ROUTE: anything owed
                        // goes through settle_supplier_dues so it lands
                        // against the right deliveries.
                        setSupplierDues(total);

                        // The NET is what the box shows: what this
                        // supplier is still owed after the money they
                        // are already holding. Zero is a real answer
                        // and has to be shown — a supplier paid ahead
                        // needs nothing, and offering the gross is how
                        // an advance becomes a second payment.
                        const net = Math.max(0, total - (advance || 0));

                        // Once per supplier. The panel reports again as
                        // it finishes loading, and filling a second
                        // time would wipe out whatever the manager had
                        // just typed.
                        if (amountFilledFor.current !== selectedSupplier) {
                          amountFilledFor.current = selectedSupplier;
                          autoAmount.current = net;
                          setNewExpense((prev) => ({ ...prev, amount: net }));
                        }
                      }}
                    />
                    {supplierDues > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {money(supplierDues)} due. It clears the oldest
                        delivery first; anything above that is kept as an
                        advance against the next one.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Nothing due. Whatever you pay is kept as an
                        advance against the next delivery.
                      </p>
                    )}
                  </div>
                )}

                {newExpense.category === "other" && (
                  <div>
                    <Label htmlFor="custom-category">Custom Category*</Label>
                    <Input
                      id="custom-category"
                      {...addFlow.field(1)}
                      value={newExpense.customCategory}
                      onChange={(e) =>
                        setNewExpense({
                          ...newExpense,
                          customCategory: e.target.value,
                        })
                      }
                      placeholder="Enter custom category"
                      required
                    />
                  </div>
                )}

                {/* Same picker as the POS, so an expense paid through
                    BRAC's PULM reconciles against a sale taken the same
                    way. When each screen had its own idea of a payment
                    method, mobile-banking money ended up in a column no
                    report read and vanished from the books. */}
                <PaymentRoute
                  idPrefix="expense"
                  methods={payMethods}
                  reloadMethods={reloadPayMethods}
                  value={{
                    method: newExpense.payment_method || "cash",
                    bankName: newExpense.bank_name,
                    channel: newExpense.payment_channel,
                  }}
                  onChange={(route) =>
                    setNewExpense({
                      ...newExpense,
                      payment_method: route.method,
                      bank_name: route.bankName,
                      payment_channel: route.channel,
                    })
                  }
                />

                <div>
                  <Label htmlFor="amount">Amount (৳)*</Label>
                  <Input
                    id="amount"
                    {...addFlow.field(2)}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newExpense.amount || ""}
                    onChange={(e) =>
                      setNewExpense({
                        ...newExpense,
                        amount: Number(e.target.value) || 0,
                      })
                    }
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="mt-4">
                <Label htmlFor="description">
                  Description
                  {newExpense.category === "party_payment" ? "*" : " (Optional)"}
                </Label>
                <Textarea
                  id="description"
                  {...addFlow.field(3, { onEnter: () => addFlow.focusIndex(4) })}
                  value={newExpense.description}
                  onChange={(e) =>
                    setNewExpense({ ...newExpense, description: e.target.value })
                  }
                  placeholder={
                    newExpense.category === "party_payment"
                      ? "Enter payment details (optional - will auto-fill with supplier name)"
                      : "Enter expense description"
                  }
                  rows={1}
                  className="min-h-9 resize-y"
                  required={newExpense.category === "party_payment"}
                />
              </div>

              <div className="mt-4">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  {...addFlow.field(4, { onEnter: () => addExpense() })}
                  value={newExpense.notes}
                  onChange={(e) =>
                    setNewExpense({ ...newExpense, notes: e.target.value })
                  }
                  placeholder="Additional notes about this expense"
                  rows={1}
                  className="min-h-9 resize-y"
                />
              </div>

              <div className="mt-4">
                <Button onClick={addExpense}>
                  <Plus className="h-4 w-4 mr-2" />
                  {/* The button says which day the money lands on
                      whenever that is not today — the last thing read
                      before the click. */}
                  {isToday ? "Add Expense" : `Add Expense on ${dayLabel(newExpense.date)}`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Expenses had no summary card — the total sat at the foot of
            the table, so an owner had to scroll past every row to see what
            the day cost. Given the same treatment as Income. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Expense Summary
              </CardTitle>
            </CardHeader>
            {/* Compact, matching Income: one line per figure, emphasis on
              the total only. */}
            <CardContent className="space-y-2 pb-4 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Total Expenses</span>
                <span className="text-xl font-bold text-red-600">
                  ৳{totalAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Entries</span>
                <span className="font-semibold">{filteredExpenses.length}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Average</span>
                <span className="font-semibold">
                  ৳
                  {filteredExpenses.length
                    ? (totalAmount / filteredExpenses.length).toFixed(2)
                    : "0.00"}
                </span>
              </div>
            </CardContent>
          </Card>

        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Expense Search
                <ManagerAccessBadge mode="limited" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* One row: the dates, Today, Clear Dates, and Print at the
                  far end.

                  This was a three-column grid holding the date control in
                  two of them — two thirds of the card, which is not wide
                  enough for two date inputs and two buttons. "Clear Dates"
                  dropped onto a line of its own, the third column stayed
                  empty, and the buttons took a third line. Four lines for
                  what is one row of controls.

                  Search is gone rather than moved: choosing the dates
                  already runs the search (see the debounced effect above),
                  so the button only ever repeated the query that had just
                  run. */}
              <DateRangeFilter
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
                // No onApply: the effect above already runs on every
                // date change, including Today and Clear. Both would
                // mean two queries for one click.
                idPrefix="expenses"
                actions={
                  <Button
                    onClick={handlePrint}
                    variant="outline"
                    disabled={filteredExpenses.length === 0}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                }
              />

              <div className="mt-3 w-[220px]">
                <Label htmlFor="filter-expense-category">Category</Label>
                <Select value={activeCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger id="filter-expense-category">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categoryOptions.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Expenses Table */}
          <Card>
            <CardHeader>
              <CardTitle>Expense Records</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading expenses...
                </div>
              ) : filteredExpenses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No expenses found for the selected {activeCategory === "all" ? "date range" : "date range and category"}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Payment Method</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="zebra">
                        {filteredExpenses.map((expense) => (
                          <TableRow key={expense.id}>
                            <TableCell>{expense.date}</TableCell>
                            <TableCell>{categoryLabel(expense)}</TableCell>
                            <TableCell>{expense.payment_method}</TableCell>
                            <TableCell>{expense.description}</TableCell>
                            <TableCell className="text-right">
                              ৳{expense.amount.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-center">
                              {/* Managers may record expenses but not remove
                              them, so the money trail can't be rewritten
                              by staff. Enforced in the database too. */}
                              {isOwner ? (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    onClick={() => openEditExpense(expense)}
                                    variant="outline"
                                    size="sm"
                                    title="Correct this expense"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    onClick={() => deleteExpense(expense.id!)}
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700"
                                    title="Delete this expense"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="font-bold bg-gray-50">
                          <TableCell colSpan={4}>TOTAL EXPENSES</TableCell>
                          <TableCell className="text-right">
                            ৳{totalAmount.toFixed(2)}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-6 text-center">
                    <div className="inline-block border-t-2 border-black pt-4">
                      <div className="text-lg font-semibold">
                        Total Expenses ৳{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Correct an expense. Owner only — RLS refuses it for anyone
          else, so this dialog is convenience rather than the guard. */}
      <Dialog
        open={!!editExpense}
        onOpenChange={(open) => !open && setEditExpense(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Correct expense</DialogTitle>
            <DialogDescription>
              The payment route is not editable here — that would move money
              between bank lines on reports already printed. Delete and re-enter
              if the route itself was wrong.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ee-date">Date</Label>
              <Input
                id="ee-date"
                type="date"
                value={editForm.date}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, date: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ee-amount">Amount*</Label>
              <Input
                id="ee-amount"
                type="number"
                step="0.01"
                value={editForm.amount}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ee-category">Category</Label>
              {/* Same list as the add form. Offering fewer choices
                  here would mean an expense could be filed under a
                  category that could then never be corrected to. */}
              <Select
                value={
                  editForm.category === "other" &&
                  customCategories.includes(editForm.custom_category.trim())
                    ? `${CUSTOM_CATEGORY_PREFIX}${editForm.custom_category.trim()}`
                    : editForm.category
                }
                onValueChange={(v) =>
                  setEditForm((f) =>
                    v.startsWith(CUSTOM_CATEGORY_PREFIX)
                      ? {
                          ...f,
                          category: "other",
                          custom_category: v.slice(CUSTOM_CATEGORY_PREFIX.length),
                        }
                      : {
                          ...f,
                          category: v,
                          custom_category: v === "other" ? f.custom_category : "",
                        },
                  )
                }
              >
                <SelectTrigger id="ee-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {visibleCategories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {labelFor(labels, "expense_category", c.value, c.label)}
                    </SelectItem>
                  ))}
                  {customCategories.map((name) => (
                    <SelectItem key={name} value={`${CUSTOM_CATEGORY_PREFIX}${name}`}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editForm.category === "other" && (
              <div className="sm:col-span-2">
                <Label htmlFor="ee-custom">Custom category</Label>
                <Input
                  id="ee-custom"
                  value={editForm.custom_category}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      custom_category: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="ee-desc">Description*</Label>
              <Input
                id="ee-desc"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ee-notes">Notes</Label>
              <Textarea
                id="ee-notes"
                className="h-20"
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditExpense(null)}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button onClick={saveExpenseEdit} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OptionManager
        open={showManageCategories}
        onOpenChange={setShowManageCategories}
        shopId={currentShopId}
        kind="expense_category"
        title="Expense categories"
        noun="expense category"
        builtIns={BUILT_IN_EXPENSE_CATEGORIES}
        hidden={hidden}
        labels={labels}
        onChanged={async () => {
          await Promise.all([loadCustomCategories(), reloadLabels()]);
          // A category just renamed or removed may still be sitting in
          // the add form, where it would file the next expense under
          // wording the shop has retired.
          setNewExpense((prev) =>
            prev.category === "other" ? { ...prev, customCategory: "" } : prev,
          );
          await searchExpenses();
        }}
      />
    </div>
  );
}
