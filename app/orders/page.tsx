import type { Metadata } from "next"
import { Download, Filter, Plus, Search, Settings, ShoppingCart } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { MainNav } from "@/components/main-nav"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserNav } from "@/components/user-nav"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export const metadata: Metadata = {
  title: "Order Management",
  description: "Order management for mobile selling shops",
}

export default function OrdersPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-40">
        <div className="flex h-16 items-center gap-3 px-4">
          {/* The nav takes whatever is left and shrinks into it. The
              old three-column grid gave it its natural width and let it
              overflow, so on a narrower monitor the last destinations
              were simply cut off the end. */}
          <MainNav className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Order Management</h2>
          <div className="flex items-center space-x-2">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Order
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
              <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">1,265</div>
              <p className="text-xs text-muted-foreground">+180 this month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
              <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">24</div>
              <p className="text-xs text-muted-foreground">Requires processing</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
              <CardTitle className="text-sm font-medium">Completed Orders</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">1,156</div>
              <p className="text-xs text-muted-foreground">91.4% completion rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-1">
              <CardTitle className="text-sm font-medium">Average Order Value</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">$124.50</div>
              <p className="text-xs text-muted-foreground">+12% from last month</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-between items-center">
          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All Orders</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="processing">Processing</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search orders..." className="pl-8 w-[200px] lg:w-[300px]" />
            </div>

            <Button variant="outline" size="icon">
              <Filter className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>

            <Select defaultValue="all-channels">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-channels">All Channels</SelectItem>
                <SelectItem value="in-store">In-Store</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    id: "#3210",
                    customer: "Olivia Martin",
                    date: "2023-05-15",
                    channel: "Online Store",
                    total: 42.25,
                    payment: "Paid",
                    status: "Completed",
                  },
                  {
                    id: "#3209",
                    customer: "Ava Johnson",
                    date: "2023-05-14",
                    channel: "In-Store",
                    total: 74.99,
                    payment: "Paid",
                    status: "Completed",
                  },
                  {
                    id: "#3208",
                    customer: "Michael Johnson",
                    date: "2023-05-14",
                    channel: "In-Store",
                    total: 64.75,
                    payment: "Pending",
                    status: "Processing",
                  },
                  {
                    id: "#3207",
                    customer: "Lisa Anderson",
                    date: "2023-05-13",
                    channel: "Online Store",
                    total: 34.5,
                    payment: "Paid",
                    status: "Shipped",
                  },
                  {
                    id: "#3206",
                    customer: "Samantha Green",
                    date: "2023-05-13",
                    channel: "In-Store",
                    total: 89.99,
                    payment: "Paid",
                    status: "Completed",
                  },
                  {
                    id: "#3205",
                    customer: "Adam Barlow",
                    date: "2023-05-12",
                    channel: "Online Store",
                    total: 24.99,
                    payment: "Failed",
                    status: "Cancelled",
                  },
                  {
                    id: "#3204",
                    customer: "Sophia Anderson",
                    date: "2023-05-12",
                    channel: "In-Store",
                    total: 99.99,
                    payment: "Paid",
                    status: "Completed",
                  },
                  {
                    id: "#3203",
                    customer: "Daniel Smith",
                    date: "2023-05-11",
                    channel: "Online Store",
                    total: 67.5,
                    payment: "Paid",
                    status: "Shipped",
                  },
                ].map((order, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{order.id}</TableCell>
                    <TableCell>{order.customer}</TableCell>
                    <TableCell>{order.date}</TableCell>
                    <TableCell>{order.channel}</TableCell>
                    <TableCell>${order.total.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          order.payment === "Paid"
                            ? "outline"
                            : order.payment === "Pending"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {order.payment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          order.status === "Completed"
                            ? "outline"
                            : order.status === "Shipped"
                              ? "secondary"
                              : order.status === "Processing"
                                ? "default"
                                : "destructive"
                        }
                      >
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon">
                        <Settings className="h-4 w-4" />
                        <span className="sr-only">Settings</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
