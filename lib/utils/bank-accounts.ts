/**
 * The shop's bank accounts.
 *
 * One list, used by the POS payment panel, the Dues panel, Expenses and
 * Income — so a payment recorded on one screen can be reconciled
 * against a payment recorded on another. It was previously written out
 * by hand inside pos-client, which meant no other screen could offer
 * the same choices and the Bank Info page had to guess.
 *
 * Hard-coded on purpose, and not to be edited without the client
 * asking: these names appear on printed reports going back months, and
 * renaming one would silently re-label history.
 *
 * The METHODS under each bank — Card, PULM, bKash — are not here. Those
 * are the shop's own, held in `payment_methods`, where a manager can
 * add what they need without a new release.
 */
export type BankAccount = {
  id: string
  bankName: string
}

export const BANK_ACCOUNTS: BankAccount[] = [
  { id: "BANK-001", bankName: "BRAC Bank Limited - Star Power" },
  { id: "BANK-002", bankName: "BRAC Bank Limited - Star Communication" },
  { id: "BANK-003", bankName: "City Bank Limited - Star Power" },
  { id: "BANK-004", bankName: "City Bank Limited - Star Communication" },
  { id: "BANK-005", bankName: "Dutch-Bangla Bank Limited" },
  { id: "BANK-006", bankName: "EBL Bank" },
]

/** Every bank name, for filter dropdowns. */
export const BANK_NAMES = BANK_ACCOUNTS.map((b) => b.bankName)
