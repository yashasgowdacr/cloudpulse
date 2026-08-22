import React, { useState, useEffect, useCallback } from 'react';
import { azureConnectionService } from '../services/azureConnectionService';
import { vmService } from '../services/vmService';
import { dashboardService } from '../services/dashboardService';
import { Link } from 'react-router-dom';
import {
  Server,
  Cloud,
  RefreshCw,
  Sliders,
  Activity,
  DollarSign,
  TrendingDown,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Eye,
  X,
  Play,
  Pause,
  Power
} from 'lucide-react';

const safeText = (val, fallback = '') => {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (typeof val.reason === 'string') return val.reason;
    if (typeof val.message === 'string') return val.message;
    if (typeof val.error === 'string') return val.error;
    if (val.reason && typeof val.reason === 'object') return safeText(val.reason, fallback);
  }
  return fallback;
};

const VirtualMachines = () => {
  // Connection states
  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [connLoading, setConnLoading] = useState(true);

  // VM discovery state
  const [vms, setVms] = useState([]);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmError, setVmError] = useState('');

  // Policy state
  const [policy, setPolicy] = useState(null);

  // VM Details Modal state
  const [selectedVm, setSelectedVm] = useState(null);
  const [metrics, setMetrics] = useState({ loading: false, data: null, error: null });
  const [price, setPrice] = useState({ loading: false, data: null, error: null });
  const [savings, setSavings] = useState({ loading: false, data: null, error: null });
  const [dryRun, setDryRun] = useState({ loading: false, data: null, error: null });
  const [deallocating, setDeallocating] = useState(false);
  const [deallocateMsg, setDeallocateMsg] = useState(null);

  // 1. Fetch Azure Connections
  const fetchConnections = useCallback(async () => {
    setConnLoading(true);
    try {
      const data = await azureConnectionService.getAzureConnections();
      const list = (data.connections || []).filter((c) => c.status === 'ACTIVE');
      setConnections(list);

      if (list.length === 1) {
        setSelectedConnectionId(list[0].id);
      } else if (list.length > 1 && !selectedConnectionId) {
        setSelectedConnectionId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load connections:', err);
    } finally {
      setConnLoading(false);
    }
  }, [selectedConnectionId]);

  // 2. Fetch User Optimization Policy
  const fetchPolicy = useCallback(async () => {
    try {
      const data = await dashboardService.getOptimizationPolicy();
      setPolicy(data.policy || null);
    } catch (err) {
      console.error('Failed to load policy:', err);
    }
  }, []);

  // 3. Fetch VMs for Selected Connection
  const fetchVirtualMachines = useCallback(async () => {
    if (!selectedConnectionId && connections.length > 1) return;

    setVmLoading(true);
    setVmError('');
    try {
      const data = await vmService.getVirtualMachines(selectedConnectionId);
      setVms(data.vms || []);
    } catch (err) {
      if (err.response?.data?.error === 'MULTIPLE_CONNECTIONS_REQUIRED') {
        setVmError('Multiple active Azure connections found. Please select a connection above.');
      } else {
        const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to discover virtual machines.';
        setVmError(msg);
      }
      setVms([]);
    } finally {
      setVmLoading(false);
    }
  }, [selectedConnectionId, connections.length]);

  useEffect(() => {
    fetchConnections();
    fetchPolicy();
  }, [fetchConnections, fetchPolicy]);

  useEffect(() => {
    if (selectedConnectionId || connections.length === 1) {
      fetchVirtualMachines();
    }
  }, [selectedConnectionId, fetchVirtualMachines, connections.length]);

  // 4. Fetch Details for Selected VM (Independent API calls)
  const loadVmDetails = async (vm) => {
    setSelectedVm(vm);
    setDeallocateMsg(null);

    const rg = vm.resourceGroup;
    const name = vm.name;

    // Reset details states
    setMetrics({ loading: true, data: null, error: null });
    setPrice({ loading: true, data: null, error: null });
    setSavings({ loading: true, data: null, error: null });
    setDryRun({ loading: true, data: null, error: null });

    // A. CPU Metrics
    vmService.getVmMetrics(rg, name, selectedConnectionId)
      .then((data) => setMetrics({ loading: false, data, error: null }))
      .catch((err) => setMetrics({ loading: false, data: null, error: 'CPU data unavailable' }));

    // B. VM Pricing
    vmService.getVmPrice(rg, name, selectedConnectionId)
      .then((data) => setPrice({ loading: false, data, error: null }))
      .catch((err) => setPrice({ loading: false, data: null, error: 'Pricing data unavailable' }));

    // C. Potential Savings
    vmService.getVmSavings(rg, name, selectedConnectionId)
      .then((data) => setSavings({ loading: false, data, error: null }))
      .catch((err) => setSavings({ loading: false, data: null, error: 'Savings calculation unavailable' }));

    // D. Shutdown Preview / Dry Run
    vmService.getVmShutdownDryRun(rg, name, selectedConnectionId)
      .then((data) => setDryRun({ loading: false, data, error: null }))
      .catch((err) => setDryRun({ loading: false, data: null, error: 'Shutdown preview unavailable' }));
  };

  const handleExecuteShutdown = async (vm) => {
    setDeallocating(true);
    setDeallocateMsg(null);
    try {
      const res = await vmService.shutdownVm(vm.resourceGroup, vm.name, selectedConnectionId);
      if (res.executed) {
        setDeallocateMsg({ type: 'success', text: res.reason || `Successfully deallocated VM '${vm.name}' on Azure.` });
      } else {
        setDeallocateMsg({ type: 'warning', text: res.reason || `Deallocation blocked or skipped.` });
      }
      await fetchVirtualMachines();
      loadVmDetails(vm);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Deallocation failed.';
      setDeallocateMsg({ type: 'error', text: msg });
    } finally {
      setDeallocating(false);
    }
  };

  const renderStatusBadge = (status) => {
    const st = (status || '').toLowerCase();
    if (st.includes('running')) {
      return <span className="badge badge-success">Running</span>;
    }
    if (st.includes('stopped') || st.includes('deallocated')) {
      return <span className="badge badge-warning">Deallocated / Stopped</span>;
    }
    return <span className="badge badge-info">{status || 'Unknown'}</span>;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            Virtual Machines
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Monitor the Azure virtual machines connected to your CloudPulse account
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchVirtualMachines} disabled={vmLoading || connLoading}>
          <RefreshCw size={16} className={vmLoading ? 'spinner' : ''} style={vmLoading ? { animation: 'spin 1s linear infinite' } : {}} />
          <span>Discover VMs</span>
        </button>
      </div>

      {/* Policy Awareness Header Banner */}
      {policy && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '0.875rem 1.25rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Sliders size={20} style={{ color: 'var(--status-warning)' }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: '500' }}>
              Active Policy: Idle CPU Threshold <strong>{policy.idleCpuThreshold}%</strong> | Window: <strong>{policy.monitoringWindowMinutes}m</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className={`badge ${policy.autoShutdown ? 'badge-success' : 'badge-warning'}`}>
              {policy.autoShutdown ? 'Auto-Shutdown Enabled' : 'Auto-Shutdown Disabled (Safe)'}
            </span>
            <Link to="/optimization" style={{ fontSize: '0.8125rem', fontWeight: '600' }}>
              Policy Settings →
            </Link>
          </div>
        </div>
      )}

      {/* Connection Selector (No active connections / 1 active / >1 active) */}
      {connLoading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
          <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Loading Azure subscriptions...</p>
        </div>
      ) : connections.length === 0 ? (
        <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', margin: '0 auto 1rem' }}>
            <Cloud size={28} />
          </div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            No active Azure subscription connected
          </h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', margin: '0 auto 1.5rem', fontSize: '0.875rem' }}>
            Please connect an Azure Service Principal to discover and monitor virtual machines.
          </p>
          <Link to="/azure" className="btn btn-primary">
            <span>Connect Azure</span>
          </Link>
        </div>
      ) : connections.length > 1 ? (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Cloud size={20} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
              Azure Subscription:
            </span>
          </div>

          <div style={{ minWidth: '300px' }}>
            <select
              value={selectedConnectionId}
              onChange={(e) => setSelectedConnectionId(e.target.value)}
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--accent-primary)', fontWeight: '500' }}
            >
              {connections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.connectionName} ({conn.subscriptionId})
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {/* Main VM Table */}
      {connections.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Server size={22} style={{ color: 'var(--accent-secondary)' }} />
              <span className="card-title">Discovered Virtual Machines</span>
            </div>
            <span className="badge badge-info">{vms.length} VMs Discovered</span>
          </div>

          {vmError && (
            <div style={{
              backgroundColor: 'var(--status-error-bg)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1rem',
              margin: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              color: 'var(--status-error)',
              fontSize: '0.875rem'
            }}>
              <AlertCircle size={18} />
              <span>{vmError}</span>
            </div>
          )}

          {vmLoading ? (
            <div className="loading-center" style={{ padding: '3rem' }}>
              <div className="spinner"></div>
              <p style={{ fontSize: '0.875rem' }}>Scanning Azure subscription for virtual machines...</p>
            </div>
          ) : vms.length === 0 && !vmError ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No virtual machines discovered in this Azure subscription. Click "Discover VMs" to rescan.
            </div>
          ) : vms.length > 0 && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>VM Name</th>
                    <th>Resource Group</th>
                    <th>Region</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {vms.map((vm, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>
                        {vm.name}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        {vm.resourceGroup}
                      </td>
                      <td>{vm.location || 'N/A'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        {vm.size || 'N/A'}
                      </td>
                      <td>{renderStatusBadge(vm.status)}</td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                          onClick={() => loadVmDetails(vm)}
                        >
                          <Eye size={14} />
                          <span>View Details</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VM Details Modal */}
      {selectedVm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: '680px',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header (Fixed at top) */}
            <div style={{
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-secondary)',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Server size={24} style={{ color: 'var(--accent-primary)' }} />
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {selectedVm.name}
                  </h2>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    RG: {selectedVm.resourceGroup} | Region: {selectedVm.location}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setSelectedVm(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>

            {/* General Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Power State</div>
                <div style={{ marginTop: '0.25rem' }}>{renderStatusBadge(selectedVm.status)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>VM Size</div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
                  {selectedVm.size || 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Location</div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  {selectedVm.location || 'N/A'}
                </div>
              </div>
            </div>

            {/* Independent Details Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
              {/* CPU Metrics */}
              <div className="card" style={{ padding: '1rem' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Activity size={16} style={{ color: 'var(--accent-primary)' }} />
                  <span>CPU Metrics (30m Window)</span>
                </div>

                {metrics.loading ? (
                  <div className="loading-center" style={{ minHeight: '60px' }}><div className="spinner" style={{ width: '1.25rem', height: '1.25rem' }}></div></div>
                ) : metrics.error ? (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {safeText(metrics.error, 'CPU data unavailable')}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {(metrics.data?.averageCpuPercentage ?? metrics.data?.average) != null ? `${Number(metrics.data?.averageCpuPercentage ?? metrics.data?.average).toFixed(2)}%` : 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {metrics.data?.dataPointsCount ?? (Array.isArray(metrics.data?.dataPoints) ? metrics.data.dataPoints.length : (typeof metrics.data?.dataPoints === 'number' ? metrics.data.dataPoints : 0))} data points aggregated
                    </div>
                  </div>
                )}
              </div>

              {/* Price Information */}
              <div className="card" style={{ padding: '1rem' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <DollarSign size={16} style={{ color: 'var(--status-success)' }} />
                  <span>Azure Retail Price</span>
                </div>

                {price.loading ? (
                  <div className="loading-center" style={{ minHeight: '60px' }}><div className="spinner" style={{ width: '1.25rem', height: '1.25rem' }}></div></div>
                ) : price.error ? (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {safeText(price.error, 'Pricing data unavailable')}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      ₹{price.data?.hourlyPrice != null ? Number(price.data.hourlyPrice).toFixed(4) : '0.00'}/hr
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Currency: {price.data?.currency || 'INR'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Estimated Savings Banner */}
            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingDown size={16} style={{ color: 'var(--status-success)' }} />
                <span>Estimated Potential Savings</span>
              </div>

              {savings.loading ? (
                <div className="loading-center" style={{ minHeight: '60px' }}><div className="spinner" style={{ width: '1.25rem', height: '1.25rem' }}></div></div>
              ) : savings.error ? (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {safeText(savings.error, 'Savings calculation unavailable')}
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--status-success)' }}>
                      ₹{savings.data?.potentialHourlySavings != null ? Number(savings.data.potentialHourlySavings).toFixed(4) : '0.00'} / hr
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Calculated over {savings.data?.monitoringWindow || 'PT30M'} monitoring window
                    </div>
                  </div>
                  <span className={`badge ${(savings.data?.idle ?? savings.data?.isIdle) ? 'badge-success' : 'badge-warning'}`}>
                    {(savings.data?.idle ?? savings.data?.isIdle) ? 'Idle VM Detected' : 'Active / Non-Idle'}
                  </span>
                </div>
              )}
            </div>

            {/* Shutdown Preview / Live Execution Card */}
            <div className="card" style={{
              padding: '1.25rem',
              border: dryRun.data?.dryRun === false ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
              backgroundColor: dryRun.data?.dryRun === false ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.05)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={18} style={{ color: dryRun.data?.dryRun === false ? 'var(--status-success)' : 'var(--status-warning)' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {dryRun.data?.dryRun === false ? 'Live Deallocation Mode (DRY_RUN=false)' : 'Shutdown Preview (DRY_RUN Enabled)'}
                  </span>
                </div>
                <span className={`badge ${dryRun.data?.dryRun === false ? 'badge-success' : 'badge-warning'}`}>
                  {dryRun.data?.dryRun === false ? 'LIVE MODE' : 'Preview Only'}
                </span>
              </div>

              {dryRun.loading ? (
                <div className="loading-center" style={{ minHeight: '50px' }}><div className="spinner" style={{ width: '1.25rem', height: '1.25rem' }}></div></div>
              ) : dryRun.error ? (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {safeText(dryRun.error, 'Shutdown preview unavailable')}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    CPU Avg: <strong>{(dryRun.data?.cpuAverage ?? dryRun.data?.policy?.cpuAverage) != null ? `${Number(dryRun.data?.cpuAverage ?? dryRun.data?.policy?.cpuAverage).toFixed(2)}%` : 'N/A'}</strong> | Threshold: <strong>{dryRun.data?.idleCpuThreshold ?? 5}%</strong>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Would Deallocate: <strong style={{ color: (dryRun.data?.wouldExecute ?? dryRun.data?.willDeallocate) ? 'var(--status-success)' : 'var(--status-warning)' }}>{(dryRun.data?.wouldExecute ?? dryRun.data?.willDeallocate) ? 'YES' : 'NO'}</strong> ({safeText(dryRun.data?.reason, 'Evaluated')})
                  </div>
                </div>
              )}

              {deallocateMsg && (
                <div style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem',
                  marginBottom: '0.75rem',
                  color: deallocateMsg.type === 'success' ? 'var(--status-success)' : (deallocateMsg.type === 'error' ? 'var(--status-error)' : 'var(--status-warning)'),
                  backgroundColor: deallocateMsg.type === 'success' ? 'var(--status-success-bg)' : (deallocateMsg.type === 'error' ? 'var(--status-error-bg)' : 'rgba(245, 158, 11, 0.1)')
                }}>
                  {deallocateMsg.text}
                </div>
              )}

              {dryRun.data?.dryRun === false ? (
                <button
                  className="btn btn-primary"
                  onClick={() => handleExecuteShutdown(selectedVm)}
                  disabled={deallocating || (selectedVm?.status || '').toLowerCase().includes('stopped') || (selectedVm?.status || '').toLowerCase().includes('deallocated')}
                  style={{ width: '100%', gap: '0.5rem', fontSize: '0.8125rem' }}
                >
                  <Power size={16} className={deallocating ? 'spinner' : ''} style={deallocating ? { animation: 'spin 1s linear infinite' } : {}} />
                  <span>{deallocating ? 'Deallocating Live on Azure...' : 'Deallocate VM Live Now'}</span>
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  disabled
                  style={{ width: '100%', opacity: 0.6, cursor: 'not-allowed', fontSize: '0.8125rem' }}
                >
                  Shutdown unavailable while Dry Run is enabled
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default VirtualMachines;
