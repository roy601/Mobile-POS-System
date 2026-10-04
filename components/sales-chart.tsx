"use client"

import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type YAxisProps,
} from "recharts"

const data = [
  { name: "Jan", revenue: 4000, sales: 240 },
  { name: "Feb", revenue: 3000, sales: 139 },
  { name: "Mar", revenue: 2000, sales: 980 },
  { name: "Apr", revenue: 2780, sales: 390 },
  { name: "May", revenue: 1890, sales: 480 },
  { name: "Jun", revenue: 2390, sales: 380 },
  { name: "Jul", revenue: 3490, sales: 430 },
]

const currencyFormatter = (value: number) => {
  return new Intl.NumberFormat("bn-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 0,
  }).format(value)
}

// Custom YAxis tick renderer
const renderYAxisTick = (props: any) => {
  const { x, y, payload, stroke } = props

  return (
    <text x={x} y={y} dy={4} fill={stroke} fontSize={10} textAnchor="end">
      {currencyFormatter(payload.value)}
    </text>
  )
}

export function SalesChart() {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <YAxis tick={renderYAxisTick} />
        <YAxis tickFormatter={currencyFormatter} />
        <Tooltip formatter={(value) => currencyFormatter(value as number)} />
        <Legend formatter={(value) => (value === "revenue" ? "Revenue (BDT)" : "Sales (BDT)")} />
        <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} />
        <Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  )
}
