/**
 * xHandle: airisk manager module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { logger } from '../../lib/utils/logger';
import {
  AlertTriangle,
  CheckCircle2,
  UserCog,
  CalendarClock,
  Lightbulb,
  Wand2,
  SlidersHorizontal,
  BarChart3,
  Grid3X3,
  LayoutDashboard,
  Settings2,
  RefreshCcw,
  Search,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Cell,
} from 'recharts';
import { askAIPM } from '../../components/utils/aiPm';

/* ========================================================================
   INTERACTIVE RISK MANAGER (Reimagined)
   - Widget-based dashboard with user-customizable layout
   - Global filters (search, status, owner, tags, RPN, due window)
   - Charts: RPN histogram, By Status, By Owner, Due timeline, Risk breakdown
   - Filterable list with inline edits
   - AI actions: Review Plan + Strategy drafting (kept from original)
   Drop-in replacement for your current AIRiskManager export default component.
   ======================================================================== */

/* ------------------------------ Helpers ------------------------------ */
function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  const now = new Date();
  if (Number.isNaN(+d)) return Infinity;
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

/**
 * riskHealth renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function riskHealth(r) {
  if (r.status === 'Closed') return 'closed';
  if (!r.dueDate) return 'no-date';
  const d = new Date(r.dueDate);
  const now = new Date();
  if (Number.isNaN(+d)) return 'no-date';
  if (d < now) return 'overdue';
  const days = daysUntil(r.dueDate);
  if (days <= 7) return 'due-soon';
  return 'on-track';
}

/**
 * RPN renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const RPN = (r) => (Number(r.likelihood) || 0) * (Number(r.severity) || 0);
/**
 * safeKey renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r Input consumed by this step of the xHandle workflow.
 * @param i Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const safeKey = (r, i) => r?.id ?? `risk-${i}`;

/* ------------------------------ Presets ------------------------------ */
const STATUS_ORDER = ['Open', 'In Progress', 'In Mitigation', 'Mitigated', 'Accepted', 'Closed'];
const STATUS_COLORS = {
  Open: '#ef4444',
  'In Progress': '#f59e0b',
  'In Mitigation': '#06b6d4',
  Mitigated: '#10b981',
  Accepted: '#8b5cf6',
  Closed: '#9ca3af',
};

const DEFAULT_WIDGETS = {
  kpis: true,
  rpnHistogram: true,
  statusBreakdown: true,
  ownerBreakdown: true,
  dueTimeline: true,
  heatmap: true,
  riskTable: true,
};

