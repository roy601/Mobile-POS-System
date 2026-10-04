import type { SupabaseClient } from "@supabase/supabase-js"

import type { Shop } from "@/components/role-provider"
import { linePromo } from "@/lib/promo"

/**
 * The printable invoice.
 *
 * Lifted out of the POS unchanged. Several screens now need to produce
 * the same document — the till, an exchange where the customer paid a
 * difference, and the Sales list when someone asks for a copy months
 * later — and a customer holding two receipts for the same shop must
 * not be looking at two different layouts.
 *
 * Everything is read back from the database by sale id rather than
 * passed in. A reprint years later then shows what was actually sold,
 * not what the product looks like in stock today.
 *
 * TWO LAYOUTS, ONE ENTRY POINT
 *
 * Settling a due is stored as a sale with no items, no revenue, and a
 * `previous_dues` figure. Printed through the ordinary invoice that
 * came out blank — "No items found", a total of zero, and the paid
 * amount alone — which told the customer nothing about what they were
 * paying off or what is left. So the layout is chosen from the record
 * itself: every caller gets the right document without deciding.
 */

export type ReceiptResult =
  | { ok: true }
  | { ok: false; reason: "popup-blocked" }
  | { ok: false; reason: "error"; error: unknown }

const esc = (v: any) =>
  v === null || v === undefined
    ? ""
    : String(v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")

/**
 * The amount written out, as the shop's invoices have always written
 * it: "TOTAL TAKA TWENTY-ONE THOUSAND NINE HUNDRED NINETY-NINE &
 * PAISA ZERO ONLY."
 *
 * Grouped in lakh and crore rather than millions. A phone over a lakh
 * is an ordinary sale here, and "ONE MILLION" on a Bangladeshi invoice
 * would read as a mistake to the person holding it.
 */
const ONES = [
  "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT",
  "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN",
  "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN",
]
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]

const under100 = (n: number): string =>
  n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")

const under1000 = (n: number): string =>
  n < 100
    ? under100(n)
    : ONES[Math.floor(n / 100)] + " HUNDRED" + (n % 100 ? " " + under100(n % 100) : "")

const wholeInWords = (n: number): string => {
  if (n === 0) return "ZERO"
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  if (crore) { parts.push(under1000(crore) + " CRORE"); n -= crore * 10000000 }
  const lakh = Math.floor(n / 100000)
  if (lakh) { parts.push(under100(lakh) + " LAKH"); n -= lakh * 100000 }
  const thousand = Math.floor(n / 1000)
  if (thousand) { parts.push(under100(thousand) + " THOUSAND"); n -= thousand * 1000 }
  if (n) parts.push(under1000(n))
  return parts.join(" ")
}

const takaInWords = (amount: any): string => {
  const value = Math.abs(Number(amount) || 0)
  const taka = Math.floor(value)
  // Rounded, not truncated: 0.005 short of a paisa is a rounding
  // artefact, and the figure printed beside this is rounded too.
  const paisa = Math.round((value - taka) * 100)
  return (
    "(IN WORD : TOTAL TAKA " +
    wholeInWords(taka) +
    " & PAISA " +
    wholeInWords(paisa) +
    " ONLY.)"
  )
}

/**
 * What the invoice promises beneath a handset's IMEI.
 *
 * One constant rather than a string buried in the row builder,
 * because this is a commitment the shop is printing and handing over:
 * when the term changes it must change in exactly one place, and be
 * findable by someone who knows only the words on the paper.
 *
 * Printed only against a real IMEI. An IMEI means a handset, and
 * handsets are what this term covers -- a data cable or a neckband
 * carries nothing of the sort, and printing it there would be a
 * promise the shop never made.
 */
const WARRANTY_NOTE = "Warranty 13 months"

const money = (n: any) => {
  const num = Number(n || 0)
  return "৳" + num.toFixed(2)
}

/**
 * A figure in the money columns of an invoice: 34,999.00.
 *
 * No taka sign and grouped in thousands, which is how the shop's own
 * invoice prints them. The sign is redundant on a document whose
 * every column is money, and at this size it was pushing
 * "৳34999.00" onto two lines in the Amount column.
 *
 * en-IN, so six figures group the way Bangladesh reads them:
 * 1,86,450.00 rather than 186,450.00.
 */
const figure = (n: any) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/** A day as the shop writes it: 28/09/2026. */
const dayStamp = (value: any) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * The Print / Download PDF bar that every printable document carries.
 *
 * Exported so the reports — Day Cashbook, Ledger, Sales History,
 * Expenses, Income, Inventory — get exactly the same controls as an
 * invoice, from one implementation rather than six drifting copies.
 *
 * Drop DOCUMENT_TOOLBAR_CSS inside the <style> block and
 * documentToolbar(name) immediately after <body>.
 */
export const DOCUMENT_TOOLBAR_CSS = `
  .doc-toolbar { position:sticky; top:0; z-index:10; display:flex; gap:8px; justify-content:flex-end;
             padding:8px 10px; margin:0 0 10px; background:#f7f7f7; border-bottom:1px solid #ddd;
             font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; }
  .doc-toolbar button { font:inherit; font-size:13px; padding:7px 14px; border-radius:6px; cursor:pointer;
                    border:1px solid #bbb; background:#fff; color:#111; }
  .doc-toolbar button.primary { background:#166534; border-color:#166534; color:#fff; font-weight:600; }
  .doc-toolbar button:disabled { opacity:0.6; cursor:default; }
  .doc-toolbar .doc-title { align-self:center; font-size:12px; font-weight:600; color:#166534; }
  .doc-toolbar .doc-pages { align-self:center; font-size:12px; color:#555; }
  .doc-toolbar .msg { margin-right:auto; align-self:center; font-size:12px; color:#444; }
  .doc-toolbar button.ghost { background:#fff; border-color:#bbb; font-weight:600; }

  /* ---------------------------------------------------------------
     THE PREVIEW LOOKS LIKE PAPER

     The document used to fill the window, so what you saw had no
     relation to what came out: a report that needed three sheets
     looked like one long page, and nothing said how many sheets it
     would cost until they were in the tray.

     So on screen the content is set to the width of the actual paper
     and laid on a grey desk, with a dashed rule and a label at every
     page boundary. It is the same trick a word processor uses, and it
     is honest -- the breaks fall where Chromium will actually put
     them, because the width they are measured at is the width it
     prints at.

     All of this is screen-only. Print sees the document exactly as
     before.
     --------------------------------------------------------------- */
  @media screen {
    body { background:#e9edf0; }
    #doc-preview { position:relative; margin:14px auto 40px; background:#fff;
                   box-shadow:0 1px 5px rgba(0,0,0,0.18); box-sizing:content-box; }
    .doc-page-break { position:absolute; left:0; right:0; height:0;
                      border-top:1px dashed #94a3b8; pointer-events:none; z-index:50; }
    .doc-page-break span { position:absolute; right:6px; top:3px; background:#e9edf0;
                           color:#475569; font:600 10px/1.3 Arial, Helvetica, sans-serif;
                           padding:1px 6px; border-radius:3px; }
  }

  @media print {
    /* The bar is chrome for the person looking at the document. It
       must never reach paper or a PDF. */
    .doc-toolbar { display:none !important; }
    /* The preview furniture is chrome too. */
    #doc-preview { width:auto !important; margin:0 !important; padding:0 !important;
                   background:transparent !important; box-shadow:none !important; }
    .doc-page-break { display:none !important; }
  }
`

