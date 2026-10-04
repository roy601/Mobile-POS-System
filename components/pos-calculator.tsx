"use client"

import { useCallback, useEffect, useState } from "react"
import { Delete } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface POSCalculatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Floating point leaves 0.1 + 0.2 as 0.30000000000000004, which is the
 * kind of number nobody wants read out at a till. Twelve significant
 * digits is well beyond any price this shop handles and clears the noise.
 */
const tidy = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n)

/** Thousand separators for reading; the raw string stays the source of truth. */
function forDisplay(raw: string) {
  if (raw === "Error") return raw
  const negative = raw.startsWith("-")
  const body = negative ? raw.slice(1) : raw
  const [whole, fraction] = body.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const out = fraction === undefined ? grouped : `${grouped}.${fraction}`
  return negative ? `-${out}` : out
}

export function POSCalculator({ open, onOpenChange }: POSCalculatorProps) {
  const [display, setDisplay] = useState("0")
  const [previousValue, setPreviousValue] = useState<number | null>(null)
  const [operation, setOperation] = useState<string | null>(null)
  const [waitingForOperand, setWaitingForOperand] = useState(false)

  const errored = display === "Error"

  const clear = useCallback(() => {
    setDisplay("0")
    setPreviousValue(null)
    setOperation(null)
    setWaitingForOperand(false)
  }, [])

  const inputNumber = useCallback(
    (num: string) => {
      if (errored) {
        setDisplay(num)
        setPreviousValue(null)
        setOperation(null)
        setWaitingForOperand(false)
        return
      }
      if (waitingForOperand) {
        setDisplay(num)
        setWaitingForOperand(false)
      } else {
        // Without a ceiling the display grows until it overflows its box,
        // which the old version hid with overflow-hidden.
        setDisplay((d) => (d.replace(/[-.]/g, "").length >= 12 ? d : d === "0" ? num : d + num))
      }
    },
    [errored, waitingForOperand]
  )

  const calculate = (first: number, second: number, op: string) => {
    switch (op) {
      case "+":
        return tidy(first + second)
      case "-":
        return tidy(first - second)
      case "×":
        return tidy(first * second)
      case "÷":
        // Dividing by zero used to put "Infinity" on the display.
        return second === 0 ? Number.NaN : tidy(first / second)
      default:
        return second
    }
  }

  const inputOperation = useCallback(
    (nextOperation: string) => {
      if (errored) return
      const inputValue = Number.parseFloat(display)

      if (previousValue === null) {
        setPreviousValue(inputValue)
      } else if (operation && !waitingForOperand) {
        const newValue = calculate(previousValue, inputValue, operation)
        if (Number.isNaN(newValue)) {
          setDisplay("Error")
          setPreviousValue(null)
          setOperation(null)
          return
        }
        setDisplay(String(newValue))
        setPreviousValue(newValue)
      }

      setWaitingForOperand(true)
      setOperation(nextOperation)
    },
    [display, errored, operation, previousValue, waitingForOperand]
  )

  const performCalculation = useCallback(() => {
    if (errored) return
    const inputValue = Number.parseFloat(display)

    if (previousValue !== null && operation) {
      const newValue = calculate(previousValue, inputValue, operation)
      setDisplay(Number.isNaN(newValue) ? "Error" : String(newValue))
      setPreviousValue(null)
      setOperation(null)
      setWaitingForOperand(true)
    }
  }, [display, errored, operation, previousValue])

  const clearEntry = useCallback(() => setDisplay("0"), [])

  const backspace = useCallback(() => {
    if (errored) {
      clear()
      return
    }
    setDisplay((d) => (d.length <= 1 || (d.length === 2 && d.startsWith("-")) ? "0" : d.slice(0, -1)))
  }, [clear, errored])

  const inputDecimal = useCallback(() => {
    if (errored) return
    if (waitingForOperand) {
      setDisplay("0.")
      setWaitingForOperand(false)
    } else {
      setDisplay((d) => (d.includes(".") ? d : d + "."))
    }
  }, [errored, waitingForOperand])

  const percentage = useCallback(() => {
    if (errored) return
    setDisplay((d) => String(tidy(Number.parseFloat(d) / 100)))
  }, [errored])

  const toggleSign = useCallback(() => {
    if (errored) return
    setDisplay((d) => (d === "0" ? d : d.startsWith("-") ? d.slice(1) : "-" + d))
  }, [errored])

  // Start clean each time it is opened, rather than resuming a sum from
  // whichever customer was being served an hour ago.
  useEffect(() => {
    if (open) clear()
  }, [open, clear])

  /**
   * A till has a keyboard and a numeric keypad; making the staff mouse
   * every digit was the slowest thing about this dialog.
   */
  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return

      const k = e.key
      if (k >= "0" && k <= "9") inputNumber(k)
      else if (k === "." || k === ",") inputDecimal()
      else if (k === "+" || k === "-") inputOperation(k)
      else if (k === "*" || k === "x" || k === "X") inputOperation("×")
      else if (k === "/") inputOperation("÷")
      else if (k === "%") percentage()
      else if (k === "Enter" || k === "=") performCalculation()
      else if (k === "Backspace") backspace()
      else if (k === "Delete") clearEntry()
      else if (k === "Escape") {
        // Escape already closes the dialog; only intercept it to reset a
        // half-typed sum first.
        if (display !== "0") {
          clear()
          e.stopPropagation()
        }
        return
      } else return

      e.preventDefault()
    }

    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [
    open,
    display,
    inputNumber,
    inputDecimal,
    inputOperation,
    percentage,
    performCalculation,
    backspace,
    clearEntry,
    clear,
  ])

  const shown = forDisplay(display)
  const sizeClass =
    shown.length > 15 ? "text-2xl" : shown.length > 11 ? "text-3xl" : "text-4xl"

  const keyBase =
    "flex h-14 select-none items-center justify-center rounded-xl text-lg font-medium " +
    "transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-ring focus-visible:ring-offset-1"

  const digitKey = "bg-card text-foreground hover:bg-muted border"
  const funcKey = "bg-muted text-muted-foreground hover:bg-muted/70 border text-base"
  const opKey = "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
  const clearKey =
    "bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 text-base"
  const equalsKey =
    "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary shadow-sm"

  const Key = ({
    onClick,
    className,
    label,
    children,
  }: {
    onClick: () => void
    className: string
    label: string
    children: React.ReactNode
  }) => (
    <button type="button" onClick={onClick} aria-label={label} className={cn(keyBase, className)}>
      {children}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Calculator</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Display. The pending sum is shown above the figure so it is
              possible to see what is being added to what. */}
          <div className="rounded-xl border bg-field px-4 py-3 text-right">
            <div className="h-5 truncate font-mono text-sm text-muted-foreground">
              {previousValue !== null && operation
                ? `${forDisplay(String(previousValue))} ${operation}`
                : " "}
            </div>
            <div
              className={cn(
                "truncate font-mono font-bold tabular-nums",
                sizeClass,
                errored && "text-destructive"
              )}
            >
              {errored ? "Cannot divide by 0" : shown}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <Key onClick={clear} className={clearKey} label="Clear all">
              C
            </Key>
            <Key onClick={clearEntry} className={funcKey} label="Clear entry">
              CE
            </Key>
            <Key onClick={backspace} className={funcKey} label="Backspace">
              <Delete className="h-4 w-4" />
            </Key>
            <Key onClick={() => inputOperation("÷")} className={opKey} label="Divide">
              ÷
            </Key>

            <Key onClick={() => inputNumber("7")} className={digitKey} label="7">
              7
            </Key>
            <Key onClick={() => inputNumber("8")} className={digitKey} label="8">
              8
            </Key>
            <Key onClick={() => inputNumber("9")} className={digitKey} label="9">
              9
            </Key>
            <Key onClick={() => inputOperation("×")} className={opKey} label="Multiply">
              ×
            </Key>

            <Key onClick={() => inputNumber("4")} className={digitKey} label="4">
              4
            </Key>
            <Key onClick={() => inputNumber("5")} className={digitKey} label="5">
              5
            </Key>
            <Key onClick={() => inputNumber("6")} className={digitKey} label="6">
              6
            </Key>
            <Key onClick={() => inputOperation("-")} className={opKey} label="Subtract">
              −
            </Key>

            <Key onClick={() => inputNumber("1")} className={digitKey} label="1">
              1
            </Key>
            <Key onClick={() => inputNumber("2")} className={digitKey} label="2">
              2
            </Key>
            <Key onClick={() => inputNumber("3")} className={digitKey} label="3">
              3
            </Key>
            <Key onClick={() => inputOperation("+")} className={opKey} label="Add">
              +
            </Key>

            <Key onClick={percentage} className={funcKey} label="Percent">
              %
            </Key>
            <Key onClick={() => inputNumber("0")} className={digitKey} label="0">
              0
            </Key>
            <Key onClick={toggleSign} className={funcKey} label="Change sign">
              ±
            </Key>
            <Key onClick={inputDecimal} className={digitKey} label="Decimal point">
              .
            </Key>

            {/* Equals spans the last row so it is the obvious end of the
                sum, and the only solid green in the dialog. */}
            <Key onClick={performCalculation} className={cn(equalsKey, "col-span-4")} label="Equals">
              =
            </Key>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Keyboard works too — digits, + − × ÷, Enter, Backspace
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