/* --------------------------- Small UI bits --------------------------- */
function Chip({ children, className = '', onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Section renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param icon Input consumed by this step of the xHandle workflow.
 * @param actions Input consumed by this step of the xHandle workflow.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function Section({ title, icon, actions, children }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {icon}
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/* ---------------------------- Filters Panel ---------------------------- */
function FiltersPanel({ allRisks, filters, setFilters, owners }) {
  const [open, setOpen] = useState(true);

  // distinct tags
  const tagSet = useMemo(() => {
    const s = new Set();
    for (const r of allRisks || []) String(r.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .forEach(t => s.add(t));
    return Array.from(s).sort((a,b)=>a.localeCompare(b));
  }, [allRisks]);

  return (
    <div className="bg-white rounded-2xl border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(o=>!o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
      >
        <span className="inline-flex items-center gap-2 text-slate-800"><SlidersHorizontal className="w-4 h-4"/> Filters</span>
        <span className="text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
            <input
              className="w-full border rounded pl-8 pr-2 py-1.5 text-sm"
              placeholder="Search title/description…"
              value={filters.q}
              onChange={(e)=>setFilters(f=>({...f,q:e.target.value}))}
            />
          </div>

          {/* Status multiselect */}
          <div className="flex flex-wrap gap-2 border rounded p-2">
            <span className="text-[11px] text-slate-500">Status</span>
            {STATUS_ORDER.map(s=>{
              const active = filters.statuses.includes(s);
              return (
                <Chip
                  key={s}
                  onClick={()=>
                    setFilters(f=> ({...f, statuses: active ? f.statuses.filter(x=>x!==s) : [...f.statuses, s]}))
                  }
                  className={`${active ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{backgroundColor: STATUS_COLORS[s]}} /> {s}
                </Chip>
              );
            })}
          </div>

          {/* Owner select */}
          <select
            className="w-full border rounded px-2 py-1.5 text-sm"
            value={filters.owner}
            onChange={e=>setFilters(f=>({...f, owner: e.target.value}))}
          >
            <option value="">All owners</option>
            <option value="__UNASSIGNED__">Unassigned only</option>
            {owners.map(o=> <option key={o} value={o}>{o}</option>)}
          </select>

          {/* Tags select */}
          <div>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={filters.tag}
              onChange={e=>setFilters(f=>({...f, tag: e.target.value}))}
            >
              <option value="">All tags</option>
              {tagSet.map(t=> <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* RPN range */}
          <div className="flex gap-2">
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Min RPN"
              value={filters.minRPN}
              onChange={e=>setFilters(f=>({...f, minRPN: e.target.value.replace(/[^\d]/g,'')}))}
            />
            <input
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="Max RPN"
              value={filters.maxRPN}
              onChange={e=>setFilters(f=>({...f, maxRPN: e.target.value.replace(/[^\d]/g,'')}))}
            />
          </div>

          {/* Due window */}
          <div className="flex gap-2">
            <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" value={filters.dueFrom} onChange={e=>setFilters(f=>({...f,dueFrom:e.target.value}))} />
            <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" value={filters.dueTo} onChange={e=>setFilters(f=>({...f,dueTo:e.target.value}))} />
          </div>

          {/* Controls */}
          <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50"
              onClick={()=>setFilters(DEFAULT_FILTERS)}
              title="Reset filters"
            >
              <RefreshCcw className="w-4 h-4 mr-1 inline"/> Reset
            </button>
            <span className="ml-auto text-xs text-slate-500">{allRisks?.length || 0} total risks</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------- Widget Switcher --------------------------- */
function WidgetPicker({ widgets, setWidgets }) {
  const items = [
    { id: 'kpis', label: 'KPIs' },
    { id: 'rpnHistogram', label: 'RPN Histogram' },
    { id: 'statusBreakdown', label: 'By Status' },
    { id: 'ownerBreakdown', label: 'By Owner' },
    { id: 'dueTimeline', label: 'Due Timeline' },
    { id: 'heatmap', label: 'Severity×Likelihood' },
    { id: 'riskTable', label: 'Risk Table' },
  ];
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-3">
      <div className="text-sm font-semibold flex items-center gap-2 mb-2 text-slate-800"><Settings2 className="w-4 h-4"/> Customize dashboard</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {items.map(it => (
          <label key={it.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!widgets[it.id]}
              onChange={() => setWidgets(prev => ({ ...prev, [it.id]: !prev[it.id] }))}
            />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- Charts ------------------------------- */
function RpnHistogram({ data }) {
  // Bucket RPN by 10s
  const buckets = useMemo(() => {
    const m = new Map();
    (data||[]).forEach(r => {
      const v = RPN(r);
      const bucket = `${Math.floor(v/10)*10}-${Math.floor(v/10)*10 + 9}`;
      m.set(bucket, (m.get(bucket) || 0) + 1);
    });
    return Array.from(m.entries())
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a,b)=>{
        const na = Number(a.bucket.split('-')[0]);
        const nb = Number(b.bucket.split('-')[0]);
        return na - nb;
      });
  }, [data]);

  return (
    <Section title="RPN distribution" icon={<BarChart3 className="w-4 h-4"/>}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/**
 * StatusBreakdown renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param data Structured data payload associated with the current record or node.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function StatusBreakdown({ data }) {
  const counts = useMemo(() => {
    const m = new Map(STATUS_ORDER.map(s => [s, 0]));
    (data||[]).forEach(r => m.set(r.status || 'Open', (m.get(r.status || 'Open')||0)+1));
    return STATUS_ORDER.map(s => ({ status: s, count: m.get(s) || 0 }));
  }, [data]);

  return (
    <Section title="Risks by status" icon={<Grid3X3 className="w-4 h-4"/>}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={counts}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="status" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count">
              {counts.map((x, i) => (
                <Cell key={`c-${i}`} fill={STATUS_COLORS[x.status] || '#94a3b8'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/**
 * OwnerBreakdown renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param data Structured data payload associated with the current record or node.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function OwnerBreakdown({ data }) {
  const counts = useMemo(() => {
    const m = new Map();
    (data||[]).forEach(r => {
      const o = String(r.owner||'Unassigned');
      m.set(o, (m.get(o)||0)+1);
    });
    return Array.from(m.entries()).map(([owner, count]) => ({ owner, count })).sort((a,b)=>b.count-a.count);
  }, [data]);

  return (
    <Section title="Risks by owner" icon={<UserCog className="w-4 h-4"/>}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={counts} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="owner" width={100} />
            <Tooltip />
            <Bar dataKey="count" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/**
 * DueTimeline renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param data Structured data payload associated with the current record or node.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function DueTimeline({ data }) {
  // aggregate by date
  const series = useMemo(() => {
    const m = new Map();
    (data||[]).forEach(r => {
      if (!r.dueDate) return;
      const d = new Date(r.dueDate);
      if (Number.isNaN(+d)) return;
      const k = d.toISOString().slice(0,10);
      m.set(k, (m.get(k)||0) + 1);
    });
    return Array.from(m.entries()).map(([date, count]) => ({ date, count })).sort((a,b)=>a.date.localeCompare(b.date));
  }, [data]);

  return (
    <Section title="Due timeline" icon={<CalendarClock className="w-4 h-4"/>}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Area dataKey="count" type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/**
 * RPNSLHeatmap renders a React component. It gives users access to risk register generation and review while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param data Structured data payload associated with the current record or node.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function RPNSLHeatmap({ data }) {
  // Build 5x5 matrix (Severity 1..5 vs Likelihood 1..5)
  const cells = useMemo(() => {
    const m = Array.from({length:5},()=>Array.from({length:5},()=>0));
    (data||[]).forEach(r => {
      const s = Math.max(1, Math.min(5, Number(r.severity)||0));
      const l = Math.max(1, Math.min(5, Number(r.likelihood)||0));
      if (s && l) m[5-s][l-1] += 1; // invert severity for top-high
    });
    return m;
  }, [data]);

  const max = Math.max(1, ...cells.flat());
  const color = (v) => `rgba(239, 68, 68, ${0.15 + 0.85*(v/max)})`;

  return (
    <Section title="Severity × Likelihood" icon={<LayoutDashboard className="w-4 h-4"/>}>
      <div className="grid grid-cols-5 gap-1">
        {cells.map((row, ri) => (
          <React.Fragment key={ri}>
            {row.map((v, ci) => (
              <div key={`${ri}-${ci}`} className="aspect-square rounded flex items-center justify-center text-xs font-medium" style={{ backgroundColor: color(v) }}>
                {v || ''}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-500 mt-2">
        <span>Likelihood → 1…5</span>
        <span>Severity ↑ 5…1</span>
      </div>
    </Section>
  );
}

/* ----------------------------- Risk Table ----------------------------- */
function RiskTable({ risks, setRisks, onSuggestOwner, onDraftStrategy }) {
  const [sortBy, setSortBy] = useState('rpn');
  const [sortDir, setSortDir] = useState('desc');

  const data = useMemo(() => {
    const arr = [...(risks||[])];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a,b)=>{
      if (sortBy === 'rpn') return dir * (RPN(a) - RPN(b));
      if (sortBy === 'due') {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return dir * (da - db);
      }
      return dir * String(a.title||'').localeCompare(String(b.title||''));
    });
    return arr;
  }, [risks, sortBy, sortDir]);

  const setOwner = (id, owner) => setRisks(prev => prev.map(r => (r.id ?? null) === id ? { ...r, owner } : r));
  const setStatus = (id, status) => setRisks(prev => prev.map(r => (r.id ?? null) === id ? { ...r, status } : r));

  const HeaderBtn = ({id, children}) => (
    <button
      type="button"
      onClick={() => {
        if (sortBy === id) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(id); setSortDir('desc'); }
      }}
      className="inline-flex items-center gap-1 hover:underline"
      title="Sort"
    >
      {children}
      {sortBy === id ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </button>
  );

  return (
    <Section title="Risk table" icon={<Grid3X3 className="w-4 h-4"/>}>
      <div className="overflow-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-white z-10 shadow-sm">
            <tr className="text-slate-700">
              <th className="px-3 py-2 text-left w-[28ch]"><HeaderBtn id="title">Title</HeaderBtn></th>
              <th className="px-3 py-2 text-left">RPN</th>
              <th className="px-3 py-2 text-left"><HeaderBtn id="due">Due</HeaderBtn></th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left w-[22ch]">Owner</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r,i)=> (
              <tr key={safeKey(r,i)} className={`border-t ${i%2?'bg-[#F9FAFB]':'bg-white'}`}>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium">{r.title || '—'}</div>
                  <div className="text-xs text-slate-600 line-clamp-2">{r.description || '—'}</div>
                  {r.tags && <div className="mt-1 text-[11px] text-slate-500">Tags: {r.tags}</div>}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="inline-flex px-2 py-0.5 rounded bg-slate-100">{RPN(r)}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  {r.dueDate
                    ? (Number.isNaN(+new Date(r.dueDate)) ? '—' : new Date(r.dueDate).toLocaleDateString())
                    : '—'}
                </td>
                <td className="px-3 py-2 align-top">
                  <select className="border rounded px-2 py-1 text-xs" value={r.status||''} onChange={e=>setStatus(r.id ?? null, e.target.value)}>
                    {STATUS_ORDER.map(s=> <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 align-top">
                  <input className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g., Alex" value={r.owner||''} onChange={e=>setOwner(r.id ?? null, e.target.value)} />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button type="button" className="text-xs px-2 py-1 rounded border hover:bg-slate-50" onClick={()=>onSuggestOwner?.(r)}>Suggest Owner</button>
                    <button type="button" className="text-xs px-2 py-1 rounded bg-[#2D7DFE] text-white hover:bg-[#1E61D6]" onClick={()=>onDraftStrategy?.(r)}>Suggest Steps</button>
                  </div>
                </td>
              </tr>
            ))}
            {data.length===0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">No risks match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* --------------------------- Main Entry Point --------------------------- */
const DEFAULT_FILTERS = {
  q: '',
  statuses: ['Open','In Progress','In Mitigation','Mitigated','Accepted'], // exclude Closed by default
  owner: '', // "", "__UNASSIGNED__", or a specific name
  tag: '',
  minRPN: '',
  maxRPN: '',
  dueFrom: '',
  dueTo: '',
};

export default function AIRiskManager({
  risks = [],
  setRisks,
  analysisSummary = [],
  projectName = 'Project',
}) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [widgets, setWidgets] = useState(() => {
    try {
      return { ...DEFAULT_WIDGETS, ...(JSON.parse(localStorage.getItem('risk.widgets')||'{}')) };
    } catch { return DEFAULT_WIDGETS; }
  });
  useEffect(()=>{ try { localStorage.setItem('risk.widgets', JSON.stringify(widgets)); } catch {} }, [widgets]);

  const owners = useMemo(() => {
    const s = new Set();
    for (const r of risks || []) if (r.owner) s.add(String(r.owner));
    return Array.from(s).sort((a,b)=>a.localeCompare(b));
  }, [risks]);

  // Apply filters
  const filtered = useMemo(() => {
    const min = filters.minRPN === '' ? -Infinity : Number(filters.minRPN);
    const max = filters.maxRPN === '' ? Infinity  : Number(filters.maxRPN);
    const from = filters.dueFrom ? new Date(filters.dueFrom) : null;
    const to   = filters.dueTo   ? new Date(filters.dueTo)   : null;
    const q = filters.q.toLowerCase();
    const tag = filters.tag.toLowerCase();

    return (risks||[])
      .filter(r => filters.statuses.includes(r.status || 'Open'))
      .filter(r => {
        if (!filters.owner) return true;
        if (filters.owner === '__UNASSIGNED__') return !String(r.owner||'').trim();
        return String(r.owner||'') === filters.owner;
      })
      .filter(r => {
        if (!filters.tag) return true;
        const t = String(r.tags||'').toLowerCase().split(',').map(x=>x.trim());
        return t.includes(tag);
      })
      .filter(r => {
        const v = RPN(r);
        return v >= min && v <= max;
      })
      .filter(r => {
        if (!from && !to) return true;
        if (!r.dueDate) return false;
        const d = new Date(r.dueDate);
        if (Number.isNaN(+d)) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .filter(r => {
        const text = `${r.title||''} ${r.description||''}`.toLowerCase();
        return !q || text.includes(q);
      });
  }, [risks, filters]);

  // KPI groups based on health
  const { overdue, dueSoon, unassigned, onTrack } = useMemo(() => {
    const o=[], s=[], u=[], ok=[];
    for (const r of filtered) {
      const h = riskHealth(r);
      if (!String(r.owner||'').trim()) u.push(r);
      if (h === 'overdue') o.push(r);
      else if (h === 'due-soon') s.push(r);
      else if (h === 'on-track') ok.push(r);
    }
    return { overdue:o, dueSoon:s, unassigned:u, onTrack:ok };
  }, [filtered]);

  const kpis = useMemo(() => ([
    { label: 'Overdue', value: overdue.length, icon: <AlertTriangle />, tone: 'text-red-600' },
    { label: 'Due in 7 days', value: dueSoon.length, icon: <CalendarClock />, tone: 'text-amber-600' },
    { label: 'Unassigned', value: unassigned.length, icon: <UserCog />, tone: 'text-rose-600' },
    { label: 'On Track', value: onTrack.length, icon: <CheckCircle2 />, tone: 'text-emerald-600' },
  ]), [overdue.length, dueSoon.length, unassigned.length, onTrack.length]);

  /* ---------------------- AI hooks (kept + enhanced) ---------------------- */
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [reviewPlan, setReviewPlan] = useState(null);
  const [loadingReso, setLoadingReso] = useState(false);
  const [strategyMap, setStrategyMap] = useState({}); // riskId -> {summary, steps}

  async function handleGenerateReviewPlan() {
    setLoadingPlan(true);
    try {
      const plan = await askAIPM('review_plan', { projectName, risks: filtered, context: { analysisSummary, timeframe: 'next 14 days' } });
      setReviewPlan(plan);
    } catch (err) {
      logger.error('askAIPM(review_plan) failed:', err);
      alert(`Could not generate plan.\n${err?.message || err}`);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function handleGenerateStrategies(targetRisks) {
    setLoadingReso(true);
    try {
      const byId = { ...strategyMap };
      for (const r of targetRisks) {
        try {
          const res = await askAIPM('resolution_strategy', { projectName, risk: r, context: { analysisSummary } });
          if (r.id != null) byId[r.id] = res;
        } catch (e) { logger.error('askAIPM(resolution_strategy) failed for risk', r, e); }
      }
      setStrategyMap(byId);
    } catch (err) {
      alert(`Could not draft strategies.\n${err?.message || err}`);
    } finally { setLoadingReso(false); }
  }

  async function suggestOwner(r) {
    try {
      const res = await askAIPM('owner_suggestion', { risk: r, projectName, context: { analysisSummary } });
      return res; // { owner, rationale }
    } catch (err) {
      logger.error('askAIPM(owner_suggestion) failed:', err);
      alert(`Could not suggest owner.\n${err?.message || err}`);
      return {};
    }
  }

  const onSuggestOwner = async (r) => {
    const { owner, rationale } = await suggestOwner(r);
    if (owner && r.id != null) setRisks?.(prev => prev.map(x => (x.id ?? null) === r.id ? { ...x, owner } : x));
    if (owner) alert(`Suggested owner: ${owner}\n\nWhy: ${rationale || '—'}`);
  };
  const onDraftStrategy = (r) => handleGenerateStrategies([r]);

  /* ------------------------------ Render ------------------------------ */
  return (
    <section className="space-y-3">
      {/* Top toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white text-slate-700 text-sm">
          <BarChart3 className="w-4 h-4"/> Interactive Risk Manager
        </div>
        <button
          type="button"
          onClick={handleGenerateReviewPlan}
          className="px-3 py-1.5 rounded bg-[#2D7DFE] text-white text-sm hover:bg-[#1E61D6] inline-flex items-center gap-2"
          disabled={loadingPlan}
        >
          <Wand2 className="w-4 h-4"/>
          {loadingPlan ? 'Planning…' : 'AI Review Plan'}
        </button>
        <button
          type="button"
          onClick={()=>handleGenerateStrategies(filtered.filter(r => r.status !== 'Closed'))}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 inline-flex items-center gap-2"
          disabled={loadingReso || !filtered.length}
        >
          <Lightbulb className="w-4 h-4"/>
          {loadingReso ? 'Drafting…' : 'Draft Strategies (filtered)'}
        </button>
      </div>

      {/* Filters + Widget picker */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
        <div className="xl:col-span-3 space-y-3">
          <FiltersPanel allRisks={risks} filters={filters} setFilters={setFilters} owners={owners} />
        </div>
        <div className="xl:col-span-1">
          <WidgetPicker widgets={widgets} setWidgets={setWidgets} />
        </div>
      </div>

      {/* KPIs */}
      {widgets.kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map(k => (
            <div key={k.label} className="bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3">
              <div className={`opacity-80 ${k.tone}`}>{k.icon}</div>
              <div>
                <div className="text-xs text-slate-500">{k.label}</div>
                <div className="text-xl font-semibold">{Number.isFinite(k.value) ? k.value : 0}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {widgets.rpnHistogram && <RpnHistogram data={filtered} />}
        {widgets.statusBreakdown && <StatusBreakdown data={filtered} />}
        {widgets.ownerBreakdown && <OwnerBreakdown data={filtered} />}
        {widgets.dueTimeline && <DueTimeline data={filtered} />}
        {widgets.heatmap && <RPNSLHeatmap data={filtered} />}
      </div>

      {/* Review Plan (if generated) */}
      {reviewPlan && (
        <Section title="AI Review Planner" icon={<Wand2 className="w-4 h-4"/>}>
          <div className="text-sm">
            <div className="mb-2 font-medium">Summary</div>
            <p className="text-slate-700 mb-3">{reviewPlan?.summary}</p>
            <div className="mb-2 font-medium">Recommended Sessions</div>
            <ul className="list-disc ml-5 space-y-1">
              {(reviewPlan?.sessions || []).map((s, i) => (
                <li key={`session-${i}`}>
                  <span className="font-medium">{s.when}</span> — {s.title} · owner <span className="font-medium">{s.owner}</span> · scope: {s.scope}
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* Risk table */}
      {widgets.riskTable && (
        <RiskTable risks={filtered} setRisks={setRisks} onSuggestOwner={onSuggestOwner} onDraftStrategy={onDraftStrategy} />
      )}

      {/* AI strategies inline reveal */}
      {Object.keys(strategyMap).length > 0 && (
        <Section title="AI Strategy Suggestions" icon={<Lightbulb className="w-4 h-4"/>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.filter(r=>strategyMap[r.id]).map((r) => (
              <div key={`strat-${r.id}`} className="bg-slate-50 rounded p-3">
                <div className="text-sm font-medium mb-1">{r.title}</div>
                <div className="text-xs text-slate-700">{strategyMap[r.id]?.summary}</div>
                {strategyMap[r.id]?.steps?.length ? (
                  <ol className="list-decimal ml-5 mt-2 space-y-1 text-xs">
                    {strategyMap[r.id].steps.map((s, j) => <li key={`step-${r.id}-${j}`}>{s}</li>)}
                  </ol>
                ) : null}
              </div>
            ))}
          </div>
        </Section>
      )}
    </section>
  );
}
