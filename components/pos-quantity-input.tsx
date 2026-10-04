"use client"

import type React from "react"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function POSQuantityInput() {
  const [quantity, setQuantity] = useState(1)

  const decreaseQuantity = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1)
    }
  }

  const increaseQuantity = () => {
    setQuantity(quantity + 1)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseInt(e.target.value)
    if (!isNaN(value) && value > 0) {
      setQuantity(value)
    } else if (e.target.value === "") {
      setQuantity(1)
    }
  }

  return (
    <div className="flex items-center">
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={decreaseQuantity}>
        <Minus className="h-4 w-4" />
      </Button>
      <Input value={quantity} onChange={handleChange} className="text-center mx-1" min={1} type="number" />
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={increaseQuantity}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
