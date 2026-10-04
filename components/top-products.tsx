"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const topProducts = [
  {
    id: 1,
    name: "Smartphone X",
    category: "Phones",
    sold: 145,
    revenue: "৳130,050",
    profit: "৳32,512",
    trend: "up",
  },
  {
    id: 2,
    name: "Wireless Earbuds Pro",
    category: "Accessories",
    sold: 89,
    revenue: "৳17,800",
    profit: "৳8,900",
    trend: "up",
  },
  {
    id: 3,
    name: "Phone Case Premium",
    category: "Accessories",
    sold: 234,
    revenue: "৳7,020",
    profit: "৳3,510",
    trend: "down",
  },
  {
    id: 4,
    name: "Smartphone Y",
    category: "Phones",
    sold: 67,
    revenue: "৳46,900",
    profit: "৳9,380",
    trend: "up",
  },
  {
    id: 5,
    name: "Wireless Charger",
    category: "Accessories",
    sold: 156,
    revenue: "৳7,800",
    profit: "৳3,900",
    trend: "stable",
  },
]

export function TopProducts() {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Top Selling Products</CardTitle>
          <CardDescription>Best performing products by sales volume and revenue</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Units Sold</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Profit</TableHead>
                <TableHead>Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>{product.sold}</TableCell>
                  <TableCell>{product.revenue}</TableCell>
                  <TableCell>{product.profit}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        product.trend === "up" ? "outline" : product.trend === "down" ? "destructive" : "secondary"
                      }
                    >
                      {product.trend}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Phones</span>
                <span className="font-medium">৳176,950 (65%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Accessories</span>
                <span className="font-medium">৳41,520 (30%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Services</span>
                <span className="font-medium">৳6,762 (5%)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low Stock Alert</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Screen Protector</span>
                <Badge variant="destructive">5 left</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Phone Case Blue</span>
                <Badge variant="secondary">8 left</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Charging Cable</span>
                <Badge variant="secondary">12 left</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
