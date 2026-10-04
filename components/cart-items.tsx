"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type CartItem = {
  id: number
  name: string
  color: string
  quantity: number
  price: number
}

export default function CartItems() {
  const [items, setItems] = useState<CartItem[]>([
    {
      id: 1,
      name: "Smartphone X",
      color: "Black",
      quantity: 1,
      price: 899.0,
    },
    {
      id: 2,
      name: "Phone Case",
      color: "Blue",
      quantity: 2,
      price: 25.0,
    },
  ])

  const removeItem = (id: number) => {
    setItems(items.filter((item) => item.id !== id))
  }

  return (
    <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
      <div className="space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="flex justify-between items-center text-sm border-b pb-2">
              <div>
                <p className="font-medium">
                  {item.name} - {item.color}
                </p>
                <p className="text-muted-foreground">
                  Qty: {item.quantity} × ${item.price.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">${(item.quantity * item.price).toFixed(2)}</p>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(item.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-center text-muted-foreground py-4">No items in cart</p>
        )}
      </div>
    </div>
  )
}
