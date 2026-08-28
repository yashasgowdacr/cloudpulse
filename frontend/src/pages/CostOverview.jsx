import React, { useState, useEffect, useCallback } from 'react';
import { azureConnectionService } from '../services/azureConnectionService';
import { costService } from '../services/costService';
import { vmService } from '../services/vmService';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  Cloud,
  RefreshCw,
  Search,
  PieChart,
  Info,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Server,
  Layers
} from 'lucide-react';

const formatCurrency = (amount, currencyCode = 'USD') => {
  const num = Number(amount || 0);
  const formattedNum = num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const code = (currencyCode || 'USD').toUpperCase().trim();
  const currencySymbols = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    JPY: '¥'
  };

  const symbol = currencySymbols[code];
  if (symbol) {
    return `${symbol}${formattedNum}`;
  }

  return `${code} ${formattedNum}`;
};

const CostOverview = () => {
  // Connection states
  const [connections, setConnections] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [connLoading, setConnLoading] = useState(true);

  // Month-To-Date Cost state
  const [mtdCost, setMtdCost] = useState({ loading: true, data: null, error: null });

  // Resource Lookup state
  const [discoveredResources, setDiscoveredResources] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [selectedResourceKey, setSelectedResourceKey] = useState('');
  const [customRg, setCustomRg] = useState('');
  const [customName, setCustomName] = useState('');

  const [lookupResult, setLookupResult] = useState({ loading: false, data: null, error: null });

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

  // 2. Fetch Month-To-Date Cost
  const fetchMtdCost = useCallback(async () => {
    setMtdCost({ loading: true, data: null, error: null });
    try {
      const data = await costService.getMonthToDateCost(selectedConnectionId);
      setMtdCost({ loading: false, data, error: null });
    } catch (err) {
      if (err.response?.data?.error === 'MULTIPLE_CONNECTIONS_REQUIRED') {
        setMtdCost({ loading: false, data: null, error: 'Multiple active Azure connections found. Please select a connection above.' });
      } else if (err.response?.data?.error === 'COST_DATA_TEMPORARILY_UNAVAILABLE' || err.response?.status === 429) {
        setMtdCost({ loading: false, data: null, error: 'Azure Cost Management API is temporarily throttling requests. Please retry shortly.' });
      } else if (err.response?.status === 403) {
        setMtdCost({ loading: false, data: null, error: 'Insufficient Azure permissions to access Azure Cost Management API.' });
      } else {
        const msg = err.response?.data?.message || err.response?.data?.error || 'Unable to fetch Month-to-Date cost data.';
        setMtdCost({ loading: false, data: null, error: msg });
      }
    }
  }, [selectedConnectionId]);

  // 3. Fetch Discovered Resources (VMs) for Resource Cost Lookup Dropdown
  const fetchDiscoveredResources = useCallback(async () => {
    if (!selectedConnectionId && connections.length > 1) return;

    setResourcesLoading(true);
    try {
      const data = await vmService.getVirtualMachines(selectedConnectionId);
      setDiscoveredResources(data.vms || []);
    } catch (err) {
      setDiscoveredResources([]);
    } finally {
      setResourcesLoading(false);
    }
  }, [selectedConnectionId, connections.length]);

  const loadAllCostData = useCallback(async () => {
    await fetchConnections();
    await fetchMtdCost();
    await fetchDiscoveredResources();
  }, [fetchConnections, fetchMtdCost, fetchDiscoveredResources]);

  useEffect(() => {
    fetchConnections();
  }, []);

  useEffect(() => {
    if (selectedConnectionId || (connections.length === 1 && !connLoading)) {
      fetchMtdCost();
      fetchDiscoveredResources();
    }
  }, [selectedConnectionId, connLoading]);

  // 4. Resource Cost Lookup Handler
  const handleResourceLookup = async (rg, name) => {
    if (!rg || !name) return;
    setLookupResult({ loading: true, data: null, error: null });
    try {
      const data = await costService.getResourceCost(rg.trim(), name.trim(), selectedConnectionId);
      setLookupResult({ loading: false, data, error: null });
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to query resource cost.';
      setLookupResult({ loading: false, data: null, error: msg });
    }
  };

  const handleDropdownSelect = (e) => {
    const val = e.target.value;
    setSelectedResourceKey(val);
    if (!val) {
      setLookupResult({ loading: false, data: null, error: null });
      return;
    }

    const [rg, name] = val.split('::');
    setCustomRg(rg);
    setCustomName(name);
    handleResourceLookup(rg, name);
  };

  const handleCustomSearchSubmit = (e) => {
    e.preventDefault();
    if (!customRg.trim() || !customName.trim()) return;
    setSelectedResourceKey('');
    handleResourceLookup(customRg.trim(), customName.trim());
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            Cost Overview
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Track your Azure spending and understand where your subscription costs are coming from
          </p>
        </div>

        <button className="btn btn-secondary" onClick={loadAllCostData} disabled={mtdCost.loading || connLoading}>
          <RefreshCw size={16} className={mtdCost.loading ? 'spinner' : ''} style={mtdCost.loading ? { animation: 'spin 1s linear infinite' } : {}} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Distinction Banner: Actual Billed Cost vs Potential Savings */}
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
        <div style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '2px' }}>
          <Info size={20} />
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-primary)' }}>Actual Billed Cost vs. Potential Savings:</strong> This page displays <span style={{ color: 'var(--status-success)', fontWeight: '600' }}>Actual Billed Azure Cost Management Data</span> aggregated for the current month-to-date period. Note that <em>Potential Savings</em> (calculated on the Savings page) represent estimated future cost reductions on idle VMs and are <strong>not</strong> deducted automatically from your billed cost until resources are deallocated.
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
            Connect an Azure Service Principal to query Azure Cost Management API data for your account.
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

      {/* Main Content Grid */}
      {connections.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          {/* Month-To-Date Cost Card */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Month-to-Date Spend</span>
              <div style={{ color: 'var(--status-success)' }}><DollarSign size={22} /></div>
            </div>

            {mtdCost.loading ? (
              <div className="loading-center" style={{ minHeight: '120px' }}>
                <div className="spinner"></div>
                <p style={{ fontSize: '0.8125rem' }}>Querying Azure Cost Management API...</p>
              </div>
            ) : mtdCost.error ? (
              <div style={{ color: 'var(--status-error)', fontSize: '0.875rem', padding: '1rem 0' }}>
                {mtdCost.error}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
                  {formatCurrency(
                    mtdCost.data?.totalCost != null ? mtdCost.data.totalCost : mtdCost.data?.amount,
                    mtdCost.data?.currency
                  )}{' '}
                  <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                    {mtdCost.data?.currency || 'USD'}
                  </span>
                </div>

                {mtdCost.data?.isStale && (
                  <div style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.12)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem 0.75rem',
                    marginBottom: '0.75rem',
                    fontSize: '0.78125rem',
                    color: '#eab308',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem'
                  }}>
                    <strong style={{ fontWeight: '600' }}>⚠️ Showing last known Azure cost</strong>
                    <span>{mtdCost.data.staleReason || 'Azure Cost Management is temporarily throttling requests.'}</span>
                    {mtdCost.data.cachedAt && (
                      <span style={{ opacity: 0.85, fontSize: '0.75rem' }}>
                        Last updated: {new Date(mtdCost.data.cachedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  <div>Timeframe: <strong style={{ color: 'var(--text-primary)' }}>MonthToDate</strong></div>
                  <div>Source: <strong style={{ color: 'var(--accent-primary)' }}>{mtdCost.data?.source || 'Azure Cost Management API'}</strong></div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Metrics Card */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Tracked Subscriptions & Scope</span>
              <div style={{ color: 'var(--accent-secondary)' }}><Layers size={22} /></div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Active Scope</div>
                <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  {connections.find((c) => c.id === selectedConnectionId)?.subscriptionId || 'Subscription Scope'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Discovered Resources</div>
                <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  {discoveredResources.length} Azure Virtual Machines
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resource Level Cost Lookup Tool */}
      {connections.length > 0 && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Search size={22} style={{ color: 'var(--accent-primary)' }} />
              <span className="card-title">Resource Level Cost Lookup</span>
            </div>
            <span className="badge badge-info">Azure Cost Management API</span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            Query month-to-date billed usage for specific virtual machines or Azure resources.
          </p>

          {/* Selection Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
            {/* Select Discovered VM */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                Select Discovered VM
              </label>
              <select
                value={selectedResourceKey}
                onChange={handleDropdownSelect}
                disabled={resourcesLoading || discoveredResources.length === 0}
              >
                <option value="">-- Choose Discovered VM --</option>
                {discoveredResources.map((vm, idx) => (
                  <option key={idx} value={`${vm.resourceGroup}::${vm.name}`}>
                    {vm.name} ({vm.resourceGroup})
                  </option>
                ))}
              </select>
            </div>

            {/* Custom RG / Name Form */}
            <form onSubmit={handleCustomSearchSubmit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
                  Or Enter Resource Group & Name
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Resource Group"
                    value={customRg}
                    onChange={(e) => setCustomRg(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    placeholder="Resource Name"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={lookupResult.loading}>
                <Search size={16} />
                <span>Lookup</span>
              </button>
            </form>
          </div>

          {/* Lookup Result Display */}
          {lookupResult.loading ? (
            <div className="loading-center" style={{ padding: '2rem' }}>
              <div className="spinner"></div>
              <p style={{ fontSize: '0.875rem' }}>Querying Azure Cost Management for resource cost data...</p>
            </div>
          ) : lookupResult.error ? (
            <div style={{
              backgroundColor: 'var(--status-error-bg)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem 1rem',
              color: 'var(--status-error)',
              fontSize: '0.875rem'
            }}>
              {lookupResult.error}
            </div>
          ) : lookupResult.data && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {lookupResult.data.resourceName}
                  </h3>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    Resource Group: {lookupResult.data.resourceGroup}
                  </span>
                </div>

                <span className={`badge ${lookupResult.data.isEstimated ? 'badge-info' : (lookupResult.data.dataFound ? 'badge-success' : 'badge-warning')}`}>
                  {lookupResult.data.isEstimated ? '⚡ Retail Estimate' : (lookupResult.data.dataFound ? 'Billed Record Found' : 'No Billed Usage Found')}
                </span>
              </div>

              {lookupResult.data.isEstimated ? (
                <div style={{
                  backgroundColor: 'rgba(14, 165, 233, 0.12)',
                  border: '1px solid rgba(14, 165, 233, 0.4)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}>
                  <strong style={{ fontWeight: '600' }}>⚡ Estimated Retail Cost</strong>
                  <span>Actual Azure billing data is temporarily unavailable.</span>
                  <span>This is an estimate based on Azure retail pricing, not actual billed cost.</span>
                </div>
              ) : lookupResult.data.isStale && (
                <div style={{
                  backgroundColor: 'rgba(234, 179, 8, 0.12)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  fontSize: '0.8125rem',
                  color: '#eab308',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}>
                  <strong style={{ fontWeight: '600' }}>⚠️ Showing last known Azure cost</strong>
                  <span>{lookupResult.data.staleReason || 'Azure Cost Management is temporarily throttling requests.'}</span>
                </div>
              )}

              <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                {formatCurrency(lookupResult.data.totalCost, lookupResult.data.currency)}{' '}
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  {lookupResult.data.currency || 'USD'}
                </span>
              </div>

              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {lookupResult.data.reason}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CostOverview;
