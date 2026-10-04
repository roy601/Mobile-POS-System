import type { PostgrestError } from "@supabase/supabase-js"

// Postgres raises this when a row-level security policy rejects a write.
const RLS_VIOLATION = "42501"
const UNIQUE_VIOLATION = "23505"
const FK_VIOLATION = "23503"

export type DbFailureKind = "permission" | "subscription" | "duplicate" | "reference" | "offline" | "unknown"

export interface DbFailure {
  kind: DbFailureKind
  title: string
  message: string
}

/**
 * Turns a raw Supabase/Postgres error into something a shop owner can
 * act on.
 *
 * Role limits and the subscription lockout are both enforced by RLS,
 * so they arrive here as the same 42501 code. `subscriptionActive`
 * lets the caller disambiguate: if the subscription has lapsed, that
 * is almost certainly the real reason the write was refused.
 */
export function describeDbError(
  error: PostgrestError | Error | null | undefined,
  opts: { subscriptionActive?: boolean } = {}
): DbFailure {
  if (!error) {
    return { kind: "unknown", title: "Something went wrong", message: "Please try again." }
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      kind: "offline",
      title: "You're offline",
      message: "This change could not be saved because there is no internet connection.",
    }
  }

  const code = (error as PostgrestError).code

  if (code === RLS_VIOLATION) {
    if (opts.subscriptionActive === false) {
      return {
        kind: "subscription",
        title: "Subscription inactive",
        message:
          "Your subscription has expired, so the app is in read-only mode. Your data is safe and you can still view and export it. Renew to start recording again.",
      }
    }
    return {
      kind: "permission",
      title: "Not allowed",
      message: "Your account doesn't have permission to do this. Ask the shop owner if you need access.",
    }
  }

  if (code === UNIQUE_VIOLATION) {
    return {
      kind: "duplicate",
      title: "Already exists",
      message: "A record with these details already exists in this shop.",
    }
  }

  if (code === FK_VIOLATION) {
    return {
      kind: "reference",
      title: "Still in use",
      message: "This record is linked to other records and can't be removed.",
    }
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    message: error.message || "Please try again.",
  }
}

/**
 * An UPDATE or DELETE blocked by an RLS `USING` clause is not an
 * error — Postgres simply matches no rows. Callers that need to know
 * whether the write actually happened should request the affected
 * rows and pass them here.
 */
export function wasSilentlyBlocked(rows: unknown[] | null | undefined): boolean {
  return !rows || rows.length === 0
}
