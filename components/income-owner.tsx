"use client";

import { useRef, useState, useEffect } from "react";
import { AlertTriangle, Calendar, Plus, Printer, Trash2, TrendingUp, Pencil } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/component";
import { describeDbError, wasSilentlyBlocked } from "@/lib/utils/db-error";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/components/role-provider";
import { clearDrafts, useDraft } from "@/hooks/use-draft";
import {
  MANAGER_BACKDATE_DAYS,
  managerEarliestDay,
  shopToday,
  withinManagerWindow,
} from "@/lib/shop-date";
import {
  PaymentRoute,
  usePaymentMethods,
  EMPTY_ROUTE,
  type PaymentRouteValue,
} from "@/components/payment-route";
import { useSubscription } from "@/components/subscription-provider";
import { DateRangeFilter } from "@/components/date-range-filter";
import { shopHeader } from "@/lib/utils/shop-header";
import { ManagerAccessBadge } from "@/components/role-badge";
import { useFieldFlow, useHotkeys } from "@/hooks/use-keyboard-flow";
import { DOCUMENT_TOOLBAR_CSS, documentToolbar } from "@/lib/receipt";
import {
  BUILT_IN_INCOME_TYPES,
  CUSTOM_PREFIX,
  INCOME_SUBTYPE_KIND,
  OWNER_INVEST_TO_KIND,
  subtypeFieldFor,
  type SubtypeKind,
  incomeTypeLabel,
  isMissingCustomType,
  isMissingIncomeSubtype,
  packIncomeType,
  unpackIncomeType,
} from "@/lib/income-type";
import { ManageOptionsButton, OptionManager } from "@/components/option-manager";
import { PromoDuesPanel } from "@/components/promo-dues-panel";
import { money } from "@/lib/purchase-voucher";
import { useShopLabels } from "@/hooks/use-shop-labels";
import { isOptionHidden, labelFor } from "@/lib/shop-labels";

const supabase = createClient();

type IncomeEntry = {
  id?: string;
  date: string;
  income_type: string;
  /** The shop's own wording, when income_type is 'other'. */
  custom_type?: string | null;
  /** What a supplier payment was for — only on 'party_income'. */
  income_subtype?: string | null;
  amount: number;
  destination_type: "cash" | "bank";
  description?: string;
  notes?: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Supplier = {
  id: string;
  name: string;
};

// The two the application branches on. Anything else the shop names
// for itself is loaded from product_options — see customTypes below.
// The WORDING of these two is the shop's to change (script 82); the
// values are not, because the supplier field keys off 'party_income'.
const BUILT_INS = BUILT_IN_INCOME_TYPES.map((t) => ({
  value: t.value,
  defaultLabel: t.label,
}));

// Destination types
const destinationTypes = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
];

/**
 * A yyyy-mm-dd day as the shop says it: 22/09/2026. Built from the
 * parts, since Date would read the string as UTC midnight and print
 * the day before in Dhaka.
 */
