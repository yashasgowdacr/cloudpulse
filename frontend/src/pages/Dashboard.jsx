import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { dashboardService } from '../services/dashboardService';
import { anomalyService } from '../services/anomalyService';
import api from '../services/api';
import { Link } from 'react-router-dom';
import {
  Cloud,
  Server,
  DollarSign,
  TrendingDown,
  ShieldCheck,
  Play,
  RefreshCw,
  Plus,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Filter,
  BarChart2,
  Sliders,
  History
} from 'lucide-react';

const safeErrString = (errVal, fallback = 'Error loading data') => {
  if (!errVal) return '';
  if (typeof errVal === 'string') return errVal;
  if (typeof errVal === 'object') return errVal.message || errVal.error || fallback;
  return String(errVal);
};

const formatCurrency = (amount, currencyCode = 'USD') => {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.00';
  const validCode = (currencyCode && typeof currencyCode === 'string' && currencyCode.length === 3)
    ? currencyCode.toUpperCase()
    : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: validCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (err) {
    return `$${Number(amount).toFixed(2)}`;
  }
};

const Dashboard = () => {
  const { user } = useAuth();

  // Filters
  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [resourceGroupFilter, setResourceGroupFilter] = useState('');
  const [dateRange, setDateRange] = useState('current_month');

  // KPI & Analytics States
  const [kpiData, setKpiData] = useState({ loading: true, data: null, error: null });
  const [trends, setTrends] = useState({ loading: true, data: null, error: null });
  const [anomalies, setAnomalies] = useState({ loading: true, data: [] });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // 1. Fetch Connections
  const fetchConnections = useCallback(async () => {
    try {
      const data = await dashboardService.getAzureConnections();
      const list = data?.connections || [];
      setConnections(list);
      if (list.length === 1 && !selectedConnectionId) {
        setSelectedConnectionId(list[0].id);
      }
    } catch (err) {
      console.warn('Failed to load connections:', err);
    }
  }, [selectedConnectionId]);

  // 2. Fetch Dashboard KPIs
  const fetchKpis = useCallback(async () => {
    setKpiData(prev => ({ ...prev, loading: true, error: null }));
    try {
      const filters = {
        resourceGroup: resourceGroupFilter || undefined,
        dateRange
      };
      const res = await dashboardService.getKpiMetrics(selectedConnectionId, filters);
      setKpiData({ loading: false, data: res?.kpis || null, error: null });
    } catch (err) {
      const errMsg = safeErrString(err.response?.data?.message || err.message, 'Failed to load KPI metrics.');
      setKpiData({ loading: false, data: null, error: errMsg });
    }
  }, [selectedConnectionId, resourceGroupFilter, dateRange]);

  // 3. Fetch Cost Trends
  const fetchTrends = useCallback(async () => {
    setTrends(prev => ({ ...prev, loading: true, error: null }));
    try {
      const filters = {
        resourceGroup: resourceGroupFilter || undefined,
        dateRange
      };
      const res = await dashboardService.getCostTrends(selectedConnectionId, filters);
      setTrends({ loading: false, data: res || null, error: null });
    } catch (err) {
      setTrends({ loading: false, data: null, error: 'Trends unavailable' });
    }
  }, [selectedConnectionId, resourceGroupFilter, dateRange]);

  // 4. Fetch Anomalies
  const fetchAnomalies = useCallback(async () => {
    setAnomalies(prev => ({ ...prev, loading: true }));
    try {
      const res = await anomalyService.getAnomalies({ status: 'OPEN' });
      setAnomalies({ loading: false, data: res?.anomalies || [] });
    } catch (err) {
      setAnomalies({ loading: false, data: [] });
    }
  }, []);

  const loadAllDashboardData = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([fetchConnections(), fetchKpis(), fetchTrends(), fetchAnomalies()]);
    setIsRefreshing(false);
  }, [fetchConnections, fetchKpis, fetchTrends, fetchAnomalies]);

  useEffect(() => {
    loadAllDashboardData();
  }, [loadAllDashboardData]);

  const handleRunScan = async () => {
    setIsScanning(true);
    try {
      await api.post('/api/optimization/run-now');
      await loadAllDashboardData();
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const kpis = kpiData.data || {
    actualMonthToDateCost: 0,
    estimatedProjectedCost: 0,
    potentialMonthlySavings: 0,
    estimatedAvoidedCost: 0,
    currency: 'USD',
    activeVmCount: 0,
    idleVmCount: 0,
    protectedVmCount: 0,
    totalOptimizationActions: 0
  };

  const dailyTrends = trends.data?.dailyTrends || [];
  const maxDailyCost = dailyTrends.reduce((max, d) => Math.max(max, d.cost), 1);

  return (
    <div>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            CloudPulse Dashboard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Real-time cloud governance, savings analytics, and autonomous optimization
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={handleRunScan}
            disabled={isScanning || isRefreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
          >
            <Play size={16} className={isScanning ? 'animate-spin' : ''} />
            <span>{isScanning ? 'Evaluating VMs...' : 'Run Optimization Scan'}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={loadAllDashboardData}
            disabled={isRefreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Bar (Phase 7 Tenant Scoped Filtering) */}
      <div className="card" style={{ padding: '0.875rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: '600' }}>
          <Filter size={16} style={{ color: 'var(--accent-primary)' }} />
          <span>Filters:</span>
        </div>

        {/* Subscription / Connection Filter */}
        <select
          className="form-control"
          style={{ maxWidth: '240px', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
          value={selectedConnectionId}
          onChange={(e) => setSelectedConnectionId(e.target.value)}
        >
          <option value="">All Cloud Connections ({connections.length})</option>
          {connections.map(c => (
            <option key={c.id} value={c.id}>
              {c.connection_name} ({c.subscription_id ? c.subscription_id.slice(0, 8) + '...' : c.id.slice(0, 8)})
            </option>
          ))}
        </select>

        {/* Resource Group Filter */}
        <input
          type="text"
          className="form-control"
          placeholder="Filter Resource Group..."
          style={{ maxWidth: '220px', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
          value={resourceGroupFilter}
          onChange={(e) => setResourceGroupFilter(e.target.value)}
        />

        {/* Date Range Selector */}
        <select
          className="form-control"
          style={{ maxWidth: '180px', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
        >
          <option value="current_month">Current Month (MTD)</option>
          <option value="last_30_days">Last 30 Days</option>
        </select>
      </div>

      {/* Anomaly Quick Alert Banner if Anomalies Exist */}
      {anomalies.data.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid var(--status-danger)',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', color: 'var(--status-danger)', fontWeight: '600', fontSize: '0.875rem' }}>
            <AlertTriangle size={20} />
            <span>Unusual cost increase detected across {anomalies.data.length} resource(s). Review detected anomalies.</span>
          </div>
          <Link to="/costs" className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderColor: 'var(--status-danger)' }}>
            View Cost Anomalies
          </Link>
        </div>
      )}

      {/* Phase 7: 8 Distinct KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {/* KPI 1: Actual Month-to-Date Cost */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Month-to-Date Cost
            </span>
            <span className="badge badge-info" style={{ fontSize: '0.7rem', fontWeight: '700' }}>
              ACTUAL BILLED
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {formatCurrency(kpis.actualMonthToDateCost, kpis.currency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Directly from Azure Cost Management API
          </div>
        </div>

        {/* KPI 2: Estimated Projected Monthly Cost */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Projected Monthly
            </span>
            <span className="badge badge-secondary" style={{ fontSize: '0.7rem', fontWeight: '700' }}>
              ESTIMATED PROJECTED
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {formatCurrency(kpis.estimatedProjectedCost, kpis.currency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Pro-rated run rate for current billing cycle
          </div>
        </div>

        {/* KPI 3: Potential Monthly Savings */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Potential Savings
            </span>
            <span className="badge badge-warning" style={{ fontSize: '0.7rem', fontWeight: '700' }}>
              POTENTIAL SAVINGS
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--accent-primary)', marginBottom: '0.25rem' }}>
            {formatCurrency(kpis.potentialMonthlySavings, kpis.currency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            From idle VMs eligible for deallocation
          </div>
        </div>

        {/* KPI 4: Estimated Avoided Cost */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Avoided Compute Cost
            </span>
            <span className="badge badge-success" style={{ fontSize: '0.7rem', fontWeight: '700' }}>
              ESTIMATED AVOIDED COST
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--status-success)', marginBottom: '0.25rem' }}>
            {formatCurrency(kpis.estimatedAvoidedCost, kpis.currency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Cumulative savings from completed deallocations
          </div>
        </div>

        {/* KPI 5: Active VMs */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Active VMs
            </span>
            <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>RUNNING</span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {kpis.activeVmCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Currently powered ON & incurring compute cost
          </div>
        </div>

        {/* KPI 6: Idle VMs */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Idle Candidates
            </span>
            <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>UNDERUTILIZED</span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--status-warning)', marginBottom: '0.25rem' }}>
            {kpis.idleVmCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            CPU utilization strictly below policy threshold
          </div>
        </div>

        {/* KPI 7: Protected VMs */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Protected Workloads
            </span>
            <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>SAFEGUARDED</span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {kpis.protectedVmCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Protected by production rules or exclusion tags
          </div>
        </div>

        {/* KPI 8: Optimization Actions */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Policy Actions
            </span>
            <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>AUDIT LOG</span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            {kpis.totalOptimizationActions}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Automated & manual governance operations
          </div>
        </div>
      </div>

      {/* Phase 7: Cost Trends & Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Daily Spend Trend Chart */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart2 size={20} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">Daily Cost Trend ({dailyTrends.length} Days)</span>
            </div>
            <span className="badge badge-info">MTD Cached Run Rate</span>
          </div>

          {dailyTrends.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No daily spend data available for this selection.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '180px', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
              {dailyTrends.map((d, i) => {
                const heightPct = Math.max(10, Math.min(100, Math.round((d.cost / maxDailyCost) * 100)));
                return (
                  <div
                    key={i}
                    title={`${d.date}: ${formatCurrency(d.cost, d.currency)}`}
                    style={{
                      flex: 1,
                      height: `${heightPct}%`,
                      backgroundColor: 'var(--accent-primary)',
                      borderRadius: '3px 3px 0 0',
                      transition: 'height 0.3s ease',
                      cursor: 'pointer'
                    }}
                  />
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            <span>Day 1</span>
            <span>Current Day</span>
          </div>
        </div>

        {/* Cost by Dimension Breakdown */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <DollarSign size={20} style={{ color: 'var(--status-warning)' }} />
              <span className="card-title">Cost by Resource Group</span>
            </div>
            <Link to="/costs" style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', textDecoration: 'none' }}>
              View Full Cost Overview →
            </Link>
          </div>

          {(trends.data?.byResourceGroup || []).length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No resource group cost breakdown cached yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {(trends.data?.byResourceGroup || []).slice(0, 5).map((rg, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                    {rg.resourceGroup}
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {formatCurrency(rg.cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
