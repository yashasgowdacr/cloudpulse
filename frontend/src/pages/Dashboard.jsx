import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { dashboardService } from '../services/dashboardService';
import api from '../services/api';
import { Link } from 'react-router-dom';
import {
  Cloud,
  Server,
  DollarSign,
  Sliders,
  History,
  RefreshCw,
  Plus,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  ShieldCheck,
  Play
} from 'lucide-react';

const safeErrString = (errVal, fallback = 'Error loading data') => {
  if (!errVal) return '';
  if (typeof errVal === 'string') return errVal;
  if (typeof errVal === 'object') return errVal.message || errVal.error || fallback;
  return String(errVal);
};

const Dashboard = () => {
  const { user } = useAuth();

  // Data states
  const [connections, setConnections] = useState({ loading: true, data: null, error: null });
  const [vms, setVms] = useState({ loading: true, data: null, error: null, multiConnection: false });
  const [cost, setCost] = useState({ loading: true, data: null, error: null });
  const [policy, setPolicy] = useState({ loading: true, data: null, error: null });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // 1. Fetch Azure Connections
  const fetchConnections = useCallback(async () => {
    setConnections((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await dashboardService.getAzureConnections();
      setConnections({ loading: false, data, error: null });
    } catch (err) {
      const errMsg = safeErrString(err.response?.data?.message || err.response?.data?.error || err.message, 'Failed to load connections.');
      setConnections({ loading: false, data: null, error: errMsg });
    }
  }, []);

  // 2. Fetch Virtual Machines
  const fetchVms = useCallback(async () => {
    setVms((prev) => ({ ...prev, loading: true, error: null, multiConnection: false }));
    try {
      const data = await dashboardService.getVirtualMachines();
      const vmList = Array.isArray(data) ? data : (data?.vms || []);
      setVms({ loading: false, data: vmList, error: null, multiConnection: false });
    } catch (err) {
      if (err.response?.data?.error === 'MULTIPLE_CONNECTIONS_REQUIRED' || err.response?.data?.message?.includes('Multiple')) {
        setVms({ loading: false, data: null, error: 'Multiple active Azure connections found. Select a specific connection to view VM data.', multiConnection: true });
      } else {
        const errMsg = safeErrString(err.response?.data?.message || err.response?.data?.error || err.message, 'Unable to load VM data.');
        setVms({ loading: false, data: null, error: errMsg, multiConnection: false });
      }
    }
  }, []);

  // 3. Fetch Month to Date Cost
  const fetchCost = useCallback(async () => {
    setCost((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await dashboardService.getMonthToDateCost();
      setCost({ loading: false, data, error: null });
    } catch (err) {
      const errMsg = safeErrString(err.response?.data?.message || err.response?.data?.error || err.message, 'Unable to load cost data.');
      setCost({ loading: false, data: null, error: errMsg });
    }
  }, []);

  // 4. Fetch Optimization Policy
  const fetchPolicy = useCallback(async () => {
    setPolicy((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await dashboardService.getOptimizationPolicy();
      setPolicy({ loading: false, data: data?.policy || null, error: null });
    } catch (err) {
      const errMsg = safeErrString(err.response?.data?.message || err.response?.data?.error || err.message, 'Unable to load policy.');
      setPolicy({ loading: false, data: null, error: errMsg });
    }
  }, []);

  // 5. Fetch Action History
  const fetchActions = useCallback(async () => {
    setActions((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await dashboardService.getActionHistory();
      setActions({ loading: false, data: data?.actions || [], error: null });
    } catch (err) {
      const errMsg = safeErrString(err.response?.data?.message || err.response?.data?.error || err.message, 'Unable to load action history.');
      setActions({ loading: false, data: null, error: errMsg });
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      fetchConnections(),
      fetchVms(),
      fetchCost(),
      fetchPolicy()
    ]);
    setIsRefreshing(false);
  }, [fetchConnections, fetchVms, fetchCost, fetchPolicy]);

  const handleRunScan = async () => {
    setIsScanning(true);
    try {
      await api.post('/api/optimization/run-now');
      await loadAllData();
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Derived VM Metrics
  const vmList = vms.data || [];
  const totalVms = vmList.length;
  const runningVms = vmList.filter((v) => (v.status || v.powerState || '').toLowerCase().includes('running')).length;
  const stoppedVms = vmList.filter((v) => {
    const st = (v.status || v.powerState || '').toLowerCase();
    return st.includes('stopped') || st.includes('deallocated');
  }).length;

  // Derived Connections Metrics
  const connList = connections.data?.connections || [];
  const activeConnCount = connList.filter((c) => c.status === 'ACTIVE').length;
  const totalConnCount = connList.length;

  return (
    <div>
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Welcome back, {user?.name || 'User'}!
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Real-time Azure Optimization Dashboard for account <strong style={{ color: 'var(--accent-primary)' }}>{user?.email}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            className="btn btn-primary"
            onClick={handleRunScan}
            disabled={isScanning || isRefreshing}
            style={{ gap: '0.5rem' }}
          >
            <Play size={16} className={isScanning ? 'spinner' : ''} style={isScanning ? { animation: 'spin 1s linear infinite' } : {}} />
            <span>{isScanning ? 'Scanning Azure...' : 'Run Optimization Scan'}</span>
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={loadAllData} 
            disabled={isRefreshing || isScanning}
            style={{ gap: '0.5rem' }}
          >
            <RefreshCw size={16} className={isRefreshing ? 'spinner' : ''} style={isRefreshing ? { animation: 'spin 1s linear infinite' } : {}} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
          </button>
        </div>
      </div>

      {/* Grid Stats Cards */}
      <div className="grid-stats">
        {/* A. Azure Connections */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Azure Connections</span>
            <div style={{ color: 'var(--accent-primary)' }}><Cloud size={20} /></div>
          </div>

          {connections.loading ? (
            <div className="loading-center" style={{ minHeight: '80px' }}>
              <div className="spinner" style={{ width: '1.5rem', height: '1.5rem' }}></div>
            </div>
          ) : connections.error ? (
            <div style={{ color: 'var(--status-error)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {safeErrString(connections.error, 'Failed to load connections.')}
            </div>
          ) : activeConnCount > 0 ? (
            <>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {activeConnCount} Active
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {totalConnCount} Total Registered Connections
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--status-warning)', marginBottom: '0.5rem' }}>
                No Active Connection
              </div>
              <Link to="/azure" className="btn btn-primary" style={{ padding: '0.4rem 0.875rem', fontSize: '0.8125rem' }}>
                <Plus size={14} />
                <span>Connect Azure</span>
              </Link>
            </>
          )}
        </div>

        {/* B. Virtual Machines */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Virtual Machines</span>
            <div style={{ color: 'var(--accent-secondary)' }}><Server size={20} /></div>
          </div>

          {vms.loading ? (
            <div className="loading-center" style={{ minHeight: '80px' }}>
              <div className="spinner" style={{ width: '1.5rem', height: '1.5rem' }}></div>
            </div>
          ) : vms.multiConnection ? (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--status-warning)', marginBottom: '0.5rem' }}>
                Multiple active Azure connections found.
              </div>
              <Link to="/azure" className="btn btn-secondary" style={{ padding: '0.4rem 0.875rem', fontSize: '0.8125rem' }}>
                Select Connection
              </Link>
            </>
          ) : vms.error ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {safeErrString(vms.error, 'Unable to load VM data.')}
            </div>
          ) : (
            <>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {totalVms} VMs
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', gap: '0.75rem' }}>
                <span style={{ color: 'var(--status-success)' }}>● {runningVms} Running</span>
                <span style={{ color: 'var(--text-secondary)' }}>● {stoppedVms} Stopped</span>
              </div>
            </>
          )}
        </div>

        {/* C. Month to Date Cost */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Month-to-Date Spend</span>
            <div style={{ color: 'var(--status-success)' }}><DollarSign size={20} /></div>
          </div>

          {cost.loading ? (
            <div className="loading-center" style={{ minHeight: '80px' }}>
              <div className="spinner" style={{ width: '1.5rem', height: '1.5rem' }}></div>
            </div>
          ) : cost.error ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {safeErrString(cost.error, 'Unable to load cost data.')}
            </div>
          ) : (
            <>
              <div style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                ₹{(cost.data?.totalCost ?? cost.data?.amount) != null ? Number(cost.data?.totalCost ?? cost.data?.amount).toFixed(2) : '0.00'} {cost.data?.currency || 'INR'}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Source: Azure Cost Management API
              </div>
            </>
          )}
        </div>

        {/* D. Optimization Policy */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Optimization Policy</span>
            <div style={{ color: 'var(--status-warning)' }}><Sliders size={20} /></div>
          </div>

          {policy.loading ? (
            <div className="loading-center" style={{ minHeight: '80px' }}>
              <div className="spinner" style={{ width: '1.5rem', height: '1.5rem' }}></div>
            </div>
          ) : policy.error ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {safeErrString(policy.error, 'Unable to load policy.')}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Auto-Shutdown:</span>
                <span className={`badge ${policy.data?.autoShutdown ? 'badge-success' : 'badge-warning'}`}>
                  {policy.data?.autoShutdown ? 'Enabled' : 'Disabled (Safe)'}
                </span>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                Threshold: <strong>{policy.data?.idleCpuThreshold ?? 5}% CPU</strong> ({policy.data?.monitoringWindowMinutes ?? 30}m window)
              </div>
              <div style={{ marginTop: '0.5rem' }}>
                <Link to="/optimization" style={{ fontSize: '0.8125rem', fontWeight: '600' }}>
                  Configure Policy →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