function dayLabel(day: string) {
  const [y, m, d] = (day || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : day;
}

export function IncomeOwnerClient() {
  const { currentShopId, accountType, shops } = useRole();
  const { canWrite } = useSubscription();
  // Reports print the shop's own letterhead, not a hard-coded one.
  const header = shopHeader(shops.find((s) => s.id === currentShopId));
  const isOwner = accountType === "owner";
  // What this shop calls the two built-in kinds. Empty for a shop that
  // has renamed nothing, and every label falls back to ours.
  const { labels, hidden, reload: reloadLabels } = useShopLabels();
  const [incomes, setIncomes] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterIncomeType, setFilterIncomeType] = useState("all");
  const [filterDestination, setFilterDestination] = useState("all");
  const [filterSupplier, setFilterSupplier] = useState("all");

  // ✅ NEW: Suppliers state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const { rows: payMethods, reload: reloadPayMethods } = usePaymentMethods();
  // Drafted like the rest of the form. It used to be plain state, so
  // leaving the page reset the picker to Cash while newIncome kept
  // bank_name and destination_type — the screen said Cash and the row
  // saved as bank.
  const [incomeRoute, setIncomeRoute] = useDraft<PaymentRouteValue>(
    "inc.route",
    EMPTY_ROUTE,
    currentShopId,
  );

  // Add income form
  // Kept if the manager steps away mid-entry. See hooks/use-draft.ts.
  const [newIncome, setNewIncome] = useDraft("inc.new", {
    date: shopToday(),
    income_type: "",
    amount: 0,
    destination_type: "" as "cash" | "bank" | "",
    bank_name: "",
    payment_channel: "",
    description: "",
    notes: "",
    supplier_id: "", // ✅ NEW: Added supplier_id
    // What a supplier payment was for — BM, Incentive, Demo Adjust.
    // Empty for every other kind of income. See script 86.
    income_subtype: "",
  },
    currentShopId,
    undefined,
    // The date does not come back with the rest. A draft is rewritten
    // every time the form is touched, so on a screen in daily use it
    // never ages out, and a date typed once keeps filing later entries
    // under that day. See hooks/use-draft.ts.
    (saved) => ({ ...saved, date: shopToday() }),
  );

  const isToday = newIncome.date === shopToday();

  // ---- Promo dues for the chosen supplier (PromoDuesPanel)
  const [promoDue, setPromoDue] = useState(0);
  /** The supplier the amount was last filled in for, so it fills once. */
  const promoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!newIncome.supplier_id) promoFilledFor.current = null;
  }, [newIncome.supplier_id]);

  // ---- The shop's own kinds of income
  //
  // Written once and offered from then on, the same way brands and
  // models are. Kept in product_options, so there is nothing extra to
  // maintain and the list is already per-shop and behind RLS.
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [showManageTypes, setShowManageTypes] = useState(false);

  // ---- What a supplier payment was for
  //
  // The second level of the tree, and the same machinery as the list
  // above: product_options under its own kind, seeded with BM,
  // Incentive and Demo Adjust but owned by the shop from then on.
  //
  // Owner Invest has the same second box, called "To" — where the
  // owner's money went. Its own list, same column; subtypeFieldFor
  // decides which one a given income type uses.
  const [subtypeLists, setSubtypeLists] = useState<Record<SubtypeKind, string[]>>({
    [INCOME_SUBTYPE_KIND]: [],
    [OWNER_INVEST_TO_KIND]: [],
  });
  // Which list the add / manage dialogs are working on.
  const [subtypeDialogKind, setSubtypeDialogKind] = useState<SubtypeKind>(INCOME_SUBTYPE_KIND);
  const [showAddSubtype, setShowAddSubtype] = useState(false);
  const [newSubtypeName, setNewSubtypeName] = useState("");
  const [addingSubtype, setAddingSubtype] = useState(false);
  const [showManageSubtypes, setShowManageSubtypes] = useState(false);

  const loadCustomTypes = async () => {
    if (!currentShopId) return;
    const { data, error } = await supabase
      .from("product_options")
      .select("value")
      .eq("organization_id", currentShopId)
      .eq("kind", "income_type")
      .order("value");

    if (error) {
      // A missing list costs the shop its own wording; it must not
      // stop income being recorded at all.
      console.warn("Could not load income types:", error.message);
      return;
    }
    setCustomTypes((data ?? []).map((r: any) => r.value));
  };

  const addCustomType = async () => {
    const name = newTypeName.trim();
    if (!name || !currentShopId) return;

    setAddingType(true);
    try {
      const { error } = await supabase
        .from("product_options")
        .insert({ organization_id: currentShopId, kind: "income_type", value: name });

      // Someone else adding the same wording first is a success from
      // the user's point of view, not an error.
      if (error && error.code !== "23505") {
        // 23514 is the kind CHECK: script 67 has not been run on this
        // database yet, and a constraint name is no use to a shopkeeper.
        toast.error("Could not save that type", {
          description:
            error.code === "23514"
              ? "This shop's database has not been updated for custom income types yet. Ask your administrator to run script 67."
              : error.message,
        });
        return;
      }

      await loadCustomTypes();
      setNewIncome((prev) => ({
        ...prev,
        income_type: packIncomeType("other", name),
        supplier_id: "",
      }));
      setShowAddType(false);
      setNewTypeName("");
      toast.success(`"${name}" added`);
    } finally {
      setAddingType(false);
    }
  };

  const loadSubtypes = async () => {
    if (!currentShopId) return;
    const { data, error } = await supabase
      .from("product_options")
      .select("kind, value")
      .eq("organization_id", currentShopId)
      .in("kind", [INCOME_SUBTYPE_KIND, OWNER_INVEST_TO_KIND])
      .order("value");

    if (error) {
      // Scripts 86 / 91 may not have been run here yet. The rest of the
      // form still works; the income just cannot be broken down.
      console.warn("Could not load income sub-types:", error.message);
      return;
    }
    const rows = (data ?? []) as { kind: SubtypeKind; value: string }[];
    setSubtypeLists({
      [INCOME_SUBTYPE_KIND]: rows.filter((r) => r.kind === INCOME_SUBTYPE_KIND).map((r) => r.value),
      [OWNER_INVEST_TO_KIND]: rows.filter((r) => r.kind === OWNER_INVEST_TO_KIND).map((r) => r.value),
    });
  };

  const addSubtype = async () => {
    const name = newSubtypeName.trim();
    if (!name || !currentShopId) return;

    setAddingSubtype(true);
    try {
      const { error } = await supabase
        .from("product_options")
        .insert({ organization_id: currentShopId, kind: subtypeDialogKind, value: name });

      if (error && error.code !== "23505") {
        toast.error("Could not save that", {
          description:
            error.code === "23514"
              ? `This shop's database has not been updated for this list yet. Ask your administrator to run script ${
                  subtypeDialogKind === OWNER_INVEST_TO_KIND ? "91" : "86"
                }.`
              : error.message,
        });
        return;
      }

      await loadSubtypes();
      setNewIncome((prev) => ({ ...prev, income_subtype: name }));
      setShowAddSubtype(false);
      setNewSubtypeName("");
      toast.success(`"${name}" added`);
    } finally {
      setAddingSubtype(false);
    }
  };

  /** Every choice the dropdown offers, built-ins first. */
  const allIncomeTypes = [
    // A built-in the shop has taken off its list is hidden, not
    // deleted: income_type is a CHECK the application branches on, and
    // records already filed under it still name themselves.
    ...BUILT_INS.filter(
      (t) => !isOptionHidden(hidden, "income_type", t.value),
    ).map((t) => ({
      value: t.value,
      label: labelFor(labels, "income_type", t.value, t.defaultLabel),
    })),
    ...customTypes.map((t) => ({ value: packIncomeType("other", t), label: t })),
  ];

  // ✅ NEW: Load suppliers from database
  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        // Removed by the owner (script 92): kept for history, not offered.
        .is("deleted_at", null)
        .eq("organization_id", currentShopId)
        .order("name", { ascending: true });

      if (error) throw error;
      setSuppliers((data as Supplier[]) || []);
    } catch (err: any) {
      console.error("Failed to load suppliers:", err);
    }
  };

  // Load suppliers on component mount
  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return;

    loadSuppliers();
    loadCustomTypes();
    loadSubtypes();
  }, [currentShopId]);

  // Open on today. Setting the dates is enough — the effect below
  // notices and runs the search, so there is no second query here.
  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return;

    const today = new Date().toISOString().split("T")[0];
    setStartDate(today);
    setEndDate(today);
  }, [currentShopId]);

  /**
   * Choosing the dates IS the search.
   *
   * The three dropdowns already filtered the loaded rows as they were
   * changed; only the date range needed a query, and it sat behind a
   * button. So the shop picked a date, saw the old results, and had no
   * way of knowing they were looking at yesterday.
   *
   * Debounced, because a date input fires on EVERY keystroke: typing
   * 09/01/2026 goes through 09/01/0002 and 09/01/0202 on the way, and
   * without the wait each of those is a query whose answer could land
   * after the real one and overwrite it.
   */
  useEffect(() => {
    if (!currentShopId) return;

    // A date input reports "" until the WHOLE date is valid, so a
    // blank From in the middle of typing is not a request for
    // everything — it is half a date. Clearing BOTH is deliberate,
    // and that is the one that means "all dates", as the optional
    // labels on those fields promise.
    const cleared = !startDate && !endDate;
    if (!startDate && !cleared) return;

    const timer = setTimeout(() => {
      if (cleared) {
        const todayIso = new Date().toISOString().split("T")[0];
        searchIncomes("2000-01-01", todayIso);
      } else {
        // Unchanged for every other case: a blank To still means the
        // From date alone, exactly as the Search button always did.
        searchIncomes(startDate, endDate);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [startDate, endDate, currentShopId]);

  /**
   * The description this form wrote itself, from the chosen supplier.
   *
   * Remembered so that changing the income type can take it away again.
   * A supplier's name left behind under Owner Invest is not a
   * description anyone gave — it is the previous choice leaking into
   * the next one. Anything the manager typed is theirs and is kept.
   */
  const autoDescription = useRef<string | null>(null);

  // ✅ UPDATED: Auto-fill description when supplier is selected for Supplier Income
  useEffect(() => {
    if (newIncome.income_type === "party_income" && newIncome.supplier_id) {
      const supplier = suppliers.find((s) => s.id === newIncome.supplier_id);
      if (supplier) {
        autoDescription.current = supplier.name;
        setNewIncome((prev) => ({
          ...prev,
          description: `${supplier.name}`,
        }));
      }
    }
  }, [newIncome.supplier_id, newIncome.income_type, suppliers]);

  const searchIncomes = async (start?: string, end?: string) => {
    const searchStart = start || startDate;
    const searchEnd = end || endDate;

    if (!searchStart) {
      setError("Please select a start date");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData?.user) {
        throw new Error("Please sign in to view income records");
      }

      console.log("Searching income records for user:", userData.user.id);

      // ✅ UPDATED: Join with suppliers table to get supplier name
      let query = supabase
        .from("income_owner")
        .select(
          `
          *,
          suppliers (
            id,
            name
          )
        `,
        )
        .eq("organization_id", currentShopId)
        .gte("date", searchStart)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (searchEnd && searchEnd !== searchStart) {
        query = query.lte("date", searchEnd);
      } else {
        query = query.lte("date", searchStart);
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        console.error("Database query error:", queryError);
        throw new Error(`Database error: ${queryError.message}`);
      }

      // ✅ UPDATED: Map data to include supplier name
      const mappedData = (data || []).map((item: any) => ({
        ...item,
        supplier_name: item.suppliers?.name || null,
      }));

      console.log(`Found ${mappedData.length} income records`);
      setIncomes(mappedData);
    } catch (err: any) {
      const errorMessage = err?.message || "Error loading income records";
      console.error("Error loading income records:", err);
      setError(errorMessage);
      setIncomes([]);
    } finally {
      setLoading(false);
    }
  };

  const addIncome = async () => {
    // A manager records today only; the owner may pick any day (script
    // 93 enforces it). Not trusted from the form, which is kept as a
    // draft and could still hold a day that has passed.
    // A manager records today or the three days before it; the owner
    // may pick any day. Script 95 enforces the same window; this only
    // says no earlier, and in plain words.
    if (!isOwner && !withinManagerWindow(newIncome.date)) {
      toast.error(
        `Managers can record today or the last ${MANAGER_BACKDATE_DAYS} days. For an older date, ask the owner.`,
      );
      return;
    }
    const entryDate = isOwner ? newIncome.date : newIncome.date || shopToday();
    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData?.user) {
        toast.error("Authentication error. Please sign in.");
        return;
      }

      console.log("Adding income for authenticated user");

      // Validation
      if (!newIncome.income_type) {
        toast.error("Please select an income type");
        return;
      }

      // Otherwise the deposit lands under"Not specified" in Bank Info
      // and cannot be reconciled against a statement.
      if (incomeRoute.method === "bank_transfer" && !incomeRoute.bankName) {
        toast.error("Please select which bank account this went into");
        return;
      }

      if (incomeRoute.method !== "cash" && !incomeRoute.channel) {
        toast.error("Please select how the money came in");
        return;
      }

      if (newIncome.amount <= 0) {
        toast.error("Please enter a valid amount greater than 0");
        return;
      }

      // ✅ NEW: Validate supplier for Supplier Income
      if (newIncome.income_type === "party_income" && !newIncome.supplier_id) {
        toast.error("Please select a supplier for Supplier Income");
        return;
      }

      // Asked for here rather than enforced by the database: rows
      // recorded before script 86 have none, and the point of the field
      // is that new ones do.
      const subField = subtypeFieldFor(newIncome.income_type);
      if (
        subField &&
        // Only once the list has something in it. Until a shop has run
        // script 91 the To list is empty and cannot be added to, and a
        // required box with nothing to choose would stop Owner Invest
        // being recorded at all.
        subtypeLists[subField.kind].length > 0 &&
        // ?? because useDraft restores a saved draft as it was stored,
        // without merging in fields added since — one written before
        // today comes back with no income_subtype at all.
        !(newIncome.income_subtype ?? "").trim()
      ) {
        toast.error(`Choose "${subField.label}"`, {
          description: `Pick one from the list, or add your own with +.`,
        });
        return;
      }

      // Build income object
      // The dropdown carries one string; 'other' plus the shop's own
      // wording is two facts. Split them here, at the only point that
      // writes to the table.
      const chosenType = unpackIncomeType(newIncome.income_type);

      // Derived from the picker rather than held beside it. It used to
      // be set only in the picker's onChange, so leaving it on its
      // default — Cash, which is what the form shows — meant it was
      // never set at all and every entry was refused with "Please
      // select a destination". Anything that is not cash landed in an
      // account, so it is stored as "bank" whichever route brought it.
      const destination: "cash" | "bank" =
        incomeRoute.method === "cash" ? "cash" : "bank";

      const incomeToAdd: any = {
        date: entryDate,
        income_type: chosenType.income_type,
        custom_type: chosenType.custom_type,
        amount: newIncome.amount,
        destination_type: destination,
        // Null for cash: it stays in the drawer, not an account.
        bank_name: destination === "bank" ? incomeRoute.bankName || null : null,
        payment_channel:
          destination === "bank" ? incomeRoute.channel || null : null,
        description: newIncome.description.trim() || null,
        notes: newIncome.notes.trim() || null,
        supplier_id:
          newIncome.income_type === "party_income"
            ? newIncome.supplier_id
            : null, // ✅ NEW: Save supplier_id
        income_subtype: subtypeFieldFor(newIncome.income_type)
          ? (newIncome.income_subtype ?? "").trim() || null
          : null,
        organization_id: currentShopId,
      };

      // ----------------------------------------------------------
      // A promo the supplier is paying back
      //
      // The claim lives on the promos, not on this row, so a plain
      // insert would take the money in and leave every promo still
      // showing as owed. settle_supplier_promo writes this same
      // income row AND closes the claims it pays, oldest first, in
      // one transaction — the way a supplier payment goes through
      // settle_supplier_dues on the Expenses page.
      //
      // Only when the shop has promos outstanding with this supplier.
      // A database without script 99, or a supplier with nothing to
      // claim, falls through to the ordinary insert below and the
      // income is recorded exactly as it always was.
      // ----------------------------------------------------------
      if (
        chosenType.income_type === "party_income" &&
        (newIncome.income_subtype ?? "").trim().toLowerCase() === "promo" &&
        newIncome.supplier_id
      ) {
        const { data: settled, error: settleError } = await supabase.rpc(
          "settle_supplier_promo",
          {
            p_organization_id: currentShopId,
            p_client_txn_id: crypto.randomUUID(),
            p_supplier_id: newIncome.supplier_id,
            p_amount: newIncome.amount,
            p_payment: {
              date: entryDate,
              destination_type: destination,
              description: newIncome.description.trim() || null,
              notes: newIncome.notes.trim() || null,
            },
          },
        );

        // PGRST202 is "no such function": the shop has not run script
        // 99. Nothing was written, so the ordinary insert below still
        // records the money — without closing any claim, which is
        // exactly what happened before promos existed.
        if (!settleError || settleError.code !== "PGRST202") {
          if (settleError) {
            toast.error(`Could not record the promo receipt: ${settleError.message}`);
            return;
          }

          const result = settled as {
            success: boolean;
            message?: string;
            applied?: number;
            remaining?: number;
          } | null;

          if (!result?.success) {
            toast.error(result?.message ?? "The receipt was not recorded.");
            return;
          }

          const left = Number(result.remaining ?? 0);
          toast.success(
            left > 0
              ? `Promo receipt recorded. ৳${left.toFixed(2)} still to claim from this supplier.`
              : "Promo receipt recorded. This supplier's promos are fully claimed.",
          );

          setNewIncome({
            date: shopToday(),
            income_type: "",
            amount: 0,
            destination_type: "" as "cash" | "bank",
            bank_name: "",
            payment_channel: "",
            description: "",
            notes: "",
            supplier_id: "",
            income_subtype: "",
          });
          clearDrafts(currentShopId, ["inc.new"]);
          await searchIncomes();
          return;
        }
      }

      console.log("Inserting income:", incomeToAdd);

      const insert = (row: any) =>
        supabase
          .from("income_owner")
          .insert(row)
          .select(
            `
          *,
          suppliers (
            id,
            name
          )
        `,
          )
          .single();

      let { data, error } = await insert(incomeToAdd);

      // custom_type arrives with script 67. On a database that has not
      // had it yet, one of the two built-in types still saves perfectly
      // well without it — so drop the column and go again rather than
      // refusing an ordinary owner income.
      if (error && isMissingCustomType(error)) {
        if (chosenType.income_type === "other") {
          toast.error("Could not save this income type", {
            description:
              "This shop's database has not been updated for custom income types yet. Choose Owner or Supplier Income, or ask your administrator to run script 67.",
          });
          return;
        }
        const { custom_type: _drop, ...withoutCustom } = incomeToAdd;
        ({ data, error } = await insert(withoutCustom));
      }

      // income_subtype arrives with script 86. Same reasoning: the
      // income itself is still worth recording, so save it without the
      // breakdown and say plainly that the breakdown was not kept.
      if (error && isMissingIncomeSubtype(error)) {
        const { income_subtype: _dropSub, ...withoutSubtype } = incomeToAdd;
        ({ data, error } = await insert(withoutSubtype));
        if (!error && incomeToAdd.income_subtype) {
          toast.warning("Saved without the breakdown", {
            description:
              "This shop's database has not been updated for supplier payment types yet. Ask your administrator to run script 86.",
          });
        }
      }

      if (error) {
        console.error(
          "Insert error details:",
          error?.message ?? error,
          error?.code ? `(${error.code})` : "",
        );
        // Script 95 refuses a manager's entry outside today and the
        // three days before it. The form checks the same window, so
        // this means the device's clock disagrees with the shop's date.
        if (error.message?.includes("row-level security") && !isOwner) {
          toast.error(
            `Managers can record today or the last ${MANAGER_BACKDATE_DAYS} days. If this date is inside that, check that this device's date and time are correct.`,
          );
        } else {
          toast.error(`Failed to add income: ${error.message}`);
        }
        return;
      }

      if (!data) {
        toast.error("Failed to add income: No data returned");
        return;
      }

      // ✅ UPDATED: Map data to include supplier name
      const mappedIncome = {
        ...data,
        supplier_name: data.suppliers?.name || null,
      };

      // Add to local state
      setIncomes([mappedIncome, ...incomes]);

      // Reset form
      setNewIncome({
        // Back to today, never the day just used: an owner filing one
        // old entry must not leave the next one pointing at it.
        date: shopToday(),
        income_type: "",
        amount: 0,
        destination_type: "" as "cash" | "bank" | "",
        bank_name: "",
        payment_channel: "",
        description: "",
        notes: "",
        supplier_id: "", // ✅ NEW: Reset supplier
        income_subtype: "",
      });
      // Back to Cash, which is what the picker shows on a fresh form.
      setIncomeRoute(EMPTY_ROUTE);
      // The stored copies too, or the entry reappears on the next visit
      // to this page.
      clearDrafts(currentShopId, ["inc.new", "inc.route"]);

      console.log("Income added successfully:", data);
      toast.success("Income added successfully!");
    } catch (err: any) {
      console.error("Unexpected error adding income:", err);
      toast.error(`Error adding income: ${err?.message || "Unknown error"}`);
    }
  };

  // ---- Keyboard-first entry
  //
  // Income is recorded in the same rush as everything else, so the form
  // runs off the keyboard alone. Enter walks the fields top to bottom
  // and saves from the last one. F2 opens the form, Esc closes it, F3
  // jumps back to the date search.
  //
  // The income-type / supplier / destination dropdowns stay out of the
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
          "income-start",
        ) as HTMLInputElement | null;
        el?.focus();
        el?.select?.();
      },
    },
    { allowInInputs: ["f2", "f3"] },
  );

  // ---- Owner: correcting an income record
  //
  // A plain UPDATE: income carries no stock or balance consequences,
  // and RLS already restricts UPDATE on this table to the owner.
  // `.select()` afterwards distinguishes a real save from one the
  // database silently refused — a row blocked by RLS matches nothing
  // and returns no error, which would otherwise report success.
  const [editIncome, setEditIncome] = useState<IncomeEntry | null>(null);
  const [editForm, setEditForm] = useState({
    date: "",
    income_type: "owner_income",
    income_subtype: "",
    amount: "",
    description: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditIncome = (i: IncomeEntry) => {
    setEditIncome(i);
    setEditForm({
      date: i.date ?? "",
      income_type: packIncomeType(i.income_type ?? "owner_income", i.custom_type),
      income_subtype: i.income_subtype ?? "",
      amount: i.amount != null ? String(i.amount) : "",
      description: i.description ?? "",
      notes: i.notes ?? "",
    });
  };

  const saveIncomeEdit = async () => {
    if (!editIncome?.id || !currentShopId) return;

    const amount = Number(editForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }

    const editedType = unpackIncomeType(editForm.income_type);

    setSavingEdit(true);
    try {
      const patch: any = {
        date: editForm.date,
        income_type: editedType.income_type,
        custom_type: editedType.custom_type,
        // Cleared unless this is still supplier income, so changing the
        // type on an existing row cannot leave an orphaned breakdown
        // behind — which the CHECK in script 86 would refuse anyway.
        income_subtype: subtypeFieldFor(editedType.income_type)
          ? editForm.income_subtype.trim() || null
          : null,
        amount,
        description: editForm.description.trim() || null,
        notes: editForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const update = (row: any) =>
        supabase
          .from("income_owner")
          .update(row)
          .eq("id", editIncome.id)
          .eq("organization_id", currentShopId)
          .select("id");

      let { data, error } = await update(patch);

      // Same as the insert: on a database without script 67, a
      // built-in type still saves without the column.
      if (error && isMissingCustomType(error)) {
        if (editedType.income_type === "other") {
          toast.error("Could not save this income type", {
            description:
              "This shop's database has not been updated for custom income types yet. Ask your administrator to run script 67.",
          });
          return;
        }
        const { custom_type: _drop, ...withoutCustom } = patch;
        ({ data, error } = await update(withoutCustom));
      }

      // And the same for script 86.
      if (error && isMissingIncomeSubtype(error)) {
        const { income_subtype: _dropSub, ...withoutSubtype } = patch;
        ({ data, error } = await update(withoutSubtype));
      }

      if (error) {
        const failure = describeDbError(error, {
          subscriptionActive: canWrite,
        });
        toast.error(failure.title, { description: failure.message });
        return;
      }

      if (wasSilentlyBlocked(data)) {
        toast.error("Not allowed", {
          description: "Only the shop owner can change income records.",
        });
        return;
      }

      setIncomes((prev) =>
        prev.map((i) =>
          i.id === editIncome.id
            ? {
                ...i,
                date: editForm.date,
                income_type: editedType.income_type,
                custom_type: editedType.custom_type,
                amount,
                description: editForm.description.trim() || undefined,
                notes: editForm.notes.trim() || undefined,
              }
            : i,
        ),
      );
      setEditIncome(null);
      toast.success("Income updated");
    } catch (err: any) {
      toast.error("Error updating income", { description: err?.message });
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteIncome = async (id: string) => {
    if (!confirm("Are you sure you want to delete this income record?")) return;

    try {
      // .select() so a row-level-security refusal (which returns no
      // error, just zero matched rows) isn't reported as a success.
      const { data, error } = await supabase
        .from("income_owner")
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
          description: "Only the shop owner can delete income records.",
        });
        return;
      }

      setIncomes(incomes.filter((i) => i.id !== id));
      toast.success("Income record deleted successfully!");
    } catch (err: any) {
      console.error("Error deleting income:", err);
      toast.error("Error deleting income record");
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

    const totalAmount = filteredIncomes.reduce(
      (sum, income) => sum + (income.amount || 0),
      0,
    );

    const dateRange =
      startDate === endDate
        ? formatDate(startDate)
        : `${formatDate(startDate)} --- ${formatDate(endDate)}`;

    const getIncomeTypeLabel = (
      type: string | null | undefined,
      customType?: string | null,
      subtype?: string | null,
    ) => incomeTypeLabel(type, customType, labels, subtype);

    const getDestinationLabel = (income: IncomeEntry) => {
      return income.destination_type === "bank" ? "Bank" : "Cash";
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Income Report</title>
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
          .income-table { 
            width: 100%; 
            border-collapse: collapse; 
            border: 2px solid black; 
            margin-bottom: 30px; 
          }
          .income-table th, .income-table td { 
            border: 1px solid black; 
            padding: 8px; 
            text-align: left; 
          }
          .income-table th { 
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
        ${documentToolbar("Income Report")}
        <div class="header">
          <div class="company-name">${header.name}</div>
          <div class="address">${header.addressLine}</div>
          <div class="period">PERIOD : ${dateRange}</div>
          <div class="title-oval">INCOME REPORT</div>
        </div>

        <table class="income-table">
          <thead>
            <tr>
              <th style="width: 12%;">Date</th>
              <th style="width: 15%;">Income Type</th>
              <th style="width: 18%;">Supplier</th>
              <th style="width: 15%;">Destination</th>
              <th style="width: 25%;">Description</th>
              <th style="width: 15%;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${filteredIncomes
              .map(
                (income) => `
              <tr>
                <td>${formatDate(income.date)}</td>
                <td>${getIncomeTypeLabel(income.income_type, income.custom_type, income.income_subtype)}</td>
                <td>${income.supplier_name || "—"}</td>
                <td>${getDestinationLabel(income)}</td>
                <td>${income.description || "—"}</td>
                <td class="amount-cell">৳${income.amount.toFixed(2)}</td>
              </tr>
            `,
              )
              .join("")}
            <tr class="total-row">
              <td colspan="5" style="text-align: right; font-weight: bold;">TOTAL INCOME:</td>
              <td class="amount-cell">৳${totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="total-amount">
          <div class="total-title">Total Income ৳${totalAmount.toFixed(2)}</div>
        </div>

      </body>
      </html>
    `;
  };

  // The three filters, any of which can be left out. Leaving one out is
  // how each box offers only what the OTHER two still leave: choose
  // Owner Invest and the Supplier list empties, because owner money
  // has no supplier.
  const incomePasses = (
    income: IncomeEntry,
    skip?: "type" | "destination" | "supplier",
  ) =>
    (skip === "type" ||
      filterIncomeType === "all" ||
      packIncomeType(income.income_type, income.custom_type) === filterIncomeType) &&
    (skip === "destination" ||
      filterDestination === "all" ||
      income.destination_type === filterDestination) &&
    (skip === "supplier" ||
      filterSupplier === "all" ||
      income.supplier_id === filterSupplier);

  const filteredIncomes = incomes.filter((income) => incomePasses(income));

  const reachableTypes = new Set(
    incomes
      .filter((i) => incomePasses(i, "type"))
      .map((i) => packIncomeType(i.income_type, i.custom_type)),
  );
  const reachableSuppliers = new Set(
    incomes.filter((i) => incomePasses(i, "supplier")).map((i) => i.supplier_id),
  );
  const reachableDestinations = new Set(
    incomes.filter((i) => incomePasses(i, "destination")).map((i) => i.destination_type),
  );

  const totalAmount = filteredIncomes.reduce(
    (sum, income) => sum + (income.amount || 0),
    0,
  );

  const getIncomeTypeBadge = (
    type: string,
    customType?: string | null,
    subtype?: string | null,
  ) => {
    // Every case goes through incomeTypeLabel. The two built-ins used to
    // print "Owner Income" and "Supplier Income" literally, so a shop
    // that had renamed them — both of these have — saw its own wording
    // everywhere except the one column it reads most.
    const text = incomeTypeLabel(type, customType, labels, subtype);
    // The shop's own kinds get their own colour, so they are not
    // mistaken for one of the two built-in ones at a glance.
    const tone =
      type === "owner_income"
        ? "bg-blue-100 text-blue-800"
        : type === "party_income"
          ? "bg-purple-100 text-purple-800"
          : "bg-amber-100 text-amber-800";
    return <Badge className={tone}>{text}</Badge>;
  };

  const getDestinationBadge = (destination: string) => {
    return destination === "cash" ? (
      <Badge className="bg-green-100 text-green-800">Cash</Badge>
    ) : (
      <Badge className="bg-orange-100 text-orange-800">Bank</Badge>
    );
  };

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
          records stacked under it. Recording a few incomes meant clicking
          Show Form every time, and on the shop's screen the whole thing
          sat in the middle third with the records below the fold.

          Recording income is what this page is for, so the form is always
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
                Add Income
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                <div>
                  <Label htmlFor="income-date">Date*</Label>
                  <Input
                    id="income-date"
                    {...addFlow.field(0)}
                    type="date"
                    value={newIncome.date}
                    // Three days back at most, never forward; the
                    // picker greys out the rest. Script 95 enforces
                    // the same window.
                    min={isOwner ? undefined : managerEarliestDay()}
                    max={isOwner ? undefined : shopToday()}
                    onChange={(e) =>
                      setNewIncome({ ...newIncome, date: e.target.value })
                    }
                    required
                  />
                  {!isOwner && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Today or the last {MANAGER_BACKDATE_DAYS} days. For an older date, ask the
                      owner.
                    </p>
                  )}
                  {!isOwner && !isToday && withinManagerWindow(newIncome.date) && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Not today. This goes in the books on {dayLabel(newIncome.date)}.</span>
                    </p>
                  )}
                  {isOwner && !isToday && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Not today. This goes in the books on {dayLabel(newIncome.date)}, not{" "}
                        {dayLabel(shopToday())}.
                      </span>
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="income-type">Income Type*</Label>
                  <div className="flex gap-2">
                    <Select
                      value={newIncome.income_type}
                      onValueChange={(value) => {
                        if (value === newIncome.income_type) return;
                        // A description is the supplier's name when this
                        // form put it there — remembered, or matching the
                        // supplier still selected, which also covers a
                        // draft restored after leaving the page.
                        const supplierName = suppliers.find(
                          (s) => s.id === newIncome.supplier_id,
                        )?.name;
                        const typed = (newIncome.description ?? "").trim();
                        const wasAutoFilled =
                          typed !== "" &&
                          (typed === autoDescription.current || typed === supplierName);
                        autoDescription.current = null;
                        setNewIncome({
                          ...newIncome,
                          income_type: value,
                          supplier_id: "",
                          // Only supplier income has one, and leaving a
                          // stale value behind would save a sub-type
                          // against an owner investment.
                          income_subtype: "",
                          description: wasAutoFilled ? "" : newIncome.description,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select income type" />
                      </SelectTrigger>
                      <SelectContent>
                        {allIncomeTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* Write a new kind of income once; it is offered
                        from then on. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Add a new income type"
                      onClick={() => setShowAddType(true)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    {/* Renaming and removing is the owner's: a typo left
                        in this list splits the shop's own reporting, and
                        fixing it is not a job for the till. */}
                    <ManageOptionsButton
                      isOwner={isOwner}
                      onClick={() => setShowManageTypes(true)}
                      label="Manage income types"
                    />
                  </div>
                </div>

                {/* ✅ NEW: Supplier dropdown - only show for Supplier Income */}
                {newIncome.income_type === "party_income" && (
                  <div>
                    <Label htmlFor="supplier">Supplier*</Label>
                    <Select
                      value={newIncome.supplier_id}
                      onValueChange={(value) =>
                        setNewIncome({ ...newIncome, supplier_id: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.length === 0 ? (
                          <SelectItem value="none" disabled>
                            No suppliers found
                          </SelectItem>
                        ) : (
                          suppliers.map((supplier) => (
                            <SelectItem key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* The second level of the tree: what the supplier paid
                    FOR. Only ever shown under Supplier income, because
                    that is the only kind that has one, and the list is
                    the shop's own — seeded with BM, Incentive and Demo
                    Adjust by script 86 and editable from here after. */}
                {(() => {
                  // "Paid For" under Supplier Paid to Shop, "To" under
                  // Owner Invest, nothing for anything else. Adding is
                  // open to the manager (the + button); renaming and
                  // removing is the owner's (ManageOptionsButton).
                  const field = subtypeFieldFor(newIncome.income_type);
                  if (!field) return null;
                  const options = subtypeLists[field.kind];
                  return (
                    <div>
                      <Label htmlFor="income-subtype">{field.label}*</Label>
                      <div className="flex gap-2">
                        <Select
                          value={newIncome.income_subtype ?? ""}
                          onValueChange={(value) =>
                            setNewIncome({ ...newIncome, income_subtype: value })
                          }
                        >
                          <SelectTrigger id="income-subtype">
                            <SelectValue placeholder={field.placeholder} />
                          </SelectTrigger>
                          <SelectContent>
                            {options.length === 0 ? (
                              <SelectItem value="none" disabled>
                                Nothing here yet — add one
                              </SelectItem>
                            ) : (
                              options.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {labelFor(labels, field.kind, value, value)}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title={"Add a " + field.noun}
                          onClick={() => {
                            setSubtypeDialogKind(field.kind);
                            setShowAddSubtype(true);
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <ManageOptionsButton
                          isOwner={isOwner}
                          onClick={() => {
                            setSubtypeDialogKind(field.kind);
                            setShowManageSubtypes(true);
                          }}
                          label={"Manage " + field.noun + "s"}
                        />
                      </div>
                    </div>
                  );
                })()}

                {/* What this supplier owes for promos, as Expenses shows
                    what the shop owes a supplier. Only for a Promo
                    receipt: that is the one that closes these claims. */}
                {newIncome.income_type === "party_income" &&
                  (newIncome.income_subtype ?? "").trim().toLowerCase() === "promo" &&
                  newIncome.supplier_id && (
                    <div className="sm:col-span-2 2xl:col-span-4">
                      <PromoDuesPanel
                        supplierId={newIncome.supplier_id}
                        onTotalChange={(total) => {
                          setPromoDue(total);
                          // Once per supplier, so it never overwrites
                          // what the counter has already typed.
                          if (promoFilledFor.current !== newIncome.supplier_id) {
                            promoFilledFor.current = newIncome.supplier_id;
                            setNewIncome((prev) => ({ ...prev, amount: total }));
                          }
                        }}
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {promoDue > 0
                          ? `${money(promoDue)} due. A receipt clears the oldest promo first, and cannot be more than this.`
                          : "Nothing due from this supplier for promos."}
                      </p>
                    </div>
                  )}

                {/* Same picker as the POS and Expenses.
                    `destination_type` stays cash-or-bank, because every
                    report and the existing CHECK constraint depend on it —
                    anything that is not cash landed in an account, so it
                    is stored as"bank" whichever route brought it. */}
                {/* Always starts a new row, so Payment Method and Amount
                    sit together underneath whatever the income type put
                    on the first line. Without it the row filled up to
                    four: Owner Invest (Date, Type, To) pulled Payment
                    Method up beside them and left Amount alone below,
                    while Supplier Paid (four fields) happened to wrap
                    correctly. */}
                <div className="sm:col-start-1">
                <PaymentRoute
                  idPrefix="income"
                  methods={payMethods}
                  reloadMethods={reloadPayMethods}
                  value={{
                    method: incomeRoute.method,
                    bankName: incomeRoute.bankName,
                    channel: incomeRoute.channel,
                  }}
                  onChange={setIncomeRoute}
                />
                </div>

                <div>
                  <Label htmlFor="amount">Amount (৳)*</Label>
                  <Input
                    id="amount"
                    {...addFlow.field(1)}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={newIncome.amount || ""}
                    onChange={(e) =>
                      setNewIncome({
                        ...newIncome,
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
                  Description{" "}
                  {newIncome.income_type === "party_income"
                    ? "(Auto-filled)"
                    : "(Optional)"}
                </Label>
                <Textarea
                  id="description"
                  {...addFlow.field(2, { onEnter: () => addFlow.focusIndex(3) })}
                  value={newIncome.description}
                  onChange={(e) =>
                    setNewIncome({ ...newIncome, description: e.target.value })
                  }
                  placeholder="Enter income description"
                  rows={1}
                  className="min-h-9 resize-y"
                  readOnly={
                    newIncome.income_type === "party_income" &&
                    !!newIncome.supplier_id
                  }
                />
              </div>

              <div className="mt-4">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  {...addFlow.field(3, { onEnter: () => addIncome() })}
                  value={newIncome.notes}
                  onChange={(e) =>
                    setNewIncome({ ...newIncome, notes: e.target.value })
                  }
                  placeholder="Additional notes about this income"
                  rows={1}
                  className="min-h-9 resize-y"
                />
              </div>

              <div className="mt-4">
                <Button onClick={addIncome}>
                  <Plus className="h-4 w-4 mr-2" />
                  {/* Names the day whenever it is not today. */}
                  {isToday ? "Add Income" : `Add Income on ${dayLabel(newIncome.date)}`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Income Summary Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Income Summary
              </CardTitle>
            </CardHeader>
            {/* Label and figure on one line each. Stacking them two-deep
              made a short list of three numbers taller than the table it
              sits beside. Only the total gets emphasis — it is the one an
              owner actually reads. */}
            <CardContent className="space-y-2 pb-4 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Total Income</span>
                <span className="text-xl font-bold text-green-600">
                  ৳{totalAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Entries</span>
                <span className="font-semibold">{filteredIncomes.length}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Average</span>
                <span className="font-semibold">
                  ৳
                  {filteredIncomes.length > 0
                    ? (totalAmount / filteredIncomes.length).toFixed(2)
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
                Income Search & Filters
                <ManagerAccessBadge mode="limited" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* The dates get the full width of the card.
                  They used to sit in two columns of a six-column grid — a
                  third of the width, which is not enough for two date
                  inputs and the Today / Clear buttons, so the control
                  wrapped into a four-deep stack. That stack is what left
                  the three dropdowns stranded beside a column of empty
                  space. Given a row of its own it lays out on one line. */}
              <DateRangeFilter
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
                // No onApply: the effect above already runs on every date
                // change, including Today and Clear. Wiring it here too
                // would fire two queries for one click, and the slower
                // answer could land last and overwrite the right one.
                idPrefix="income"
              />

              {/* The dropdowns and the buttons share the next row, so the
                  buttons fill the space the dropdowns leave rather than
                  needing a third row under it. Wraps on a narrow screen. */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-[190px]">
                  <Label htmlFor="filter-income-type">Income Type</Label>
                  <Select
                    value={filterIncomeType}
                    onValueChange={setFilterIncomeType}
                  >
                    {/* The id belongs on the trigger, not the Select: it is
                        what the Label points at, and without it clicking
                        the label does nothing. */}
                    <SelectTrigger id="filter-income-type">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {allIncomeTypes
                        .filter((type) => reachableTypes.has(type.value))
                        .map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-[190px]">
                  <Label htmlFor="filter-supplier">Supplier</Label>
                  <Select value={filterSupplier} onValueChange={setFilterSupplier}>
                    <SelectTrigger id="filter-supplier">
                      <SelectValue placeholder="All Suppliers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Suppliers</SelectItem>
                      {suppliers
                        .filter((supplier) => reachableSuppliers.has(supplier.id))
                        .map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-[190px]">
                  <Label htmlFor="filter-destination">Destination</Label>
                  <Select
                    value={filterDestination}
                    onValueChange={setFilterDestination}
                  >
                    <SelectTrigger id="filter-destination">
                      <SelectValue placeholder="All Destinations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Destinations</SelectItem>
                      {destinationTypes
                        .filter((dest) => reachableDestinations.has(dest.value as any))
                        .map((dest) => (
                        <SelectItem key={dest.value} value={dest.value}>
                          {dest.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* No Search button: the dates re-run the query on
                    their own (the debounced effect above) and the three
                    dropdowns filter the loaded rows as they change, so
                    it only ever repeated work already done. */}
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    onClick={handlePrint}
                    variant="outline"
                    disabled={filteredIncomes.length === 0}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Income Records Table */}
          <Card>
            <CardHeader>
              <CardTitle>Income Records</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading income records...
                </div>
              ) : filteredIncomes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No income records found for the selected filters
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[640px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Income Type</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Destination</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="zebra">
                        {filteredIncomes.map((income) => (
                          <TableRow key={income.id}>
                            <TableCell>{income.date}</TableCell>
                            <TableCell>
                              {getIncomeTypeBadge(
                                income.income_type,
                                income.custom_type,
                                income.income_subtype,
                              )}
                            </TableCell>
                            <TableCell>{income.supplier_name || "—"}</TableCell>
                            <TableCell>
                              {getDestinationBadge(income.destination_type)}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {income.description || "—"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              ৳{income.amount.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-center">
                              {/* Managers may record income but not remove
                              it. Enforced in the database too. */}
                              {isOwner ? (
                                <div className="flex justify-center gap-1">
                                  <Button
                                    onClick={() => openEditIncome(income)}
                                    variant="outline"
                                    size="sm"
                                    title="Correct this income record"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    onClick={() => deleteIncome(income.id!)}
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700"
                                    title="Delete this income record"
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
                          <TableCell colSpan={5}>TOTAL INCOME</TableCell>
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
                        Total Income ৳{totalAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Correct an income record. Owner only — RLS refuses it for
          anyone else, so this dialog is convenience, not the guard. */}
      <Dialog
        open={!!editIncome}
        onOpenChange={(open) => !open && setEditIncome(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Correct income</DialogTitle>
            <DialogDescription>
              Where the money went (cash or bank, and which account) is not
              editable here — changing it would move the figure between lines on
              reports already printed. Delete and re-enter if the destination
              was wrong.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ie-date">Date</Label>
              <Input
                id="ie-date"
                type="date"
                value={editForm.date}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, date: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ie-amount">Amount*</Label>
              <Input
                id="ie-amount"
                type="number"
                step="0.01"
                value={editForm.amount}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ie-type">Income type</Label>
              <Select
                value={editForm.income_type}
                onValueChange={(v) =>
                  setEditForm((f) => ({
                    ...f,
                    income_type: v,
                    // Paid For and To share one column. Switching a row
                    // from Supplier Paid to Owner Invest would otherwise
                    // save "BM" as where the owner's money went.
                    income_subtype:
                      unpackIncomeType(v).income_type ===
                      unpackIncomeType(f.income_type).income_type
                        ? f.income_subtype
                        : "",
                  }))
                }
              >
                <SelectTrigger id="ie-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allIncomeTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Correcting what a supplier payment was for, without
                having to delete the row and enter it again. */}
            {(() => {
              const field = subtypeFieldFor(unpackIncomeType(editForm.income_type).income_type);
              if (!field) return null;
              const options = subtypeLists[field.kind];
              return (
                <div className="sm:col-span-2">
                  <Label htmlFor="ie-subtype">{field.label}</Label>
                  <Select
                    value={editForm.income_subtype}
                    onValueChange={(v) =>
                      setEditForm((prev) => ({ ...prev, income_subtype: v }))
                    }
                  >
                    <SelectTrigger id="ie-subtype">
                      <SelectValue placeholder={field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.length === 0 ? (
                        <SelectItem value="none" disabled>
                          Nothing here yet
                        </SelectItem>
                      ) : (
                        options.map((value) => (
                          <SelectItem key={value} value={value}>
                            {labelFor(labels, field.kind, value, value)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="sm:col-span-2">
              <Label htmlFor="ie-desc">Description</Label>
              <Input
                id="ie-desc"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ie-notes">Notes</Label>
              <Textarea
                id="ie-notes"
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
              onClick={() => setEditIncome(null)}
              disabled={savingEdit}
            >
              Cancel
            </Button>
            <Button onClick={saveIncomeEdit} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Name a new kind of income ----

          Saved to the shop's own list, so it is offered from here on
          rather than retyped. Existing records are untouched. */}
      <Dialog open={showAddType} onOpenChange={setShowAddType}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Add an income type</DialogTitle>
            <DialogDescription>
              It will be offered on every income entry from now on.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-income-type">Name*</Label>
            <Input
              id="new-income-type"
              autoFocus
              placeholder="Rent income, Servicing charge…"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTypeName.trim()) {
                  e.preventDefault();
                  addCustomType();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddType(false)}
              disabled={addingType}
            >
              Cancel
            </Button>
            <Button onClick={addCustomType} disabled={addingType || !newTypeName.trim()}>
              {addingType ? "Adding…" : "Add type"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* What else a supplier can pay for. Same shape as the dialog
          above: written once here, offered from then on. */}
      <Dialog open={showAddSubtype} onOpenChange={setShowAddSubtype}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {subtypeDialogKind === OWNER_INVEST_TO_KIND
                ? "Add where owner money goes"
                : "Add a supplier payment type"}
            </DialogTitle>
            <DialogDescription>
              {subtypeDialogKind === OWNER_INVEST_TO_KIND
                ? "It will be offered in the To box under Owner Invest from now on."
                : "It will be offered under Supplier income from now on."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="new-income-subtype">Name*</Label>
            <Input
              id="new-income-subtype"
              autoFocus
              placeholder={
                subtypeDialogKind === OWNER_INVEST_TO_KIND
                  ? "As stock, cash…"
                  : "BM, Incentive, Demo Adjust…"
              }
              value={newSubtypeName}
              onChange={(e) => setNewSubtypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubtypeName.trim()) {
                  e.preventDefault();
                  addSubtype();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddSubtype(false)}
              disabled={addingSubtype}
            >
              Cancel
            </Button>
            <Button
              onClick={addSubtype}
              disabled={addingSubtype || !newSubtypeName.trim()}
            >
              {addingSubtype ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No builtIns passed: BM, Incentive and Demo Adjust are ordinary
          seeded rows, not fixed kinds, so a shop that does not use one
          can rename or remove it like anything else in the list. */}
      <OptionManager
        open={showManageSubtypes}
        onOpenChange={setShowManageSubtypes}
        shopId={currentShopId}
        kind={subtypeDialogKind}
        title={
          subtypeDialogKind === OWNER_INVEST_TO_KIND
            ? "Owner invest — To"
            : "Supplier payment types"
        }
        noun={
          subtypeDialogKind === OWNER_INVEST_TO_KIND
            ? "destination"
            : "supplier payment type"
        }
        labels={labels}
        onChanged={async () => {
          await Promise.all([loadSubtypes(), reloadLabels()]);
          // One that was just renamed or removed may still be sitting in
          // the form, where it would now match nothing.
          setNewIncome((prev) => ({ ...prev, income_subtype: "" }));
          await searchIncomes();
        }}
      />

      <OptionManager
        open={showManageTypes}
        onOpenChange={setShowManageTypes}
        shopId={currentShopId}
        kind="income_type"
        title="Income types"
        noun="income type"
        builtIns={BUILT_INS}
        labels={labels}
        hidden={hidden}
        onChanged={async () => {
          await Promise.all([loadCustomTypes(), reloadLabels()]);
          // A type that was just renamed or removed may still be sitting
          // in the search filter or the add form, where it would now
          // match nothing and give no clue why.
          setFilterIncomeType("all");
          setNewIncome((prev) =>
            prev.income_type.startsWith(CUSTOM_PREFIX)
              ? { ...prev, income_type: "owner_income" }
              : prev,
          );
          await searchIncomes();
        }}
      />
    </div>
  );
}