/**
 * @param fileName suggested name for the saved PDF, without extension.
 * @param paper which sheet this document is for. The shop prints POS
 *   invoices on an A4 cut across the middle and everything else on a
 *   whole one, so each document says which it is rather than the app
 *   guessing from its height.
 */
export function documentToolbar(
  fileName: string,
  paper: "A4" | "HALF" = "A4",
): string {
  return `
  <style>@page { size: ${paper === "HALF" ? "A5" : "A4"}; }</style>
  <div class="doc-toolbar">
    <!-- The way out. On an iPad the app runs without browser chrome,
         so a report opened here has no back button anywhere on the
         screen and the only escape is to kill the app. -->
    <button type="button" class="ghost" id="doc-back">&#8592; Back</button>
    <!-- Says what this window is. The shop asked to see a report
         before it reaches paper, so the window has to look like a
         preview rather than something that already printed. -->
    <span class="doc-title">Preview</span>
    <span class="doc-pages" id="doc-pages"></span>
    <span class="msg" id="doc-msg"></span>
    <button type="button" id="doc-pdf">Download PDF</button>
    <!-- Printing goes straight to the printer. The dialog is still
         here for the rare job that needs a different printer or paper
         size, but it is no longer in the way of every receipt. -->
    <button type="button" id="doc-print-dialog" title="Choose a printer or paper size for this one job">Printer…</button>
    <!-- Print is the primary action: the reader has looked at the
         document and this is what they came to do. -->
    <button type="button" class="primary" id="doc-print">Print</button>
  </div>
  <script>
    (function(){
      var api = window.electronDocument;
      var msg = document.getElementById('doc-msg');
      var pdfBtn = document.getElementById('doc-pdf');
      var printBtn = document.getElementById('doc-print');
      var dialogBtn = document.getElementById('doc-print-dialog');
      var fileName = ${JSON.stringify(fileName)};

      function say(text, isError) {
        msg.textContent = text || '';
        msg.style.color = isError ? '#b91c1c' : '#444';
      }

      var isElectron = /Electron/i.test(navigator.userAgent || '');

      // -------------------------------------------------------------
      // Which paper this document is for
      //
      // The shop's rule, not a guess: POS invoices go on an A4 cut
      // across the middle, everything else on a whole sheet. Each
      // document says which it is, so a long invoice still prints on
      // the paper the shop keeps loaded for invoices rather than
      // silently changing size halfway down a stack.
      //
      // The half sheet is an A4 cut across the middle, which is A5.
      // The shop feeds it upright, so it is A5 portrait: 148 wide by
      // 210 tall.
      // -------------------------------------------------------------
      var declared = ${JSON.stringify(paper)};

      function pageSize() {
        return declared;
      }

      // -------------------------------------------------------------
      // A way back
      //
      // These documents open with window.open, which on a desktop is a
      // real second window with its own close button. Installed to an
      // iPad home screen there is no browser chrome at all: the report
      // takes over the app and the only way out is to close the whole
      // thing and start again.
      //
      // So: close the window if this IS one, and walk back through
      // history if it is not. Which of those applies cannot be known
      // in advance -- window.close() is simply ignored when the window
      // was not script-opened -- so it is tried and then checked.
      // -------------------------------------------------------------
      var backBtn = document.getElementById('doc-back');
      if (backBtn) {
        if (!window.opener) backBtn.textContent = '\u2190 Back';
        else backBtn.textContent = 'Close';

        backBtn.addEventListener('click', function () {
          try { window.close(); } catch (e) {}
          setTimeout(function () {
            if (window.closed) return;
            // Still here, so this was never a separate window.
            if (window.history.length > 1) window.history.back();
            else window.location.href = '/';
          }, 120);
        });
      }

      // -------------------------------------------------------------
      // How many sheets this is
      //
      // Measured at the width it will PRINT at, not the width of the
      // window. The same table laid out narrower is taller, because
      // rows wrap, so a count taken from the window would be wrong by
      // a page or more on a wide screen.
      // -------------------------------------------------------------
      var PAPER = { A4: { w: 718, h: 1047 }, HALF: { w: 484, h: 718 } };
      var sheet = PAPER[declared] || PAPER.A4;

      function buildPreview() {
        var bar = document.querySelector('.doc-toolbar');
        var wrap = document.createElement('div');
        wrap.id = 'doc-preview';
        wrap.style.width = sheet.w + 'px';

        // Everything that is not the toolbar or a script is the
        // document itself.
        var move = [];
        for (var i = 0; i < document.body.childNodes.length; i++) {
          var node = document.body.childNodes[i];
          if (node === bar) continue;
          if (node.nodeType === 1 && node.tagName === 'SCRIPT') continue;
          move.push(node);
        }
        for (var j = 0; j < move.length; j++) wrap.appendChild(move[j]);
        document.body.appendChild(wrap);
        return wrap;
      }

      function paginate(wrap) {
        var old = wrap.querySelectorAll('.doc-page-break');
        for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

        var height = wrap.scrollHeight;
        var pages = Math.max(1, Math.ceil((height - 2) / sheet.h));

        for (var k = 1; k < pages; k++) {
          var line = document.createElement('div');
          line.className = 'doc-page-break';
          line.style.top = (k * sheet.h) + 'px';
          var tag = document.createElement('span');
          tag.textContent = 'Page ' + (k + 1);
          line.appendChild(tag);
          wrap.appendChild(line);
        }

        var label = document.getElementById('doc-pages');
        if (label) {
          label.textContent =
            pages === 1
              ? '1 page'
              : pages + ' pages';
        }
        return pages;
      }

      // The toolbar is written immediately after <body>, so this code
      // runs BEFORE the document it is describing has been parsed.
      // Building the preview here found an empty page and reported
      // every report as one sheet, however long it was.
      function startPreview() {
        try {
          var previewWrap = buildPreview();
          paginate(previewWrap);
          // Web fonts and images land after first paint and change the
          // height, so the count is taken again once things settle.
          setTimeout(function () { paginate(previewWrap); }, 350);
          if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
            document.fonts.ready.then(function () { paginate(previewWrap); });
          }
        } catch (e) {
          // A preview that will not paginate must still print.
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPreview);
      } else {
        startPreview();
      }

      // Both buttons run the same job; they differ only in whether
      // Windows is asked which printer to use.
      function runPrint(btn, options, busyText) {
        btn.disabled = true;
        printBtn.disabled = true;
        if (dialogBtn) dialogBtn.disabled = true;
        say(busyText);
        api.print(options).then(function (r) {
          btn.disabled = false;
          printBtn.disabled = false;
          if (dialogBtn) dialogBtn.disabled = false;
          // Printed, but by the long way round: nothing on this
          // machine would take the job, so it was opened elsewhere.
          // Not an error, but the cashier has to be told where the
          // document went or they will click again.
          var paper = r && r.pageSize ? ' (' + (r.pageSize === 'HALF' ? 'half sheet' : r.pageSize) + ')' : '';
          if (r && r.ok && r.viaPdf) say(r.message || 'Opened in your PDF viewer — print it from there.');
          else if (r && r.ok && r.printer) say('Printed on ' + r.printer + paper + '.');
          else if (r && r.ok) say('Sent to the printer' + paper + '.');
          // Closing the print dialog is a decision, not a fault.
          else if (r && r.canceled) say('');
          else say((r && r.message) || 'Could not print. Check that a printer is installed and switched on.', true);
        }).catch(function (e) {
          btn.disabled = false;
          printBtn.disabled = false;
          if (dialogBtn) dialogBtn.disabled = false;
          say(String((e && e.message) || e), true);
        });
      }

      if (dialogBtn) {
        dialogBtn.addEventListener('click', function () {
          if (api && api.print) {
            runPrint(dialogBtn, { dialog: true, pageSize: pageSize() }, 'Opening the printer dialog...');
            return;
          }
          pageSize();
          window.print();
        });
      }

      printBtn.addEventListener('click', function () {
        // Routed through the main process where available: it reports
        // whether printing actually happened, which window.print()
        // does not.
        //
        // That report used to be thrown away, so a failed print — no
        // printer installed, printer offline, driver refusing — looked
        // exactly like a button that does nothing. In the packaged app
        // it IS nothing: Electron ships no browser UI, so window.print()
        // there is silently inert.
        if (api && api.print) {
          // Straight to the printer, on the paper it measured
          // itself onto. No dialog, no PDF viewer.
          runPrint(printBtn, { pageSize: pageSize() }, 'Printing...');
          return;
        }

        if (isElectron) {
          say('This window cannot reach a printer. Close it and reopen the invoice, or use Download PDF.', true);
          return;
        }

        pageSize();
        window.print();
      });

      pdfBtn.addEventListener('click', function () {
        if (!api || !api.savePdf) {
          // A browser has no Save dialog to offer. The print dialog
          // does the same job via "Microsoft Print to PDF", so say so
          // rather than leaving the button dead.
          say('Choose "Save as PDF" as the destination.');
          pageSize();
          window.print();
          return;
        }
        pdfBtn.disabled = true;
        say('Saving...');
        api.savePdf(fileName, pageSize()).then(function (r) {
          pdfBtn.disabled = false;
          if (r && r.ok) say('Saved to ' + r.path);
          else if (r && r.canceled) say('');
          else say((r && r.message) || 'Could not save the PDF.', true);
        }).catch(function (e) {
          pdfBtn.disabled = false;
          say(String(e && e.message || e), true);
        });
      });
    })();
  </script>`
}

