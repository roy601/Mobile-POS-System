"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const inventoryData = [
  {
    id: 1,
    product: "Smartphone X",
    currentStock: 24,
    soldThisMonth: 45,
    turnoverRate: "High",
    reorderPoint: 10,
    status: "Good",
  },
  {
    id: 2,
    product: "Phone Case Premium",
    currentStock: 5,
    soldThisMonth: 89,
    turnoverRate: "Very High",
    reorderPoint: 15,
    status: "Low Stock",
  },
  {
    id: 3,
    product: "Wireless Charger",
    currentStock: 0,
    soldThisMonth: 34,
    turnoverRate: "Medium",
    reorderPoint: 8,
    status: "Out of Stock",
  },
]

export function InventoryAnalytics() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Inventory Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Total Products</span>
                <span className="font-medium">1,248</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">In Stock</span>
                <span className="font-medium">1,217</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Low Stock</span>
                <span className="font-medium text-amber-500">24</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Out of Stock</span>
                <span className="font-medium text-red-500">7</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Total Value</span>
                <span className="font-medium">৳98,432</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Fast Moving</span>
                <span className="font-medium">৳45,678</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Slow Moving</span>
                <span className="font-medium">৳12,345</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Dead Stock</span>
                <span className="font-medium text-red-500">৳2,109</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Turnover Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Avg. Turnover Rate</span>
                <span className="font-medium">4.2x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Days in Inventory</span>
                <span className="font-medium">87 days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Stock Accuracy</span>
                <span className="font-medium">96.5%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Performance</CardTitle>
          <CardDescription>Product performance and stock status</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Sold This Month</TableHead>
                <TableHead>Turnover Rate</TableHead>
                <TableHead>Reorder Point</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventoryData.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.product}</TableCell>
                  <TableCell>{item.currentStock}</TableCell>
                  <TableCell>{item.soldThisMonth}</TableCell>
                  <TableCell>{item.turnoverRate}</TableCell>
                  <TableCell>{item.reorderPoint}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "Good" ? "outline" : item.status === "Low Stock" ? "secondary" : "destructive"
                      }
                    >
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
