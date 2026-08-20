import React, { useState, useEffect, useCallback } from 'react';
import { azureConnectionService } from '../services/azureConnectionService';
import { savingsService } from '../services/savingsService';
import { vmService } from '../services/vmService';
import { Link } from 'react-router-dom';
import {
  TrendingDown,
  Cloud,
  RefreshCw,
  Server,
  DollarSign,
  Activity,
  AlertCircle,
  CheckCircle2,
  Info,
  Sliders,
  ShieldCheck,
  Calculator
} from 'lucide-react';

const CostSavings = () => {
  // Connection states
  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [connLoading, setConnLoading] = useState(true);

  // VM discovery states
  const [vms, setVms] = useState([]);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmError, setVmError] = useState('');

  // Selected VM Savings state
  const [selectedVm, setSelectedVm] = useState(null);
  const [savingsResult, setSavingsResult] = useState({ loading: false, data: null, error: null });

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

  // 2. Fetch VMs for Selected Connection
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

  const loadAllSavingsData = useCallback(async () => {
    await fetchConnections();
    await fetchVirtualMachines();
    if (selectedVm) {
      handleCalculateSavings(selectedVm);
    }
  }, [fetchConnections, fetchVirtualMachines, selectedVm]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (selectedConnectionId || connections.length === 1) {
      fetchVirtualMachines();
    }
  }, [selectedConnectionId, fetchVirtualMachines, connections.length]);

  // 3. Calculate Potential Savings for Selected VM
  const handleCalculateSavings = async (vm) => {
    setSelectedVm(vm);
    setSavingsResult({ loading: true, data: null, error: null });
    try {
      const data = await savingsService.getVmSavings(vm.resourceGroup, vm.name, selectedConnectionId);
      setSavingsResult({ loading: false, data, error: null });
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to calculate potential savings for this VM.';
      setSavingsResult({ loading: false, data: null, error: msg });
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
            Potential Cost Savings
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Identify idle Azure VMs and estimate the compute cost that could be avoided
          </p>
        </div>

        <button className="btn btn-secondary" onClick={loadAllSavingsData} disabled={vmLoading || connLoading}>
          <RefreshCw size={16} className={vmLoading ? 'spinner' : ''} style={vmLoading ? { animation: 'spin 1s linear infinite' } : {}} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Prominent Estimate Nature & Cost Distinction Banner */}
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.875rem'
      }}>
        <div style={{ color: 'var(--status-warning)', flexShrink: 0, marginTop: '2px' }}>
          <Info size={20} />
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Estimates Disclaimer:</strong> These are potential savings estimates based on VM CPU utilization metrics and Azure Retail Prices API rates. They are <strong style={{ color: 'var(--status-warning)' }}>not</strong> guaranteed or automatically deducted from your Azure bill. Retail prices are used for estimation; your actual bill may differ due to enterprise discounts, reserved instances, networking, storage, and taxes.
        </div>
      </div>

      {/* Azure Connection Selector (0 active / 1 active / >1 active) */}
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
            Connect an Azure Service Principal to discover idle virtual machines and estimate savings.
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

      {/* Discovered VMs List & Savings Calculation Trigger */}
      {connections.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedVm ? '1fr 1.2fr' : '1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          {/* VM Selection Table */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Server size={22} style={{ color: 'var(--accent-secondary)' }} />
                <span className="card-title">Discovered Virtual Machines</span>
              </div>
              <span className="badge badge-info">{vms.length} VMs</span>
            </div>

            {vmError && (
              <div style={{
                backgroundColor: 'var(--status-error-bg)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem 1rem',
                margin: '1rem',
                color: 'var(--status-error)',
                fontSize: '0.875rem'
              }}>
                {vmError}
              </div>
            )}

            {vmLoading ? (
              <div className="loading-center" style={{ padding: '3rem' }}>
                <div className="spinner"></div>
                <p style={{ fontSize: '0.875rem' }}>Scanning Azure subscription for virtual machines...</p>
              </div>
            ) : vms.length === 0 && !vmError ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No virtual machines discovered. Click "Refresh Data" to rescan.
              </div>
            ) : vms.length > 0 && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>VM Name</th>
                      <th>Resource Group</th>
                      <th>Size</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vms.map((vm, idx) => {
                      const isSelected = selectedVm?.name === vm.name && selectedVm?.resourceGroup === vm.resourceGroup;
                      return (
                        <tr key={idx} style={isSelected ? { backgroundColor: 'rgba(14, 165, 233, 0.1)' } : {}}>
                          <td style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{vm.name}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{vm.resourceGroup}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>{vm.size || 'N/A'}</td>
                          <td>{renderStatusBadge(vm.status)}</td>
                          <td>
                            <button
                              className={`btn ${isSelected ? 'btn-primary' : 'btn-secondary'}`}
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                              onClick={() => handleCalculateSavings(vm)}
                            >
                              <Calculator size={14} />
                              <span>{isSelected ? 'Selected' : 'Estimate'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Detailed Savings Calculation Result Card */}
          {selectedVm && (
            <div className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <TrendingDown size={22} style={{ color: 'var(--status-success)' }} />
                  <span className="card-title">Savings Estimate Breakdown</span>
                </div>
                <span className="badge badge-warning">Estimate</span>
              </div>

              {savingsResult.loading ? (
                <div className="loading-center" style={{ padding: '3rem' }}>
                  <div className="spinner"></div>
                  <p style={{ fontSize: '0.875rem' }}>Calculating potential savings for {selectedVm.name}...</p>
                </div>
              ) : savingsResult.error ? (
                <div style={{
                  backgroundColor: 'var(--status-error-bg)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1rem',
                  color: 'var(--status-error)',
                  fontSize: '0.875rem'
                }}>
                  {savingsResult.error}
                </div>
              ) : savingsResult.data && (
                <div>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {savingsResult.data.vmName}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      Resource Group: {savingsResult.data.resourceGroup} | Size: {savingsResult.data.vmSize || 'N/A'} ({savingsResult.data.region})
                    </div>
                  </div>

                  {/* Savings Cards Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>
                        Potential Hourly Savings
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--status-success)', marginTop: '0.25rem' }}>
                        ${Number(savingsResult.data.potentialHourlySavings || 0).toFixed(4)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {savingsResult.data.currency || 'USD'} / hour
                      </div>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>
                        Potential 30-Min Savings
                      </div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--status-success)', marginTop: '0.25rem' }}>
                        ${Number(savingsResult.data.potential30MinuteSavings || 0).toFixed(4)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {savingsResult.data.currency || 'USD'} per window
                      </div>
                    </div>
                  </div>

                  {/* Metrics & Status Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Idle Status</div>
                      <div style={{ marginTop: '0.25rem' }}>
                        <span className={`badge ${savingsResult.data.idle ? 'badge-success' : 'badge-warning'}`}>
                          {savingsResult.data.idle ? 'IDLE' : 'NOT IDLE'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>CPU Average</div>
                      <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                        {savingsResult.data.cpuAverage != null ? `${Number(savingsResult.data.cpuAverage).toFixed(2)}%` : 'CPU data unavailable'}
                      </div>
                    </div>
                  </div>

                  {/* Pricing Details */}
                  <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600', marginBottom: '0.375rem' }}>
                      Retail Pricing Source
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: '600' }}>
                      ${savingsResult.data.hourlyPrice != null ? Number(savingsResult.data.hourlyPrice).toFixed(4) : 'N/A'} {savingsResult.data.currency || 'USD'} / hr
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Source: {savingsResult.data.source || 'Azure Retail Prices API'}
                    </div>
                  </div>

                  {/* Reason Text */}
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5, padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                    {savingsResult.data.reason}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CostSavings;
