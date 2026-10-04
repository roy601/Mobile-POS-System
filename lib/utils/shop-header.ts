import type { Shop } from "@/components/role-provider"

/** Escape for injection into a printed HTML document. */
function esc(v: unknown) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * The letterhead block for a printed report.
 *
 * Every report used to carry one shop's details as string literals —
 * and not even consistently: the cashbook printed a different address
 * from the expense and income reports. Sourcing all of them from the
 * shop record means each shop prints itself, and there is one place to
 * change when details move.
 */
export function shopHeader(shop: Shop | null | undefined) {
  const phones = [shop?.phone, shop?.phone_secondary].filter(Boolean).join(", ")

  return {
    /** Shop name, upper-cased to match the existing report styling. */
    name: esc((shop?.name || "Shop").toUpperCase()),
    /** Address and contact numbers on one line, blank parts dropped. */
    addressLine: esc(
      [shop?.address, phones ? `Mobile: ${phones}` : ""].filter(Boolean).join(" • ")
    ),
    phones: esc(phones),
  }
}