/** Shared page chrome, so both documents print on the same letterhead. */
const PAGE_STYLES = `
  /* ---------------------------------------------------------------
     THE INVOICE, ON AN UPRIGHT HALF SHEET

     An A4 cut across the middle, fed upright: A5 portrait. Inside
     Chromium's default margins that leaves 484 x 718 px -- 128mm wide
     by 190mm tall.

     Narrow, not short. The WIDTH is the constraint, and it is what
     broke twice before: .page was once 800px on a 190mm sheet, and
     once turned on its side. Five columns still have to cross 484px.

     The sheet is FILLED rather than sized to its contents: .sheet
     grows and the footer is pushed to the bottom edge, so a one-item
     invoice and a five-item one both look like a whole document
     instead of a receipt stranded at the top of a page.

     Re-check the fit at five items after changing a size here.

     THE SIZE, AND HOW IT WAS ARRIVED AT. The old 9px item line is
     6.8pt on paper, too small to read across a counter, and the shop
     asked for twice it. Twice does not fit: the paper is an A4 cut
     in half and cannot grow with the type. Measured by rendering a
     five-item invoice and printing it to A5:

       1.0x (9px items)    615px of content   one sheet
       1.25x (11px)        612px              one sheet  <- here
       1.4x (12.5px)       688px              one sheet
       1.5x (13.5px)       682px              one sheet
       1.6x (14.5px)       727px              TWO sheets

     1.5x went out first and the shop found it bulky, so it stepped
     back to 1.25x -- still half again the size it used to be, with
     room to spare on the sheet. Content over about 700px takes a
     second one. Anything bigger than 1.5x needs the full A4, which
     is the shop's decision, not a styling one.
     --------------------------------------------------------------- */
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 8px; color:#111; background:#fff; }

  /* min-height, not height: the content may exceed one sheet and must
     flow onto a second rather than be clipped at the fold. */
  /* 478, not the 484 the margins strictly allow. Sub-pixel rounding
     in the flex row above pushed the content to 485 and put a hair of
     it past the edge of the sheet; a few pixels of slack costs
     nothing and cannot be trimmed off. */
  /* 640, not 700. At 700 the footer sat 185mm down a 190mm printable
     strip, inside Chromium's margin but past what the printer itself
     can reach -- most lasers keep 4-5mm of their own at the foot, and
     the shop's service-centre note simply did not come out. The slack
     costs nothing: the space below it was empty anyway. */
  .page { width:100%; max-width:478px; min-height:640px; margin:0 auto; padding:0;
          box-sizing:border-box; position:relative; display:flex; flex-direction:column; }
  /* Stacked above the watermark. Both were in the normal flow with
     the watermark positioned, and a positioned element paints over
     static content however pale it is -- which is why TECNO sat on
     top of Net Receivables and Dues instead of behind them. Giving
     the content its own layer settles the order explicitly. */
  .sheet { position:relative; z-index:1; flex:1 0 auto; }

  /* No rule under the letterhead: the shop's own invoice leaves the
     name and address floating above the boxes, and the first line the
     eye meets is the top of the Name box. */
  .letterhead { padding-bottom:4px; margin-bottom:6px; }
  .company { font-weight:700; font-size:19px; line-height:1.15; }
  .company small { display:block; font-weight:400; font-size:11px; margin-top:3px; color:#222; line-height:1.4; }

  /* THE HEAD OF THE INVOICE, SET OUT AS THE SHOP'S OWN
     ------------------------------------------------------------
     Name and Address in a ruled box on the left, the word INVOICE
     level with them on the right, and the invoice number and date in
     their own box underneath it, hard against the right edge. Copied
     from the invoice the shop handed over, box for box. */
  .party { display:flex; align-items:center; gap:8px; }
  .party-grid { width:64%; flex:none; border-collapse:collapse; table-layout:fixed; min-width:0; }
  .party-grid td { border:1px solid #000; padding:3px 5px; font-size:11px; vertical-align:top; word-break:break-word; }
  /* 12.5px and half the box: "Address / Contract Number" is the
     longest label on the invoice and the shop's own keeps it on one
     line. */
  .party-label { width:55%; font-size:10px; white-space:nowrap; }
  .party-value { font-weight:600; }

  .doc-kind { flex:1; text-align:right; padding-right:6px; font-weight:800; font-size:16px; letter-spacing:.5px; }

  /* Right-aligned and level with nothing above it -- on the shop's
     invoice this box hangs below the Name box, not beside it. */
  .meta-grid { width:52%; margin:5px 0 7px auto; border-collapse:collapse; table-layout:fixed; }
  .meta-grid td { border:1px solid #000; padding:2px 5px; font-size:11px; }
  .meta-label { width:52%; }
  .meta-value { text-align:center; font-weight:600; word-break:break-word; }

  .table-caption { font-size:11px; color:#555; margin-top:6px; }

  /* A full grid, not just underlines: the shop reads down the money
     columns and the rules are what keep the eye in the right one.
     table-layout:fixed stops a long product name stealing the width
     those columns need. */
  table.items { width:100%; table-layout:fixed; border-collapse:collapse; margin-top:0; font-size:11px; }
  table.items th, table.items td { border:1px solid #000; padding:3px 5px; vertical-align:top; word-break:break-word; }
  /* White, not grey: the shop's invoice rules the head off with lines
     alone and fills nothing. */
  table.items th { background:#fff; font-weight:700; font-size:11px; text-align:center; }
  table.items td { font-size:11px; color:#111; }

  /* The six columns of the shop's own invoice, in its order:
     the line number, what was sold, how many, in what unit, at what
     price, for what amount. */
  .c-sl    { width:6%;  text-align:center; }
  /* Wide enough for "Tecno/Camon 50 8+128/Titanium" on ONE line,
     which is how the shop's own invoice sets an item. */
  .c-item  { width:48%; text-align:left; }
  .c-qty   { width:8%;  text-align:center; }
  .c-unit  { width:7%;  text-align:center; }
  .c-price { width:15%; text-align:right; }
  .c-amt   { width:16%; text-align:right; }
  /* A figure never breaks across two lines: 34,999.00 in the Amount
     column was coming out as "34,999.0" over "0". */
  .c-price, .c-amt, .c-qty, td.tot-value { white-space:nowrap; word-break:normal; }

  /* The amount in words and the totals are ROWS of the same table,
     not a box under it: on the shop's invoice the column rules run
     straight down through them, and the words sit in one tall cell
     beside the figures they spell out. */
  td.words-cell { font-size:11px; line-height:1.4; vertical-align:top; }
  td.tot-label { text-align:right; font-weight:700; }
  td.tot-value { text-align:right; font-weight:700; }
  /* The gap above Dues, which the shop's invoice leaves deliberately:
     it is the figure a customer looks for first. */
  tr.tot-gap td { height:17px; }

  /* The amount in words sits beside the totals, filling the width the
     totals leave, exactly as on the shop's own invoices. */
  /* One frame, continued from the items table rather than floating
     under it: on the shop's own invoice the amount in words and the
     totals sit inside the same box as the lines they add up, and the
     rules run straight down from the table above. */
  .summary { display:flex; align-items:stretch; border:1px solid #000; border-top:0; }
  .in-words { flex:1; min-width:0; font-size:11px; line-height:1.45;
              padding:4px 5px; word-break:break-word; }
  .totals-box { width:190px; flex:none; border-left:1px solid #000; box-sizing:border-box; }
  .totals-box .line { display:flex; justify-content:space-between; gap:6px;
                      padding:2.5px 5px; font-size:11px; border-bottom:1px solid #000; }
  .totals-box .line:last-child { border-bottom:none; }
  .totals-box .bold { font-weight:700; font-size:11.5px; }

  /* Centred on the sheet itself rather than on the browser window:
     .page is the sheet, and it is the middle of that the shop means. */
  /* Centred on the sheet rather than the browser window: .page IS
     the sheet, and the middle of that is what the shop means.

     Grey, not opacity. A laser printer renders very light tints by
     dropping dots, and below roughly a tenth it can put down almost
     nothing -- which is how a watermark that is plainly there on
     screen comes off the printer invisible. #c9c9c9 at full opacity
     is a tone the driver has to halftone properly. */
  /* Sized per document, in page(): a five-letter brand and a
     nine-letter one cannot share one size on a 478px sheet. SAMSUNG
     at the old 96px was wider than the paper and came out "SAMSUN",
     with the G over the edge. The size below is the cap and the
     fallback; page() sets the real one inline. */
  .watermark { position:absolute; left:0; right:0; top:50%; transform:translateY(-50%) rotate(-20deg);
               text-align:center; color:#dcdcdc; font-size:48px; font-weight:900;
               pointer-events:none; z-index:0; letter-spacing:3px; white-space:nowrap;
               -webkit-print-color-adjust:exact; print-color-adjust:exact; }

  /* Well clear of the table, as on the shop's own invoice, where the
     signature sits about two thirds of the way down with white space
     above it. 34px put it right under the last figure, close enough
     to read as part of the totals. */
  .signature { margin-top:80px; display:flex; justify-content:flex-end; }
  .sig-box { width:150px; text-align:center; border-top:1px solid #000; padding-top:3px; font-size:11px; font-weight:600; }

  /* Sized to be read, like the shop's own. It is the line that tells
     a customer where to take a faulty handset, so it is not the place
     to save a millimetre. */
  footer { margin-top:10px; font-size:11.5px; color:#000; text-align:center; line-height:1.55; }
  footer .contact { margin-top:3px; font-size:10px; color:#333; }

  @media print {
    body { margin:0; }
    .page { padding:0; }
    /* No opacity override here any more. It used to drop the
       watermark to 6% for print only, so TECNO looked right in the
       preview and came off the printer as nothing at all -- the
       failure is invisible precisely where you would look for it.
       The grey above is chosen to print, and print is where it
       matters. */
    button { display:none; }
  }
${DOCUMENT_TOOLBAR_CSS}
`

