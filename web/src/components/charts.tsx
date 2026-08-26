import React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDateShort, money, moneyFull, PALETTE, weight } from "../format";

const axis = { fontSize: 11, fill: "#9aa4b6" };

const axisMoney = (v: number) =>
  Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + "млрд" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + "М" : (v / 1e3).toFixed(0) + "к";
const axisKg = (v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + "т" : String(v));

function Tip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-lg shadow-pop border border-line px-3 py-2 text-xs">
      <div className="font-medium text-ink mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-mut">{p.name}:</span>
          <span className="font-semibold num">{fmt ? fmt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendArea({
  data,
  metric = "money",
  height = 220,
  color = "#f59c21",
}: {
  data: { date: string; kg: number; money: number }[];
  metric?: "money" | "kg";
  height?: number;
  color?: string;
}) {
  const fmt = metric === "money" ? money : weight;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 10, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={"g" + color} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={fmtDateShort}
          tick={axis}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={axis}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={metric === "money" ? axisMoney : axisKg}
        />
        <Tooltip content={<Tip fmt={fmt} />} />
        <Area
          type="monotone"
          dataKey={metric}
          name={metric === "money" ? "Деньги" : "Тоннаж"}
          stroke={color}
          strokeWidth={2}
          fill={"url(#g" + color + ")"}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiLine({
  data,
  series,
  metric = "money",
  height = 260,
}: {
  data: any[];
  series: { key: string; name: string; color: string }[];
  metric?: "money" | "kg";
  height?: number;
}) {
  const fmt = metric === "money" ? money : weight;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 10, left: 4, bottom: 0 }}>
        <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={axis} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis tick={axis} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => (metric === "money" ? (v / 1e6).toFixed(0) + "М" : (v / 1000).toFixed(0) + "т")} />
        <Tooltip content={<Tip fmt={fmt} />} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HBars({
  data,
  height = 240,
  metric = "money",
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  metric?: "money" | "kg";
}) {
  const fmt = metric === "money" ? money : weight;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#3a4356" }} width={130} axisLine={false} tickLine={false} />
        <Tooltip content={<Tip fmt={fmt} />} cursor={{ fill: "rgba(0,0,0,.03)" }} />
        <Bar dataKey="value" name={metric === "money" ? "Деньги" : "Тоннаж"} radius={[0, 5, 5, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({
  data,
  height = 200,
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="58%"
          outerRadius="88%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip content={<Tip fmt={moneyFull} />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
