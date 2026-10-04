"use client";

import { useState, useEffect } from "react";
import {
  Save,
  X,
  Plus,
  Minus,
  Camera,
  QrCode,
  Barcode,
  ScanLine,
  CheckCircle2,
} from "lucide-react";
import { OptionCombobox } from "@/components/option-combobox";
import { SupplierEditButton } from "@/components/supplier-edit-button";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { createClient } from "@/utils/supabase/component";
import { useRole } from "@/components/role-provider";

const supabase = createClient();

type ColorVariant = {
  id: string;
  color: string;
  quantity: number;
  barcodes: string[]; // one per physical unit, when they are scanned
  /**
   * Counted stock rather than scanned stock.
   *
   * Accessories — cables, covers, glass — have no barcode worth
   * scanning. The shop counts them:"twelve black covers", not twelve
   * individually identified covers. When this is on, the unit list is
   * replaced by a single quantity and the database generates an
   * internal key so the product still reaches Inventory.
   */
  noBarcode: boolean;
};

type Supplier = {
  id: string;
  name: string;
};

export function AddProductForm() {
  const { currentShopId } = useRole();
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(""); // will hold supplier id from DB
  const [selectedSupplierName, setSelectedSupplierName] = useState(""); // New state to track the display name
  const [productName, setProductName] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [currentVariantId, setCurrentVariantId] = useState("");
  const [currentBarcodeIndex, setCurrentBarcodeIndex] = useState(0);

  // ---- Rapid Scan: one barcode after another, hands on the scanner
  const [showRapidScan, setShowRapidScan] = useState(false);
  const [rapidVariantId, setRapidVariantId] = useState("");
  const [rapidCode, setRapidCode] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  // RAM/ROM configuration — 4/64, 6/128, 8/256. Kept separate from the
  // product name so the same handset does not appear in reports as
  // three unrelated products.
  const [variant, setVariant] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  /**
   * Counted stock rather than scanned stock, for the whole product.
   *
   * A product-level choice, not a per-colour one: a shop either
   * identifies each unit or it counts them, and mixing both within one
   * product gives a stock figure nobody can reconcile.
   */
  const [noBarcodeMode, setNoBarcodeMode] = useState(false);
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [description, setDescription] = useState("");
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([
    { id: "1", color: "", quantity: 0, barcodes: [], noBarcode: false },
  ]);
  const { toast } = useToast();

  // --- New supplier / suppliers state ---
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [supplierContact, setSupplierContact] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");

  // Update supplier name when selected supplier changes
  useEffect(() => {
    if (selectedSupplier && suppliers.length > 0) {
      const supplier = suppliers.find((s) => s.id === selectedSupplier);
      if (supplier) {
        setSelectedSupplierName(supplier.name);
      }
    } else {
      setSelectedSupplierName("");
    }
  }, [selectedSupplier, suppliers]);

  // --- Load suppliers from DB ---
  // With RLS enabled, the client will only receive rows it is allowed to read
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
      setSuppliers((data as any) || []);
    } catch (err: any) {
      console.error("Failed to load suppliers:", err);
      toast({
        title: "Error",
        description: "Could not load suppliers from database.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    // currentShopId is null until RoleProvider resolves the session;
    // querying with it would send organization_id=eq.null and fail.
    if (!currentShopId) return;
    loadSuppliers();
  }, [currentShopId]);

  const addColorVariant = () => {
    const newId = Date.now().toString();
    setColorVariants([
      ...colorVariants,
      {
        id: newId,
        color: "",
        quantity: noBarcodeMode ? 1 : 0,
        barcodes: [],
        // Must follow the form's mode. A counted-stock row created with
        // noBarcode false has no barcodes and no way to get any, so the
        // save path would skip it and the colour would vanish without a
        // word.
        noBarcode: noBarcodeMode,
      },
    ]);
  };

  const removeColorVariant = (id: string) => {
    if (colorVariants.length > 1) {
      setColorVariants(colorVariants.filter((variant) => variant.id !== id));
    }
  };

  const updateColorVariant = (
    id: string,
    field: keyof Omit<ColorVariant, "barcodes">,
    value: string | number,
  ) => {
    setColorVariants(
      colorVariants.map((variant) =>
        variant.id === id ? { ...variant, [field]: value } : variant,
      ),
    );
  };

  const updateColorVariantBarcodes = (id: string, barcodes: string[]) => {
    setColorVariants(
      colorVariants.map((variant) =>
        variant.id === id ? { ...variant, barcodes } : variant,
      ),
    );
  };

  const updateIndividualBarcode = (
    variantId: string,
    index: number,
    value: string,
  ) => {
    setColorVariants(
      colorVariants.map((variant) => {
        if (variant.id === variantId) {
          const newBarcodes = [...variant.barcodes];
          newBarcodes[index] = value;
          return { ...variant, barcodes: newBarcodes };
        }
        return variant;
      }),
    );
  };

  /**
   * Drop one physical unit from a colour.
   *
   * Removes that unit's barcode and closes the gap, rather than
   * blanking it — a blank row in the middle looks like a barcode nobody
   * has scanned yet. The quantity follows, because the two must agree:
   * a colour claiming 5 units with 4 barcodes cannot be saved.
   */
  const removeUnit = (variantId: string, index: number) => {
    setColorVariants(
      colorVariants.map((variant) => {
        if (variant.id !== variantId) return variant;
        const barcodes = variant.barcodes.filter((_, i) => i !== index);
        return {
          ...variant,
          barcodes,
          quantity: Math.max(0, variant.quantity - 1),
        };
      }),
    );
  };

  /**
   * Take one scanned code and move straight on to the next.
   *
   * The quantity follows the number of barcodes rather than being typed
   * separately: with a box of thirty handsets, a quantity that disagrees
   * with the codes captured is a miscount nobody would notice until the
   * stock take.
   *
   * A duplicate is refused rather than added. Scanners fire twice more
   * often than anyone expects, and two units sharing a barcode cannot
   * both be sold.
   */
  const addRapidScan = () => {
    const code = rapidCode.trim();
    if (!code || !rapidVariantId) return;

    const target = colorVariants.find((v) => v.id === rapidVariantId);
    if (target?.barcodes.includes(code)) {
      toast({
        title: "Already scanned",
        description: `${code} is already in this colour.`,
        variant: "destructive",
      });
      setRapidCode("");
      return;
    }

    setColorVariants((prev) =>
      prev.map((v) => {
        if (v.id !== rapidVariantId) return v;
        const barcodes = [...v.barcodes.filter(Boolean), code];
        return { ...v, barcodes, quantity: barcodes.length };
      }),
    );
    setRapidCode("");
  };

  const generateBarcodesForVariant = (variantId: string, quantity: number) => {
    setColorVariants(
      colorVariants.map((variant) => {
        if (variant.id === variantId) {
          // If we're increasing quantity, add empty barcode slots
          if (quantity > variant.barcodes.length) {
            const newBarcodes = [...variant.barcodes];
            while (newBarcodes.length < quantity) {
              newBarcodes.push("");
            }
            return { ...variant, quantity, barcodes: newBarcodes };
          }
          // If decreasing quantity, remove extra barcodes
          else if (quantity < variant.barcodes.length) {
            return {
              ...variant,
              quantity,
              barcodes: variant.barcodes.slice(0, quantity),
            };
          } else {
            return { ...variant, quantity };
          }
        }
        return variant;
      }),
    );
  };

  const openBarcodeScanner = (variantId: string, barcodeIndex: number) => {
    setCurrentVariantId(variantId);
    setCurrentBarcodeIndex(barcodeIndex);
    setShowBarcodeScanner(true);
  };

  const handleBarcodeScanned = (scannedBarcode: string) => {
    if (currentVariantId) {
      updateIndividualBarcode(
        currentVariantId,
        currentBarcodeIndex,
        scannedBarcode,
      );
      setShowBarcodeScanner(false);
      setCurrentVariantId("");
      setCurrentBarcodeIndex(0);
      toast({
        title: "Barcode Captured",
        description: `Barcode ${scannedBarcode} has been saved`,
      });
    }
  };

  // --- Add supplier to DB (now includes owner = auth.uid()) ---
  const handleAddSupplier = async () => {
    if (!supplierName.trim()) {
      toast({
        title: "Error",
        description: "Supplier name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Try to get the logged-in user (v2)
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      console.log("auth.getUser()", { userData, userErr });
      if (userErr) {
        // also try getSession as an alternative check
        const { data: sessionData, error: sessionErr } =
          await supabase.auth.getSession();
        console.log("auth.getSession()", { sessionData, sessionErr });
      }

      const user = userData?.user;
      if (!user?.id) {
        console.error(
          "No authenticated user found. Insert will be blocked by RLS.",
        );
        toast({
          title: "Not authenticated",
          description: "Please sign in before adding a supplier.",
          variant: "destructive",
        });
        return;
      }

      console.log("Current user id (will be used as owner):", user.id);

      const { data, error } = await supabase
        .from("suppliers")
        .insert([
          {
            name: supplierName.trim(),
            contact_person: supplierContact || null,
            phone: supplierPhone || null,
            email: supplierEmail || null,
            address: supplierAddress || null,
            owner: user.id, // MUST match auth.uid() in your RLS policy
            organization_id: currentShopId,
          },
        ])
        .select("id, name")
        .single();

      if (error) {
        // If it's an RLS error, show details and log full error object
        console.error("Insert error:", error);
        if (error.message?.includes("violates row-level security")) {
          toast({
            title: "Row-level security prevented insert",
            description:
              "The DB refused the insert. Check that 'owner' equals the logged-in user's id and RLS policies.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Database Error",
            description: error.message || "Failed to add supplier",
            variant: "destructive",
          });
        }
        return;
      }

      // success
      await loadSuppliers();
      setSelectedSupplier(data.id);
      setShowAddSupplier(false);
      setSupplierName("");
      setSupplierContact("");
      setSupplierPhone("");
      setSupplierEmail("");
      setSupplierAddress("");
      toast({
        title: "Supplier Added",
        description: `${data.name} added successfully!`,
      });
    } catch (err: any) {
      console.error("Unexpected error in handleAddSupplier:", err);
      toast({
        title: "Error",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    }
  };

  // ---- Keyboard-first entry
  //
  // Receiving stock means scanning one barcode per unit. Enter jumps
  // to the next unit, so a box of 20 phones is scan-Enter-scan-Enter
  // without ever touching the mouse. Most scanners send Enter for
  // free, which makes it a single trigger pull per unit.

  const focusEl = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select?.();
  };

  const barcodeInputId = (variantId: string, index: number) =>
    `variant-barcode-${variantId}-${index}`;

  // Enter on a unit barcode moves to the next unit, then on to the
  // first unit of the following colour variant.
  const handleBarcodeKeyDown = (
    e: React.KeyboardEvent,
    variantId: string,
    index: number,
  ) => {
    if (e.key !== "Enter" || (e.nativeEvent as any)?.isComposing) return;
    e.preventDefault();

    const variantIdx = colorVariants.findIndex((v) => v.id === variantId);
    if (variantIdx === -1) return;

    const variant = colorVariants[variantIdx];
    if (index + 1 < variant.quantity) {
      focusEl(barcodeInputId(variantId, index + 1));
      return;
    }
    const next = colorVariants[variantIdx + 1];
    if (next && next.quantity > 0) focusEl(barcodeInputId(next.id, 0));
  };

  // Enter walks the product detail fields in reading order.
  const nextOnEnter = (nextId: string) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || (e.nativeEvent as any)?.isComposing) return;
    e.preventDefault();
    focusEl(nextId);
  };

  const handleSaveProduct = async () => {
    // Counted stock asks for far less.
    //
    // An accessory has no model number, often no brand, and frequently
    // no colour worth recording — a USB cable is a USB cable. Demanding
    // those fields would mean staff inventing values to get past the
    // form, and invented data is worse than absent data.
    if (!productName) {
      toast({
        title: "Error",
        description: "Please enter the product name",
        variant: "destructive",
      });
      return;
    }

    if (!noBarcodeMode && !modelNumber) {
      toast({
        title: "Error",
        description: "Please fill in product name and model number",
        variant: "destructive",
      });
      return;
    }

    if (!selectedSupplier) {
      toast({
        title: "Error",
        description: "Please select a supplier",
        variant: "destructive",
      });
      return;
    }

    // Colour is required only when units are scanned, because that is
    // what tells two otherwise identical handsets apart.
    const validVariants = colorVariants.filter((v) =>
      noBarcodeMode ? v.quantity > 0 : v.color && v.quantity > 0,
    );
    const totalQuantity = validVariants.reduce((sum, v) => sum + v.quantity, 0);

    if (totalQuantity === 0) {
      toast({
        title: "Error",
        description: noBarcodeMode
          ? "Enter how many are in stock"
          : "Please add at least one color variant with quantity",
        variant: "destructive",
      });
      return;
    }

    // Check if all barcodes are filled
    // Counted stock is exempt: it has no barcodes on purpose.
    const missingBarcodes = validVariants.some(
      (variant) =>
        !variant.noBarcode &&
        (variant.barcodes.filter(Boolean).length !== variant.quantity ||
          variant.barcodes.some((barcode) => !barcode.trim())),
    );

    if (missingBarcodes) {
      toast({
        title: "Missing barcodes",
        description: "Please scan barcodes for all product units.",
        variant: "destructive",
      });
      return;
    }

    if (!category || !costPrice || !sellPrice) {
      toast({
        title: "Error",
        description:
          "Please fill in all required fields (category, cost price, selling price)",
        variant: "destructive",
      });
      return;
    }

    // Check for duplicate barcodes
    const allBarcodes = validVariants
      .filter((v) => !v.noBarcode)
      .flatMap((v) => v.barcodes);
    const uniqueBarcodes = new Set(allBarcodes);

    if (allBarcodes.length !== uniqueBarcodes.size) {
      toast({
        title: "Duplicate barcodes",
        description: "Please ensure all barcodes are unique.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Check for existing barcodes in database
      const { data: existing, error: checkErr } = await supabase
        .from("color_variants")
        .select("barcode")
        .eq("organization_id", currentShopId)
        .in("barcode", allBarcodes);

      if (checkErr) {
        console.error("Barcode check error:", checkErr);
        toast({
          title: "Database Error",
          description: "Failed to check barcode uniqueness",
          variant: "destructive",
        });
        return;
      }

      if (existing && existing.length > 0) {
        const found = existing.map((r: any) => r.barcode);
        toast({
          title: "Duplicate barcodes in database",
          description: `Already used: ${found.join(",")}`,
          variant: "destructive",
        });
        return;
      }

      // Create purchase
      const purchaseInsertPayload: any = {
        product_name: productName,
        model_number: modelNumber,
        category,
        brand,
        cost_price: parseFloat(costPrice),
        sale_price: parseFloat(sellPrice),
        description: description || null,
        organization_id: currentShopId,
      };

      // purchases.supplier is a text column for the supplier's NAME —
      // it is what the Inventory table and printed reports display, and
      // it deliberately keeps the name even if the supplier record is
      // later removed. The id belongs in supplier_id.
      //
      // This previously put the id in both places, which is why the
      // Inventory screen showed a raw uuid in the Supplier column.
      purchaseInsertPayload.supplier_id = selectedSupplier || null;
      purchaseInsertPayload.supplier =
        selectedSupplierName ||
        suppliers.find((sup) => sup.id === selectedSupplier)?.name ||
        null;

      const { data: purchaseData, error: purchaseError } = await supabase
        .from("purchases")
        .insert([purchaseInsertPayload])
        .select("id")
        .single();

      if (purchaseError) {
        console.error("Purchase insert failed:", purchaseError);
        toast({
          title: "Database Error",
          description: `Failed to save product: ${purchaseError.message}`,
          variant: "destructive",
        });
        return;
      }

      const purchaseId = purchaseData?.id;
      if (!purchaseId) {
        toast({
          title: "Database Error",
          description: "Failed to save product: No purchase ID returned",
          variant: "destructive",
        });
        return;
      }

      // Scanned stock: one row per barcode, each a single unit.
      // Counted stock: ONE row carrying the whole quantity, with no
      // barcode — the database generates an internal key so it still
      // reaches Inventory. Writing one row per unit there would invent
      // units the shop never identified.
      type VariantInsert = {
        barcode: string | null;
        purchase_id: number;
        color: string;
        variant: string | null;
        quantity: number;
        imei: string | null;
        no_barcode: boolean;
        organization_id: string | null;
      };

      const variantInserts: VariantInsert[] = validVariants.flatMap(
        (v): VariantInsert[] =>
          v.noBarcode
            ? [
                {
                  barcode: null,
                  purchase_id: purchaseId,
                  color: v.color,
                  variant: variant || null,
                  quantity: v.quantity,
                  imei: null,
                  no_barcode: true,
                  organization_id: currentShopId,
                },
              ]
            : v.barcodes.filter(Boolean).map((barcode) => ({
                barcode: barcode.trim(),
                purchase_id: purchaseId,
                color: v.color,
                variant: variant || null,
                quantity: 1, // Each barcode represents one unit
                imei: barcode.trim(), // IMEI same as barcode as requested
                no_barcode: false,
                organization_id: currentShopId,
              })),
      );

      const { error: variantError } = await supabase
        .from("color_variants")
        .insert(variantInserts);

      if (variantError) {
        console.error("Variant insert error:", variantError);
        toast({
          title: "Database Error",
          description: `Failed to save variants: ${variantError.message}`,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Product saved",
        description: `${variantInserts.length} unit${
          variantInserts.length === 1 ? "" : "s"
        } added${variant ? ` for ${variant}` : ""}. The product details are still filled in — enter the next variant.`,
      });
      resetForNextVariant();
    } catch (err: any) {
      console.error("Unexpected error:", err);
      toast({
        title: "Error",
        description: "An unexpected error occurred while saving the product",
        variant: "destructive",
      });
    }
  };

  /** Everything cleared — for the Cancel button. */
  const resetForm = () => {
    setProductName("");
    setModelNumber("");
    setCategory("");
    setBrand("");
    setVariant("");
    setCostPrice("");
    setSellPrice("");
    setDescription("");
    setShowDescription(false);
    setNoBarcodeMode(false);
    setSelectedSupplier("");
    setSelectedSupplierName("");
    setColorVariants([
      { id: "1", color: "", quantity: 0, barcodes: [], noBarcode: false },
    ]);
  };

  /**
   * Cleared ready for the next configuration of the SAME handset.
   *
   * A shop receiving a box of Galaxy A15s enters 4/64 in three colours,
   * then 6/128 in three colours, then 8/256 — same brand, same model,
   * same supplier, same prices, over and over. Clearing the whole form
   * each time means re-typing all of that for every configuration.
   *
   * So the identity of the product stays put and only what actually
   * differs is cleared: the variant, the colours, and their barcodes.
   * Cancel still wipes everything.
   */
  const resetForNextVariant = () => {
    setVariant("");
    // The mode is kept: a shop entering accessories enters several in a
    // row, and flipping the toggle back each time would be tedious.
    setColorVariants([
      {
        id: "1",
        color: "",
        quantity: noBarcodeMode ? 1 : 0,
        barcodes: [],
        noBarcode: noBarcodeMode,
      },
    ]);
  };

  return (
    <>
      <form className="space-y-6">
        {/* Basic Information */}
        <div className="space-y-4">
          {/* First decision on the page, because it changes what the
              rest of the form asks for. */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <Switch
                id="no-barcode-mode"
                checked={noBarcodeMode}
                onCheckedChange={(next) => {
                  setNoBarcodeMode(next);
                  // Counted stock is one line, not a list of colours.
                  // Any barcodes already entered are dropped: keeping
                  // them would save units the shop cannot then see.
                  setColorVariants([
                    {
                      id: "1",
                      color: "",
                      quantity: next ? 1 : 0,
                      barcodes: [],
                      noBarcode: next,
                    },
                  ]);
                }}
                className="data-[state=checked]:bg-orange-500"
              />
              <Label
                htmlFor="no-barcode-mode"
                className="cursor-pointer text-sm font-medium"
              >
                No barcode{""}
                <span className="font-normal text-muted-foreground">
                  (track by quantity only)
                </span>
              </Label>
            </div>
            <span className="text-xs text-muted-foreground">
              {noBarcodeMode ? "Counted stock" : "Each unit scanned"}
            </span>
          </div>

          {noBarcodeMode && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Only{" "}
              <span className="font-medium">
                product name, category, cost price, sale price
              </span>{" "}
              and <span className="font-medium">supplier</span> are required.
              Brand, model, variant and colour are optional.
            </div>
          )}

          <h3 className="text-lg font-medium">Basic Information</h3>

          {/* Order follows how stock actually arrives: you know the
              brand before the model, and the configuration last. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OptionCombobox
              id="brand"
              kind="brand"
              label="Brand*"
              placeholder="Select or type brand"
              value={brand}
              onChange={setBrand}
            />
            <OptionCombobox
              id="category"
              kind="category"
              label="Category*"
              placeholder="Select or type category"
              value={category}
              onChange={setCategory}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OptionCombobox
              id="product-name"
              kind="product_name"
              label="Product Name*"
              placeholder="Select or type product name"
              value={productName}
              onChange={setProductName}
            />
            <OptionCombobox
              id="model"
              kind="model_number"
              label="Model Number*"
              placeholder="Select or type model number"
              value={modelNumber}
              onChange={setModelNumber}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <OptionCombobox
              id="variant"
              kind="variant"
              label="Variant"
              placeholder="e.g. 4/64, 6/128, 8/256"
              value={variant}
              onChange={setVariant}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cost-price">Cost Price*</Label>
              <Input
                id="cost-price"
                onKeyDown={nextOnEnter("selling-price")}
                type="number"
                placeholder="0.00 ৳"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="selling-price">Selling Price*</Label>
              <Input
                id="selling-price"
                onKeyDown={nextOnEnter("description")}
                type="number"
                placeholder="0.00 ৳"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="supplier">Supplier</Label>
            <div className="flex gap-2">
              <Select
                value={selectedSupplier}
                onValueChange={setSelectedSupplier}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue>
                    {selectedSupplierName || "Select supplier"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {suppliers.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No suppliers found
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
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowAddSupplier(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <SupplierEditButton
                supplier={suppliers.find((s) => s.id === selectedSupplier) ?? null}
                onRenamed={loadSuppliers}
                onRemoved={async () => {
                  setSelectedSupplier("");
                  await loadSuppliers();
                }}
              />
            </div>
          </div>

          {/* Folded away by default. It is used on a small minority of
              products, and a large empty box between the prices and the
              stock section pushes the part staff use on every entry off
              the screen. */}
          {showDescription || description ? (
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Description</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setDescription("");
                    setShowDescription(false);
                  }}
                >
                  <X className="mr-1 h-3 w-3" />
                  Remove
                </Button>
              </div>
              <Textarea
                id="description"
                autoFocus={showDescription && !description}
                placeholder="Enter product description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-20"
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDescription(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Description
            </Button>
          )}
        </div>

        {/* Colour variants — only when each unit is scanned. Counted
            stock is a single quantity, shown below instead. */}
        {!noBarcodeMode && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Color Variants & Stock</h3>
              <Button type="button" variant="outline" onClick={addColorVariant}>
                <Plus className="mr-2 h-4 w-4" />
                Add Color
              </Button>
            </div>

            <div className="space-y-4">
              {/* `cv` rather than `variant`: the RAM/ROM variant is now a
                field of its own, and shadowing it here would make the
                heading below unable to see it. */}
              {colorVariants.map((cv, index) => (
                <Card key={cv.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {/* Says which configuration these colours belong
                          to, so entering 4/64 then 6/128 for the same
                          handset never gets muddled. */}
                        {variant
                          ? `Color Variant: ${variant}`
                          : `Color Variant ${index + 1}`}
                        {variant && colorVariants.length > 1 && (
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            #{index + 1}
                          </span>
                        )}
                      </CardTitle>
                      {colorVariants.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeColorVariant(cv.id)}
                        >
                          <Minus className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <OptionCombobox
                      kind="color"
                      label="Color*"
                      placeholder="Enter color name (e.g. Black, Blue)"
                      value={cv.color}
                      onChange={(v) => updateColorVariant(cv.id, "color", v)}
                    />

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-semibold">
                          Barcodes — {cv.barcodes.filter(Boolean).length} units
                          scanned
                        </Label>
                      </div>
                      {/* Scan a boxful without touching the mouse. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRapidVariantId(cv.id);
                          setRapidCode("");
                          setShowRapidScan(true);
                        }}
                      >
                        <ScanLine className="mr-2 h-4 w-4" />
                        Rapid Scan
                      </Button>
                    </div>

                    {/* One row per physical unit — each has its own barcode. */}
                    {!cv.noBarcode && cv.quantity > 0 && (
                      <div className="space-y-3">
                        <Label>Product Barcodes* ({cv.quantity} units)</Label>
                        <div className="space-y-2">
                          {Array.from({ length: cv.quantity }).map((_, i) => (
                            <div key={i} className="flex gap-2 items-center">
                              <Label className="w-20">Unit {i + 1}:</Label>
                              <Input
                                id={barcodeInputId(cv.id, i)}
                                placeholder="Scan barcode"
                                value={cv.barcodes[i] || ""}
                                onChange={(e) =>
                                  updateIndividualBarcode(
                                    cv.id,
                                    i,
                                    e.target.value,
                                  )
                                }
                                onKeyDown={(e) =>
                                  handleBarcodeKeyDown(e, cv.id, i)
                                }
                                className="flex-1"
                                required
                              />
                              {/* Removes this unit and closes the gap, for
                                when a handset in the box turns out to be
                                damaged or already sold. The camera
                                button that used to sit here opened a
                                scanner that was never implemented. */}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove unit ${i + 1}`}
                                title="Remove this unit"
                                onClick={() => removeUnit(cv.id, i)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="bg-muted p-3 rounded-lg">
                          <div className="flex items-center gap-2">
                            <QrCode className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              Barcodes:{" "}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {cv.barcodes.map(
                              (barcode, i) =>
                                barcode && (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2"
                                  >
                                    <Barcode className="h-3 w-3" />
                                    <code className="bg-background px-2 py-1 rounded text-xs font-mono">
                                      {barcode}
                                    </code>
                                  </div>
                                ),
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Each barcode represents one physical unit. Barcode
                            and IMEI will be the same.
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-medium">Total Quantity:</span>
                <span className="text-lg font-bold">
                  {colorVariants.reduce(
                    (sum, variant) => sum + variant.quantity,
                    0,
                  )}{" "}
                  units
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Counted stock: one line per colour, each with its own count.
            A shop stocking covers has twelve black and eight blue —
            one number for"covers" would make it impossible to tell
            which colour has run out. Colour stays optional, for the
            things that genuinely have none. */}
        {noBarcodeMode && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Stock</h3>
              <Button type="button" variant="outline" onClick={addColorVariant}>
                <Plus className="mr-2 h-4 w-4" />
                Add Color
              </Button>
            </div>

            <div className="space-y-3">
              {colorVariants.map((cv, index) => (
                <div
                  key={cv.id}
                  className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 py-6"
                >
                  {colorVariants.length > 1 && (
                    <div className="flex w-full items-center justify-between px-4">
                      <span className="text-xs font-medium text-muted-foreground">
                        {cv.color || `Colour ${index + 1}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removeColorVariant(cv.id)}
                      >
                        <Minus className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  )}

                  <div className="w-full max-w-xs px-4">
                    <OptionCombobox
                      kind="color"
                      label="Colour (optional)"
                      placeholder="e.g. Black"
                      value={cv.color}
                      onChange={(v) => updateColorVariant(cv.id, "color", v)}
                    />
                  </div>

                  <Label className="pt-1 text-base font-semibold">
                    Quantity in Stock
                  </Label>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-12"
                      onClick={() =>
                        updateColorVariant(
                          cv.id,
                          "quantity",
                          Math.max(0, cv.quantity - 1),
                        )
                      }
                    >
                      <Minus className="h-5 w-5" />
                    </Button>
                    <Input
                      type="number"
                      min={0}
                      className="h-16 w-32 text-center text-2xl font-bold"
                      value={cv.quantity || ""}
                      onChange={(e) =>
                        updateColorVariant(
                          cv.id,
                          "quantity",
                          Math.max(0, Number.parseInt(e.target.value) || 0),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-12"
                      onClick={() =>
                        updateColorVariant(cv.id, "quantity", cv.quantity + 1)
                      }
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Stock is tracked by quantity. Individual units won&apos;t have
              unique barcodes.
            </p>

            <div className="rounded-lg bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Total Quantity:</span>
                <span className="text-lg font-bold">
                  {colorVariants.reduce((sum, v) => sum + v.quantity, 0)} units
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end space-x-2 pt-4">
          <Button type="button" variant="outline" onClick={resetForm}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button type="button" onClick={handleSaveProduct}>
            <Save className="mr-2 h-4 w-4" />
            Save Product
          </Button>
        </div>
      </form>

      {/* Add Supplier Dialog */}
      <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
            <DialogDescription>
              Enter supplier information to add to your supplier list.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="supplier-name">Supplier Name*</Label>
              <Input
                id="supplier-name"
                placeholder="Enter supplier name"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="supplier-contact">Contact Person</Label>
              <Input
                id="supplier-contact"
                placeholder="Enter contact person name"
                value={supplierContact}
                onChange={(e) => setSupplierContact(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="supplier-phone">Phone Number</Label>
              <Input
                id="supplier-phone"
                placeholder="Enter phone number"
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="supplier-email">Email</Label>
              <Input
                id="supplier-email"
                type="email"
                placeholder="Enter email address"
                value={supplierEmail}
                onChange={(e) => setSupplierEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="supplier-address">Address</Label>
              <Textarea
                id="supplier-address"
                placeholder="Enter supplier address"
                className="h-20"
                value={supplierAddress}
                onChange={(e) => setSupplierAddress(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSupplier(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSupplier}>Add Supplier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rapid Scan — a boxful of handsets, hands never leaving the
          scanner. Each code is appended the moment it arrives, so the
          count on screen is always what has actually been captured. */}
      <Dialog open={showRapidScan} onOpenChange={setShowRapidScan}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-green-600" />
              Rapid Scan
            </DialogTitle>
            <DialogDescription>
              Scan barcodes one by one. Each scan is saved instantly. Close when
              done.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const target = colorVariants.find((v) => v.id === rapidVariantId);
            const scanned = target?.barcodes.filter(Boolean).length ?? 0;

            return (
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                    <CheckCircle2 className="h-4 w-4" />
                    {scanned} unit{scanned === 1 ? "" : "s"} scanned
                  </div>
                  <p className="mt-0.5 text-xs text-green-700">
                    Scan the next barcode when ready
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="rapid-code">Next barcode</Label>
                  <Input
                    id="rapid-code"
                    autoFocus
                    value={rapidCode}
                    placeholder="Waiting for scan..."
                    className="font-mono"
                    onChange={(e) => setRapidCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      addRapidScan();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Press{" "}
                    <kbd className="rounded border px-1 text-[10px]">Enter</kbd>{" "}
                    or let your scanner auto-submit
                  </p>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setShowRapidScan(false)}>
              Done —{""}
              {colorVariants
                .find((v) => v.id === rapidVariantId)
                ?.barcodes.filter(Boolean).length ?? 0}
              {""}
              scanned
            </Button>
            <Button onClick={addRapidScan} disabled={!rapidCode.trim()}>
              Save &amp; Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Barcode Scanner Dialog */}
      <Dialog open={showBarcodeScanner} onOpenChange={setShowBarcodeScanner}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Scan Product Barcode</DialogTitle>
            <DialogDescription>
              Use your camera to scan the barcode from the product box. Make
              sure the barcode is clearly visible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted p-8 rounded-lg text-center">
              <Camera className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                Camera scanner will appear here
              </p>
              <p className="text-xs text-muted-foreground">
                Position the barcode within the camera frame to scan
                automatically
              </p>
            </div>
            <div className="space-y-2">
              <Label>Or enter barcode manually:</Label>
              <Input
                placeholder="Enter barcode manually"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) {
                    handleBarcodeScanned(e.currentTarget.value.trim());
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBarcodeScanner(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Simulate barcode scan for demo
                const demoBarcode = `${Date.now()}`;
                handleBarcodeScanned(demoBarcode);
              }}
            >
              Scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