/**
 * What the sale took through Plampay.
 *
 * Plampay is instalments: the customer pays the rest monthly to
 * Plampay, which pays the shop. The shop records it as paid, but the
 * customer has not handed it over, so their invoice must not say
 * Received for it. Matched loosely, because the method name is the
 * shop's own ("Plampay", "Palm Pay").
 */
function plampayTotal(payments: { channel?: string | null; amount?: unknown }[] | null) {
  return (payments ?? []).reduce(
    (sum, p) =>
      /^(plam|palm)\s*pay$/i.test(String(p.channel ?? "").trim())
        ? sum + (Number(p.amount) || 0)
        : sum,
    0,
  )
}

export async function openPrintableReceipt(opts: {
  supabase: SupabaseClient<any, any, any>
  saleId: number
  organizationId: string | null | undefined
  shop?: Shop | null
  autoPrint?: boolean
  closeAfterPrint?: boolean
}): Promise<ReceiptResult> {
  const { supabase, saleId, organizationId, shop } = opts
  const autoPrint = !!opts.autoPrint
  const closeAfterPrint = !!opts.closeAfterPrint

  try {
    const [{ data: sale }, { data: cust }, { data: items }, { data: payments }] = await Promise.all([
      supabase
        .from("sales")
        .select("*")
        .eq("id", saleId)
        .eq("organization_id", organizationId)
        .single(),
      supabase
        .from("sale_customers")
        .select("*")
        .eq("sales_id", saleId)
        .eq("organization_id", organizationId)
        .single(),
      supabase
        .from("sold_products")
        .select("*")
        .eq("sales_id", saleId)
        .eq("organization_id", organizationId),
      supabase
        .from("sale_payments")
        .select("channel, amount")
        .eq("sales_id", saleId)
        .eq("organization_id", organizationId),
    ])

    // A settlement sells nothing, is worth nothing, and carries the
    // balance it was paid against. Nothing else in this system looks
    // like that.
    const isDuePayment =
      (items?.length ?? 0) === 0 &&
      Number(sale?.total_amount ?? 0) === 0 &&
      Number(sale?.previous_dues ?? 0) > 0

    const html = isDuePayment
      ? await buildDuePaymentHtml({
          supabase,
          organizationId,
          shop,
          sale,
          cust,
          saleId,
          autoPrint,
          closeAfterPrint,
        })
      : buildInvoiceHtml({
          shop,
          sale,
          cust,
          items,
          saleId,
          autoPrint,
          closeAfterPrint,
          plampayAmount: plampayTotal(payments),
        })

    const w = window.open("", "_blank")
    if (!w) {
      // Never fail silently here. The cashier has taken the money and is
      // waiting to hand over a receipt — saying nothing looks exactly
      // like a receipt that printed. The caller reports it.
      return { ok: false, reason: "popup-blocked" }
    }
    w.document.write(html)
    w.document.close()
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: "error", error }
  }
}

