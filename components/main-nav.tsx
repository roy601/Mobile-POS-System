"use client";

import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

const navItems: NavItem[] = [
  {
    href: "/data-sync",
    // Renamed from "Data Sync": nothing syncs yet, and the old label
    // implied an offline safety net the app does not have.
    label: "System",
  },
  { href: "/pos", label: "POS" },
  { href: "/expenses", label: "Expenses" },
  { href: "/income", label: "Income" },
  { href: "/sales", label: "Sales" },
  { href: "/inventory", label: "Inventory" },
  { href: "/customers", label: "Customers" },
  { href: "/returns", label: "Returns" },
  { href: "/purchases", label: "Purchases" },
  { href: "/analytics", label: "Day Cashbook" },
  { href: "/bank-info", label: "Bank Info" },
  { href: "/ledger", label: "Ledger" },
  { href: "/settings", label: "Settings" },
];

type GliderRect = { left: number; width: number } | null;

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();

  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const activeIndex = navItems.findIndex((item) => item.href === pathname);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<GliderRect>(null);

  // Whether there is anything off either end.
  //
  // Thirteen destinations do not fit on a 1280-wide till, and the bar
  // has always scrolled — but the scrollbar is hidden to keep the
  // capsule clean, so a clipped bar looked broken rather than
  // scrollable. Nobody found the rest of the menu.
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const readScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // A pixel of slack: sub-pixel widths leave scrollLeft a hair short
    // of the maximum and the right arrow would never switch off.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  const nudge = (direction: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  };

  // The pill sits behind whichever item the pointer is over, and falls back
  // to the current page when the pointer leaves.
  const target = hoverIndex ?? (activeIndex >= 0 ? activeIndex : null);
  const onActive = target !== null && target === activeIndex;

  const measure = useCallback(() => {
    if (target === null) {
      setRect(null);
      return;
    }
    const el = itemRefs.current[target];
    if (!el) {
      setRect(null);
      return;
    }
    // offsetLeft is relative to the padded track, so a scrolled bar keeps
    // the pill aligned with its label instead of drifting.
    setRect({ left: el.offsetLeft, width: el.offsetWidth });
  }, [target]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    // Labels shift once the real font lands and again whenever the window
    // is resized, and either would leave the pill measuring stale geometry.
    const onResize = () => {
      measure();
      readScroll();
    };
    window.addEventListener("resize", onResize);

    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => {
      if (!cancelled) {
        measure();
        readScroll();
      }
    });

    // The window is not the only thing that changes the bar's width —
    // a wider shop name in the corner does too, and no resize event
    // fires for that.
    const el = listRef.current;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            measure();
            readScroll();
          })
        : null;
    if (el && observer) observer.observe(el);

    readScroll();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [measure, readScroll]);

  // Keep the current page in view when the bar is too narrow to show
  // every item at once.
  useEffect(() => {
    if (activeIndex < 0) return;
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeIndex]);

  return (
    <nav
      aria-label="Main"
      className={cn("relative min-w-0", className)}
      {...props}
    >
      <div
        ref={listRef}
        onScroll={readScroll}
        onMouseLeave={() => setHoverIndex(null)}
        className={cn(
          "nav-capsule relative flex items-center gap-1 overflow-x-auto",
          // Centred while everything fits, edge to edge when it does
          // not. A fixed centred bar on a narrow till wasted space on
          // both sides AND still clipped.
          "mx-auto w-fit max-w-full",
          "rounded-full p-1.5 xl:p-2"
        )}
      >
        {rect && (
          <span
            aria-hidden
            className={cn(
              // left-0 is what puts the pill under its word. Without it
              // an absolutely positioned child of a flex container starts
              // at the container's content box — after the padding — so
              // translateX(offsetLeft), which is measured from the
              // padding edge, landed the pill a whole padding (6px, 8px
              // on wide tills) to the right of the label it belonged to.
              "nav-glider pointer-events-none absolute left-0 top-1.5 bottom-1.5 rounded-full xl:top-2 xl:bottom-2",
              onActive ? "nav-glider-active" : "nav-glider-hover"
            )}
            style={{
              transform: `translateX(${rect.left}px)`,
              width: rect.width,
            }}
          />
        )}

        {navItems.map((item, i) => {
          const isActive = i === activeIndex;
          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              aria-current={isActive ? "page" : undefined}
              onMouseEnter={() => setHoverIndex(i)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
              className={cn(
                // Fixed height with flex centring rather than padding plus an
                // inherited line-height: the text box is then centred on the
                // pill by layout instead of by whatever leading it inherits.
                // Sized down a step on narrower tills so more of the
                // thirteen destinations fit before anything has to
                // scroll at all.
                "relative z-[1] flex h-[34px] shrink-0 items-center justify-center xl:h-[38px]",
                "whitespace-nowrap rounded-full px-2.5 leading-none xl:px-3.5",
                "text-[13.5px] font-medium transition-colors duration-200 xl:text-[14.5px]",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                // White only while the pill is actually sitting under it.
                // The pill follows the pointer, so a hardcoded white left
                // the current page invisible whenever another item was
                // hovered.
                isActive
                  ? cn(
                      "font-semibold",
                      onActive ? "text-primary-foreground" : "text-foreground"
                    )
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Only when there is something off that end. A bar that fits
          shows nothing at all, which is most of the time on a wide
          monitor. */}
      {canLeft && (
        <NavArrow side="left" onClick={() => nudge(-1)} />
      )}
      {canRight && (
        <NavArrow side="right" onClick={() => nudge(1)} />
      )}
    </nav>
  );
}

/**
 * A hint that the bar goes on, and a way to follow it.
 *
 * Sits over the capsule's edge rather than beside it, so it costs no
 * width on a till that has none to spare. The gradient behind it fades
 * the labels out instead of chopping them off mid-word, which is what
 * made a clipped bar look broken rather than scrollable.
 */
function NavArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Scroll navigation left" : "Scroll navigation right"}
      onClick={onClick}
      className={cn(
        "absolute inset-y-0 z-[2] flex w-10 items-center",
        side === "left"
          ? "left-0 justify-start rounded-l-full pl-1.5"
          : "right-0 justify-end rounded-r-full pr-1.5",
        "text-muted-foreground transition-colors hover:text-foreground",
      )}
      style={{
        backgroundImage: `linear-gradient(to ${
          side === "left" ? "right" : "left"
        }, hsl(var(--card)) 45%, transparent)`,
      }}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
