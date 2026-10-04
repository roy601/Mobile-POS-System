"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const topCustomers = [
  {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    totalSpent: "৳2,450.75",
    orders: 12,
    lastPurchase: "2023-05-18",
    status: "VIP",
  },
  {
    id: 2,
    name: "Sarah Davis",
    email: "sarah@example.com",
    totalSpent: "৳1,890.50",
    orders: 8,
    lastPurchase: "2023-05-15",
    status: "Loyal",
  },
  {
    id: 3,
    name: "Michael Brown",
    email: "michael@example.com",
    totalSpent: "৳1,234.25",
    orders: 6,
    lastPurchase: "2023-05-12",
    status: "Regular",
  },
]

export function CustomerAnalytics() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Customer Segments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">New Customers</span>
                <span className="font-medium">180 (15%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Regular Customers</span>
                <span className="font-medium">850 (70%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">VIP Customers</span>
                <span className="font-medium">180 (15%)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Retention</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">Repeat Purchase Rate</span>
                <span className="font-medium">68%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Customer Lifetime Value</span>
                <span className="font-medium">৳456.78</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Churn Rate</span>
                <span className="font-medium">12%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Age Demographics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm">18-25</span>
                <span className="font-medium">25%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">26-35</span>
                <span className="font-medium">40%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">36-50</span>
                <span className="font-medium">25%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">50+</span>
                <span className="font-medium">10%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Customers</CardTitle>
          <CardDescription>Highest value customers by total spending</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Total Spent</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Last Purchase</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.email}</TableCell>
                  <TableCell>{customer.totalSpent}</TableCell>
                  <TableCell>{customer.orders}</TableCell>
                  <TableCell>{customer.lastPurchase}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        customer.status === "VIP"
                          ? "destructive"
                          : customer.status === "Loyal"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {customer.status}
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