// ------------------------------------------------------------------
// The ordinary sale invoice — unchanged from the POS
// ------------------------------------------------------------------

function buildInvoiceHtml(args: {
  shop?: Shop | null
  sale: any
  cust: any
  items: any[] | null
  saleId: number
  autoPrint: boolean
  closeAfterPrint: boolean
  /** Taken through Plampay — kept off Received. See plampayTotal. */
  plampayAmount?: number
}) {
  const { shop, sale, cust, items, saleId, autoPrint, closeAfterPrint } = args

  // What identifies this invoice: the heading line, the window title,
  // and the name it saves under.
  //
  // This was the first item's IMEI. Every line in the table below
  // already prints its own IMEI, so the header repeated one of them
  // while the invoice number — the only identifier that is unique per
  // shop — appeared nowhere on the document at all. On a sale of two
  // handsets it also singled out the first for no reason.
  const invoiceNo =
    sale?.invoice_number || `CVSL-${String(saleId).padStart(6, "0")}`

  const dateStr = dayStamp(sale?.sale_date || sale?.created_at || Date.now())

  // build rows with IMEI / EAN on second line for item column (if present)
  const rows =
    (items || [])
      .map((it: any, idx: number) => {
        const imeiOrCode = esc(it.imei || it.barcode || it.ean || "")
        const color = esc(it.color || "")
        // The configuration the customer actually bought. Read from
        // the sale line, not from inventory, so a reprint years
        // later still shows what was sold rather than what is in
        // stock today.
        const variantLabel = esc(it.variant || "")
        const qty = Number(it.quantity || 0)
        // A gift's Unit price is what it fills the totals math with,
        // not what the customer should read off the paper — the GIFT
        // badge already says what it is, and printing ৳50.00 next to
        // ৳0.00 looks like a struck-through discount rather than a
        // plain freebie. Zeroed for display only; unit_price itself is
        // untouched everywhere it is used for anything but this line.
        const unit = it.is_gift ? figure(0) : figure(it.unit_price)
        // The line's full price, Price × Qty. The discount is shown
        // once, in the totals below; taking it off here as well made
        // the line read 36,999 under a Total of 38,999. A gift stays
        // 0, the same as its Price column.
        const total = it.is_gift ? figure(0) : figure(Number(it.unit_price || 0) * qty)
        // A real IMEI, not the barcode that stands in for one above:
        // only a handset gets the warranty line.
        const hasImei = !!String(it.imei || "").trim()

        // ONE LINE, THE WAY THE SHOP WRITES IT
        //
        //   Tecno/Camon 50 8+128/Titanium
        //   Poly/Ultrapods Max/Black
        //
        // Brand, then what it is, then the colour, separated by
        // slashes — which is what the column heading has always
        // promised: Item/Model/Color. The model number sits with the
        // product name because that is how the counter says it:
        // "Camon 50", not "Camon" on one line and "50" on another.
        // Anything the sale did not record simply drops out, so an
        // accessory with no variant reads as two parts, not three.
        const describe = [
          esc(it.brand || ""),
          [esc(it.product_name || ""), esc(it.model_number || ""), esc(it.variant || "")]
            .filter(Boolean)
            .join(" "),
          color,
        ]
          .filter(Boolean)
          .join("/")

        return `
            <tr>
              <td class="c-sl">${idx + 1}</td>
              <td class="c-item"><div style="line-height:1.15;">${describe}${
          it.is_gift
            ? ` <span style="font-size:9px;font-weight:700;color:#166534;background:#dcfce7;border-radius:3px;padding:0 3px;vertical-align:middle;">GIFT</span>`
            : ""
        }</div>${
          imeiOrCode
            ? `<div style="font-size:10px;color:#333;margin-top:1px;">${imeiOrCode}</div>`
            : ""
        }${
          hasImei
            ? `<div style="font-size:10px;color:#333;margin-top:1px;font-weight:600;">${esc(
                WARRANTY_NOTE,
              )}</div>`
            : ""
        }</td>
              <td class="c-qty">${qty.toFixed(2)}</td>
              <td class="c-unit">PC</td>
              <td class="c-price">${unit}</td>
              <td class="c-amt">${total}</td>
            </tr>`
      })
      .join("") ||
    `<tr><td colspan="6" style="padding:14px;text-align:center;color:#666;">No items found</td></tr>`

  // totals
  const rawSubtotal = sale?.subtotal ?? sale?.sub_total ?? 0
  const rawDiscount = sale?.total_discount ?? sale?.discount ?? 0
  const previousDues = sale?.previous_dues ?? 0
  const grandTotal =
    sale?.total_amount ?? sale?.grand_total ?? rawSubtotal - rawDiscount + previousDues
  const received = sale?.total_received ?? sale?.received ?? 0
  const dues =
    sale?.due_amount ?? sale?.remaining_due ?? Math.max(0, grandTotal - received)

  // A gift is not a markdown the customer should be able to read a
  // rate off — it is meant to look like exactly what it is, a free
  // item, not a discounted one. Its price appears equally in
  // rawSubtotal and rawDiscount (a gift's discount always equals its
  // price), so removing the same figure from both here takes the line
  // out of what is SHOWN without moving Net Receivables by a poisha:
  // nothing about what the customer is actually charged changes, only
  // what the page displays as "Total" and "Discount".
  const giftValue = (items || []).reduce(
    (sum: number, it: any) =>
      it.is_gift ? sum + Number(it.unit_price || 0) * Number(it.quantity || 0) : sum,
    0,
  )
  // The supplier's promo is stored inside the discount (it did come off
  // what the customer paid) but it is not the shop's discount: the
  // supplier pays it back. So it gets its own row, and the Discount row
  // shows only what the shop gave. Net Receivables does not move.
  const promoValue = (items || []).reduce(
    (sum: number, it: any) => (it.is_gift ? sum : sum + linePromo(it)),
    0,
  )
  const subtotal = rawSubtotal - giftValue
  const discount = rawDiscount - giftValue - promoValue

  // The Amount column already has each line's discount taken off, so
  // without this row a discounted invoice contradicts itself: the
  // lines add up to one figure and Total states another, with nothing
  // to explain the gap. A customer given a 149 taka neckband free sees
  // Amount 0.00 against a Total that still counts the 149.
  //
  // Only shown when there is a discount, so an ordinary sale prints
  // exactly as it always has. A sale that was ONLY a gift now has
  // discount === 0 here, which is the whole point of this feature.
  // THE FOOT OF THE TABLE, AS THE SHOP SETS IT
  //
  // Total, Net Receivables, Received, a deliberate gap, then Dues —
  // the figure a customer looks for first, which is why the shop's
  // own invoice leaves air above it. Discount and Previous Dues join
  // the list only when there is one, exactly as before.
  //
  // Each is a row of the items table, so the column rules run down
  // through them, and the amount in words fills one tall cell on the
  // left. That cell's rowspan has to match however many rows end up
  // below, so the list is built first and counted.
  const totalRows: Array<{ label: string; value: string; gap?: boolean }> = [
    { label: "Total", value: figure(subtotal) },
  ]
  if (Number(discount) > 0.005) totalRows.push({ label: "Discount (-)", value: figure(discount) })
  if (promoValue > 0) totalRows.push({ label: "Supplier Promo (-)", value: figure(promoValue) })
  if (Number(previousDues) > 0)
    totalRows.push({ label: "Previous Dues", value: figure(previousDues) })
  totalRows.push({ label: "Net Receivables:", value: figure(grandTotal) })
  // Only what the customer handed over: the Plampay part is paid to
  // Plampay monthly, not to the shop at the counter.
  totalRows.push({
    label: "Received:",
    value: figure(Math.max(0, Number(received) - (args.plampayAmount ?? 0))),
  })
  totalRows.push({ label: "Dues:", value: figure(dues), gap: true })

  const words = esc(takaInWords(subtotal))
  const totalsRows = totalRows
    .map((r, i) => {
      const gapRow = r.gap
        ? `
            <tr class="tot-gap"><td colspan="3"></td><td></td></tr>`
        : ""
      const wordsCell =
        i === 0
          ? `<td class="words-cell" colspan="2" rowspan="${
              totalRows.length + totalRows.filter((x) => x.gap).length
            }">${words}</td>`
          : ""
      return `${gapRow}
            <tr>${wordsCell}
              <td class="tot-label" colspan="3">${esc(r.label)}</td>
              <td class="tot-value">${r.value}</td>
            </tr>`
    })
    .join("")

  return page({
    shop,
    docTitle: invoiceNo,
    heading: "INVOICE",
    metaRows: [
      { label: "Invoice no:", value: invoiceNo },
      { label: "Invoice Date:", value: dateStr },
    ],
    cust,
    tableHead: `
          <th class="c-sl"></th>
          <th class="c-item">Item/Model/Color</th>
          <th class="c-qty">Qty</th>
          <th class="c-unit">Unit</th>
          <th class="c-price">Price</th>
          <th class="c-amt">Amount</th>`,
    tableBody: rows,
    totals: "",
    totalsRows,
    autoPrint,
    closeAfterPrint,
  })
}

