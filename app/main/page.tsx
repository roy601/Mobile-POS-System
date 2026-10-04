import { redirect } from "next/navigation"

// /main used to be a second, fuller copy of the Data Sync screen, so the
// same feature looked different depending on whether you arrived here
// after logging in or clicked "Data Sync" in the nav. There is now one
// Data Sync page at /data-sync.
//
// This is where login lands, and for a till the right place to land is
// the POS — not a diagnostics screen.
export default function MainPage() {
  redirect("/pos")
}