// ------------------------------------------------------------------
// The due-payment receipt
// ------------------------------------------------------------------

async function buildDuePaymentHtml(args: {
  supabase: SupabaseClient<any, any, any>
  organizationId: string | null | undefined
  shop?: Shop | null
  sale: any
  cust: any
  saleId: number
  autoPrint: boolean
  closeAfterPrint: boolean
}) {
  const { supabase, organizationId, shop, sale, cust, saleId, autoPrint, closeAfterPrint } =
    args

  const inv = sale?.invoice_number || `PAY-${String(saleId).padStart(6, "0")}`
  const dateStr = new Date(
    sale?.sale_date || sale?.created_at || Date.now()
  ).toLocaleDateString()

  // On a per-purchase payment (settle_sale_due) `previous_dues` is what
  // was owed ON THAT PURCHASE. On an older account-wide one
  // (settle_customer_due) it is the whole balance. Both work out the
  // same way here.
  const previousBalance = Number(sale?.previous_dues ?? 0)
  const paidNow = Number(sale?.total_received ?? 0)
  // Worked out from this record, NOT from customers.dues. The live
  // balance moves with every later payment, so reading it here would
  // make a reprint contradict the copy the customer was handed.
  const remaining = Math.max(0, Number((previousBalance - paidNow).toFixed(2)))
  // Stored at the time for the same reason.
  const accountAfter =
    sale?.balance_after === null || sale?.balance_after === undefined
      ? null
      : Number(sale.balance_after)
  const settledSaleId = sale?.settled_sale_id ?? null

  // What the money went through, so a bank payment can be traced back
  // from the customer's copy.
  const { data: payLines } = await supabase
    .from("sale_payments")
    .select("method, bank_name, channel, amount")
    .eq("sales_id", saleId)
    .eq("organization_id", organizationId)

  const routeLabel =
    (payLines ?? []).length > 0
      ? (payLines ?? [])
          .map((l: any) => {
            const where = [l.bank_name, l.channel].filter(Boolean).join(" - ")
            const how = where || (l.method === "cash" ? "Cash" : l.method)
            return `${how} ${money(l.amount)}`
          })
          .join(", ")
      : sale?.payment_method || ""

  // The purchase this payment was for. Without it the receipt says
  // only that money was handed over, which is what made the old one
  // useless: the customer could not tell what they were paying off.
  // net_amount is what the goods on that purchase cost. total_amount
  // also carries any older balance rolled onto the sale, so it would
  // print a 5,000 handset as a 25,000 purchase.
  const SELECT_PURCHASE = `id, invoice_number, sale_date, net_amount, total_amount, previous_dues,
     credit_amount, due_settled,
     sold_products ( product_name, model_number, variant, color, barcode, quantity, unit_price, total_price )`

  let dueRows: any[] = []

  if (settledSaleId) {
    // The normal case: one payment, one named purchase.
    const { data: one } = await supabase
      .from("sales")
      .select(SELECT_PURCHASE)
      .eq("organization_id", organizationId)
      .eq("id", settledSaleId)
      .maybeSingle()

    if (one) dueRows = [one]
  } else {
    // Payments taken before dues became per-purchase carry no link, so
    // their reprints still list the whole account. Dropping this would
    // turn every historical receipt blank again.
    const customerId = cust?.customer_id ?? null

    if (customerId) {
      const { data: theirSales } = await supabase
        .from("sale_customers")
        .select("sales_id")
        .eq("organization_id", organizationId)
        .eq("customer_id", customerId)

      const ids = (theirSales ?? []).map((r: any) => r.sales_id).filter(Boolean)

      if (ids.length > 0) {
        const { data: outstanding } = await supabase
          .from("sales")
          .select(SELECT_PURCHASE)
          .eq("organization_id", organizationId)
          .in("id", ids)
          .gt("credit_amount", 0)
          .order("sale_date", { ascending: true })

        dueRows = outstanding ?? []
      }
    }
  }

  /**
   * How much has been paid on a purchase, as at this receipt.
   *
   * For the purchase this payment was for, it is worked out entirely
   * from this payment's own record — the balance before, plus what was
   * just handed over — so a reprint after further payments still shows
   * what the customer was told at the counter. Reading the live
   * due_settled instead would make the paper and the reprint disagree.
   *
   * On a legacy account-wide payment there is no such link, so all it
   * can honestly report is what was paid when the goods were bought.
   */
  const paidOn = (s: any) => {
    // Same fallback the database uses: rows predating net_amount
    // would otherwise print a purchase total of zero.
    const goods =
      Number(s.net_amount || 0) > 0
        ? Number(s.net_amount)
        : Math.max(0, Number(s.total_amount || 0) - Number(s.previous_dues || 0))
    if (settledSaleId && s.id === settledSaleId) {
      return Math.max(0, Number((goods - previousBalance + paidNow).toFixed(2)))
    }
    return Math.max(
      0,
      Number(
        (goods - (Number(s.credit_amount || 0) - Number(s.due_settled || 0))).toFixed(2)
      )
    )
  }

  const rows =
    dueRows
      .map((s: any, idx: number) => {
        const when = new Date(s.sale_date || Date.now()).toLocaleDateString()
        const products = (s.sold_products ?? []) as any[]
        const productHtml =
          products.length > 0
            ? products
                .map((p) => {
                  const bits = [p.variant, p.color].filter(Boolean).join(" · ")
                  const code = p.barcode ? `<span style="color:#666;"> · ${esc(p.barcode)}</span>` : ""
                  return `<div style="margin-top:3px;">
                      <span style="font-weight:600;">${esc(p.product_name || "")}</span>
                      <span style="color:#333;"> × ${Number(p.quantity || 0)} @ ${money(
                    p.unit_price
                  )}</span>
                      ${bits ? `<div style="font-size:14px;color:#333;">${esc(bits)}${code}</div>` : code}
                    </div>`
                })
                .join("")
            : `<div style="color:#666;font-size:15px;margin-top:3px;">No item details recorded</div>`

        return `
            <tr>
              <td style="width:5%;">${idx + 1}</td>
              <td style="width:20%;">
                <div style="font-weight:600;">${esc(s.invoice_number || `#${s.id}`)}</div>
                <div style="font-size:14px;color:#333;">${esc(when)}</div>
              </td>
              <td style="width:47%;">${productHtml}</td>
              <td style="width:14%;text-align:right">${money(
                Number(s.net_amount || 0) > 0
                  ? Number(s.net_amount)
                  : Math.max(0, Number(s.total_amount || 0) - Number(s.previous_dues || 0))
              )}</td>
              <td style="width:14%;text-align:right">${money(
                paidOn(s)
              )}</td>
            </tr>`
      })
      .join("") ||
    `<tr><td colspan="5" style="padding:18px;text-align:center;color:#666;">
       No credit purchases recorded for this customer.
     </td></tr>`

  // A per-purchase payment talks about that purchase; an older
  // account-wide one talks about the whole balance. Saying "Balance
  // Remaining" for a figure that is only one purchase's would have the
  // customer believe they owed nothing else.
  const totals = `
      <div class="line"><div>${
        settledSaleId ? "Owing on this purchase" : "Previous Balance"
      }</div><div>${money(previousBalance)}</div></div>
      <div class="line"><div>Paid Now</div><div>${money(paidNow)}</div></div>
      <div class="line bold"><div>${
        settledSaleId ? "Left on this purchase" : "Balance Remaining"
      }</div><div>${money(remaining)}</div></div>
      ${
        settledSaleId && accountAfter !== null
          ? `<div class="line" style="border-top:1px solid #ddd;margin-top:4px;padding-top:8px;">
               <div>Total account balance</div><div>${money(accountAfter)}</div>
             </div>`
          : ""
      }
      ${
        routeLabel
          ? `<div class="line" style="border-top:1px solid #ddd;margin-top:4px;padding-top:8px;">
               <div>Paid by</div><div style="text-align:right;max-width:150px;">${esc(routeLabel)}</div>
             </div>`
          : ""
      }`

  return page({
    shop,
    docTitle: inv,
    heading: "PAYMENT RECEIPT",
    metaRows: [
      { label: "Receipt no:", value: inv },
      { label: "Payment Date:", value: dateStr },
    ],
    cust,
    tableCaption:
      dueRows.length === 0
        ? ""
        : settledSaleId
          ? "The purchase this payment was made against"
          : "Purchases taken on credit. The balance outstanding is shown below.",
    tableHead: `
          <th style="width:5%;">SL #</th>
          <th style="width:20%;">Invoice / Date</th>
          <th style="width:47%;">Items</th>
          <th style="width:14%; text-align:right">Sale Total</th>
          <th style="width:14%; text-align:right">Paid</th>`,
    tableBody: rows,
    totals,
    autoPrint,
    closeAfterPrint,
  })
}

// ------------------------------------------------------------------
// The page both layouts print on
// ------------------------------------------------------------------

function page(args: {
  shop?: Shop | null
  /**
   * Names the document: the window caption, and the filename offered
   * when it is saved.
   *
   * Both routes to a PDF read it — Electron's own Save dialog is
   * handed it explicitly, and printing to a PDF driver (Foxit,
   * Microsoft Print to PDF) takes the browser's <title>. Anything that
   * sets only one of the two leaves the other naming files by
   * whatever the title happened to be.
   */
  docTitle: string
  heading: string
  metaRows: Array<{ label: string; value: string }>
  cust: any
  tableCaption?: string
  /** The Total written out in words, printed beside the totals. */
  amountInWords?: string
  tableHead: string
  tableBody: string
  totals: string
  /**
   * The totals as ROWS of the items table, the way the shop's own
   * invoice sets them: the words in one tall cell on the left, each
   * figure on the right, with the column rules running straight down
   * from the lines above. When this is given, `totals` and
   * `amountInWords` are not used — the caller has already put them
   * both in here.
   *
   * The money receipt does not pass it and keeps the box underneath.
   */
  totalsRows?: string
  autoPrint: boolean
  closeAfterPrint: boolean
}) {
  const {
    shop,
    docTitle,
    heading,
    metaRows,
    cust,
    tableCaption,
    amountInWords,
    tableHead,
    tableBody,
    totals,
    totalsRows,
    autoPrint,
    closeAfterPrint,
  } = args

  // Company details come from the shop record, so every shop prints
  // its own header rather than one hard-coded identity.
  const companyName = esc(shop?.name || "Shop")
  const phones = [shop?.phone, shop?.phone_secondary].filter(Boolean).join(", ")
  const companyAddressLines = [
    shop?.address || "",
    phones ? `Mobile: ${phones}` : "",
  ].filter(Boolean)

  const footerBanglaLine = esc(shop?.receipt_footer_bn || "")
  const footerContactNote = esc(
    shop?.receipt_footer_en ||
      (phones ? `If you find any issue in this invoice, contact: ${phones}` : "")
  )

  // Upper case, because that is how the shop writes a customer's
  // name on the invoices it hands over. Done here rather than in the
  // database: it is a printing convention, and the name is still
  // stored the way it was typed.
  const customerName = esc(
    String(cust?.customer_name || cust?.name || "").toUpperCase(),
  )
  const customerAddress = esc(
    cust?.customer_address || cust?.address || cust?.contract_number || "",
  )

  // Large faint brand text across the middle of the page.
  const watermarkText = esc(shop?.receipt_watermark || "")

  // Half what it was, and stepped down further when the name is long
  // enough to reach the edge of the paper. 0.8em is about what an
  // upper-case letter of this face takes at weight 900 including its
  // tracking; 430px is the sheet less a comfortable margin.
  const watermarkSize = Math.max(
    24,
    Math.min(48, Math.round(430 / Math.max(1, watermarkText.length) / 0.8)),
  )

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(docTitle)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${PAGE_STYLES}</style>
</head>
<body>
  ${documentToolbar(docTitle, "HALF")}

  <div class="page">
    ${
      watermarkText
        ? `<div class="watermark" style="font-size:${watermarkSize}px">${watermarkText}</div>`
        : ""
    }

    <div class="sheet">
      <div class="letterhead" role="banner">
        <div class="company">${companyName}</div>
        <small class="company-address">
          ${companyAddressLines.map((l) => `<div>${esc(l)}</div>`).join("")}
        </small>
      </div>

      <div class="party">
        <table class="party-grid" role="presentation">
          <tr>
            <td class="party-label">Name</td>
            <td class="party-value">${customerName}</td>
          </tr>
          <tr>
            <td class="party-label">Address / Contract Number</td>
            <td class="party-value">${customerAddress}${
              cust?.customer_phone ? " - " + esc(cust.customer_phone) : ""
            }</td>
          </tr>
        </table>

        <div class="doc-kind">${esc(heading)}</div>
      </div>

      <table class="meta-grid" role="presentation">
        ${metaRows
          .map(
            (r) =>
              `<tr><td class="meta-label">${esc(r.label)}</td><td class="meta-value">${esc(
                r.value,
              )}</td></tr>`,
          )
          .join("")}
      </table>

      ${
        tableCaption
          ? `<div class="table-caption">${esc(tableCaption)}</div>`
          : ""
      }

      <table class="items" role="table" aria-label="Items">
        <thead>
          <tr>${tableHead}
          </tr>
        </thead>
        <tbody>
          ${tableBody}${totalsRows ?? ""}
        </tbody>
      </table>

      ${
        totalsRows
          ? ""
          : `<div class="summary">
        <div class="in-words">${amountInWords ? esc(amountInWords) : ""}</div>
        <div class="totals-box" role="complementary" aria-label="Totals">${totals}
        </div>
      </div>`
      }

      <div class="signature">
        <div class="sig-box">Authorised Signature</div>
      </div>
    </div>

    <footer>
      ${footerBanglaLine ? `<div>${footerBanglaLine}</div>` : ""}
      ${footerContactNote ? `<div class="contact">${footerContactNote}</div>` : ""}
    </footer>
  </div>

  <script>
    (function(){
      try {
        var api = window.electronDocument;
        var auto = ${autoPrint ? "true" : "false"};
        var closeAfter = ${closeAfterPrint ? "true" : "false"};
        if (auto) {
          setTimeout(function () {
            // Through the toolbar button rather than around it, so an
            // automatic print reports a failure exactly the way a
            // pressed one does. A receipt that silently did not print
            // is the one thing a counter must not be left guessing at.
            var btn = document.getElementById('doc-print');
            if (btn) btn.click();
            else if (api && api.print) api.print();
            else window.print();
            if (closeAfter) setTimeout(function () { window.close(); }, 600);
          }, 400);
        }
      } catch(e){
        console.error(e);
      }
    })();
  </script>
</body>
</html>`
}
