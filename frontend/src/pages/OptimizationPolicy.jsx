import React, { useState, useEffect, useCallback } from 'react';
import { optimizationPolicyService } from '../services/optimizationPolicyService';
import {
  Sliders,
  ShieldCheck,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Info,
  Power,
  Clock,
  Activity,
  AlertTriangle,
  X,
  Calendar,
  Sun,
  Moon,
  Globe,
  Layers,
  Plus,
  Trash2,
  Tag,
  Filter
} from 'lucide-react';

const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' }
];

const DAYS_OPTIONS = [
  { value: '1,2,3,4,5', label: 'Weekdays Only (Mon – Fri)' },
  { value: '0,1,2,3,4,5,6', label: 'Every Day (Mon – Sun)' },
  { value: '6,0', label: 'Weekends Only (Sat – Sun)' }
];

const SCOPE_TYPES = [
  { value: 'RESOURCE_GROUP', label: 'Resource Group', hint: 'Applies to all VMs in a specific Resource Group' },
  { value: 'VM_TAG', label: 'VM Tag (Key=Value)', hint: 'e.g. Env=Staging or Dept=QA' },
  { value: 'VM_NAME_PATTERN', label: 'VM Name Pattern (Regex or Prefix)', hint: 'e.g. dev-*, test-* or ^stage-.*' },
  { value: 'SUBSCRIPTION', label: 'Subscription ID', hint: 'Applies to all VMs within an Azure Subscription' }
];

const OptimizationPolicy = () => {
  const [activeTab, setActiveTab] = useState('global'); // 'global' | 'scopes'

  // Saved backend policy state
  const [savedPolicy, setSavedPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Editable Form State: CPU Threshold & Window
  const [idleCpuThreshold, setIdleCpuThreshold] = useState(5.0);
  const [monitoringWindowMinutes, setMonitoringWindowMinutes] = useState(30);
  const [autoShutdown, setAutoShutdown] = useState(false);

  // Editable Form State: Scheduled Automation
  const [scheduledShutdownEnabled, setScheduledShutdownEnabled] = useState(false);
  const [scheduledShutdownTime, setScheduledShutdownTime] = useState('19:00');
  const [scheduledStartEnabled, setScheduledStartEnabled] = useState(false);
  const [scheduledStartTime, setScheduledStartTime] = useState('07:00');
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC');
  const [scheduleDays, setScheduleDays] = useState('1,2,3,4,5');

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Scoped Policies State
  const [scopes, setScopes] = useState([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [showCreateScopeModal, setShowCreateScopeModal] = useState(false);
  const [newScope, setNewScope] = useState({
    scopeType: 'RESOURCE_GROUP',
    scopeValue: '',
    idleCpuThreshold: 5.0,
    monitoringWindowMinutes: 30,
    autoShutdown: false
  });
  const [creatingScope, setCreatingScope] = useState(false);

  // Confirmation Modal State
  const [showEnableModal, setShowEnableModal] = useState(false);

  // Load Policy from Backend
  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await optimizationPolicyService.getOptimizationPolicy();
      const p = data.policy;
      setSavedPolicy(p);
      setIdleCpuThreshold(p.idleCpuThreshold ?? 5.0);
      setMonitoringWindowMinutes(p.monitoringWindowMinutes ?? 30);
      setAutoShutdown(Boolean(p.autoShutdown));
      setScheduledShutdownEnabled(Boolean(p.scheduledShutdownEnabled));
      setScheduledShutdownTime(p.scheduledShutdownTime || '19:00');
      setScheduledStartEnabled(Boolean(p.scheduledStartEnabled));
      setScheduledStartTime(p.scheduledStartTime || '07:00');
      setScheduleTimezone(p.scheduleTimezone || 'UTC');
      setScheduleDays(p.scheduleDays || '1,2,3,4,5');
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to fetch optimization policy.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchScopes = useCallback(async () => {
    setScopesLoading(true);
    try {
      const data = await optimizationPolicyService.getPolicyScopes();
      setScopes(data.scopes || []);
    } catch (err) {
      console.error('Failed to fetch policy scopes:', err);
    } finally {
      setScopesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
    fetchScopes();
  }, [fetchPolicy, fetchScopes]);

  // Check for unsaved changes
  const hasUnsavedChanges = savedPolicy && (
    Number(idleCpuThreshold) !== Number(savedPolicy.idleCpuThreshold) ||
    Number(monitoringWindowMinutes) !== Number(savedPolicy.monitoringWindowMinutes) ||
    Boolean(autoShutdown) !== Boolean(savedPolicy.autoShutdown) ||
    Boolean(scheduledShutdownEnabled) !== Boolean(savedPolicy.scheduledShutdownEnabled) ||
    (scheduledShutdownTime || '') !== (savedPolicy.scheduledShutdownTime || '') ||
    Boolean(scheduledStartEnabled) !== Boolean(savedPolicy.scheduledStartEnabled) ||
    (scheduledStartTime || '') !== (savedPolicy.scheduledStartTime || '') ||
    (scheduleTimezone || 'UTC') !== (savedPolicy.scheduleTimezone || 'UTC') ||
    (scheduleDays || '1,2,3,4,5') !== (savedPolicy.scheduleDays || '1,2,3,4,5')
  );

  // Form Save Execution
  const executeSave = async (autoShutdownVal = autoShutdown) => {
    setFormError('');
    setSuccessMsg('');

    const numThreshold = Number(idleCpuThreshold);
    const numWindow = Number(monitoringWindowMinutes);

    // Client-side Validation
    if (isNaN(numThreshold) || numThreshold < 0 || numThreshold > 100) {
      setFormError('Idle CPU Threshold must be a number between 0 and 100.');
      return;
    }

    if (!Number.isInteger(numWindow) || numWindow < 5 || numWindow > 1440) {
      setFormError('Monitoring Window must be an integer between 5 and 1440 minutes.');
      return;
    }

    if (scheduledShutdownEnabled && !scheduledShutdownTime) {
      setFormError('Scheduled shutdown time must be set when scheduled shutdown is enabled.');
      return;
    }

    if (scheduledStartEnabled && !scheduledStartTime) {
      setFormError('Scheduled start time must be set when scheduled start is enabled.');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        idleCpuThreshold: numThreshold,
        monitoringWindowMinutes: numWindow,
        autoShutdown: Boolean(autoShutdownVal),
        scheduledShutdownEnabled: Boolean(scheduledShutdownEnabled),
        scheduledShutdownTime: scheduledShutdownEnabled ? scheduledShutdownTime : null,
        scheduledStartEnabled: Boolean(scheduledStartEnabled),
        scheduledStartTime: scheduledStartEnabled ? scheduledStartTime : null,
        scheduleTimezone,
        scheduleDays
      };

      const result = await optimizationPolicyService.updateOptimizationPolicy(payload);

      const updated = result.policy;
      setSavedPolicy(updated);
      setIdleCpuThreshold(updated.idleCpuThreshold);
      setMonitoringWindowMinutes(updated.monitoringWindowMinutes);
      setAutoShutdown(updated.autoShutdown);
      setScheduledShutdownEnabled(Boolean(updated.scheduledShutdownEnabled));
      setScheduledShutdownTime(updated.scheduledShutdownTime || '19:00');
      setScheduledStartEnabled(Boolean(updated.scheduledStartEnabled));
      setScheduledStartTime(updated.scheduledStartTime || '07:00');
      setScheduleTimezone(updated.scheduleTimezone || 'UTC');
      setScheduleDays(updated.scheduleDays || '1,2,3,4,5');

      setSuccessMsg('Optimization policy and automation schedule updated successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      setShowEnableModal(false);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to update optimization policy.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Submit Handler
  const handleSaveSubmit = (e) => {
    e.preventDefault();
    if (autoShutdown && !savedPolicy?.autoShutdown) {
      setShowEnableModal(true);
    } else {
      executeSave(autoShutdown);
    }
  };

  // Scoped Policy Creation
  const handleCreateScope = async (e) => {
    e.preventDefault();
    setCreatingScope(true);
    try {
      await optimizationPolicyService.createPolicyScope({
        scopeType: newScope.scopeType,
        scopeValue: newScope.scopeValue.trim(),
        idleCpuThreshold: Number(newScope.idleCpuThreshold),
        monitoringWindowMinutes: Number(newScope.monitoringWindowMinutes),
        autoShutdown: Boolean(newScope.autoShutdown)
      });
      setShowCreateScopeModal(false);
      setNewScope({
        scopeType: 'RESOURCE_GROUP',
        scopeValue: '',
        idleCpuThreshold: 5.0,
        monitoringWindowMinutes: 30,
        autoShutdown: false
      });
      setSuccessMsg('Scoped policy created successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
      fetchScopes();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create scoped policy.');
    } finally {
      setCreatingScope(false);
    }
  };

  // Scoped Policy Deletion
  const handleDeleteScope = async (id) => {
    if (!window.confirm('Are you sure you want to delete this policy scope?')) return;
    try {
      await optimizationPolicyService.deletePolicyScope(id);
      fetchScopes();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete policy scope.');
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
            Optimization Policies & Hierarchy
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Configure global thresholds, hierarchical scoped overrides, and automated deallocation schedules.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => { fetchPolicy(); fetchScopes(); }}
            disabled={loading || saving}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <RefreshCw size={16} className={loading || scopesLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setActiveTab('global')}
          style={{
            padding: '0.75rem 1rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'global' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'global' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <Sliders size={18} />
          Global Policy & Schedules
        </button>

        <button
          onClick={() => setActiveTab('scopes')}
          style={{
            padding: '0.75rem 1rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'scopes' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'scopes' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <Layers size={18} />
          Scoped Policies & Precedence ({scopes.length})
        </button>
      </div>

      {/* Global Alerts */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: 'var(--radius-md)', color: 'var(--status-danger)', marginBottom: '1.5rem' }}>
          <AlertCircle size={20} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '500' }}>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--status-success)', borderRadius: 'var(--radius-md)', color: 'var(--status-success)', marginBottom: '1.5rem' }}>
          <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.875rem', fontWeight: '500' }}>{successMsg}</span>
        </div>
      )}

      {/* TAB 1: GLOBAL POLICY */}
      {activeTab === 'global' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
          {/* Policy Configuration Card */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Sliders size={22} style={{ color: 'var(--accent-primary)' }} />
                <span className="card-title">Default Tenant Parameters</span>
              </div>
              {hasUnsavedChanges && (
                <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                  Unsaved Changes
                </span>
              )}
            </div>

            {loading ? (
              <div className="loading-center" style={{ padding: '3rem' }}>
                <div className="spinner"></div>
                <p style={{ fontSize: '0.875rem' }}>Loading policy parameters...</p>
              </div>
            ) : (
              <form onSubmit={handleSaveSubmit}>
                {/* SECTION 1: IDLE CPU DETECTION */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    1. Idle CPU Metric Detection
                  </h3>

                  {/* Idle CPU Threshold */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                      <Activity size={16} style={{ color: 'var(--accent-primary)' }} />
                      <span>Idle CPU Threshold (%)</span>
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      value={idleCpuThreshold}
                      onChange={(e) => setIdleCpuThreshold(e.target.value)}
                      step="0.5"
                      min="0"
                      max="100"
                      required
                      disabled={saving}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', display: 'block' }}>
                      A VM is classified as idle when its average CPU utilization strictly falls below this percentage (&lt; {idleCpuThreshold}%). (Allowed: 0 - 100%).
                    </span>
                  </div>

                  {/* Monitoring Window */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                      <Clock size={16} style={{ color: 'var(--accent-secondary)' }} />
                      <span>Monitoring Window (Minutes)</span>
                    </label>
                    <input
                      type="number"
                      className="form-control"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      value={monitoringWindowMinutes}
                      onChange={(e) => setMonitoringWindowMinutes(e.target.value)}
                      step="5"
                      min="5"
                      max="1440"
                      required
                      disabled={saving}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.375rem', display: 'block' }}>
                      Timespan over which average CPU utilization is evaluated via Azure Monitor metrics. (Allowed: 5 to 1440 minutes).
                    </span>
                  </div>

                  {/* Auto-Shutdown Toggle */}
                  <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <Power size={16} style={{ color: autoShutdown ? 'var(--status-success)' : 'var(--status-warning)' }} />
                        <span>Automatic Idle Deallocation</span>
                      </label>

                      <input
                        type="checkbox"
                        checked={autoShutdown}
                        onChange={(e) => setAutoShutdown(e.target.checked)}
                        disabled={saving}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {autoShutdown ? (
                        <span style={{ color: 'var(--status-warning)', fontWeight: '600' }}>
                          Enabled: Non-production VMs below {idleCpuThreshold}% CPU will be automatically deallocated.
                        </span>
                      ) : (
                        <span>Disabled (Safe Default): Idle VMs will be identified for reports but not deallocated.</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* SECTION 2: SCHEDULED AUTOMATION WINDOWS */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    2. Scheduled Automation Windows
                  </h3>

                  {/* Timezone Selector */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                      <Globe size={16} style={{ color: 'var(--accent-primary)' }} />
                      <span>Schedule Timezone</span>
                    </label>
                    <select
                      className="form-control"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      value={scheduleTimezone}
                      onChange={(e) => setScheduleTimezone(e.target.value)}
                      disabled={saving}
                    >
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Active Days Selector */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
                      <Calendar size={16} style={{ color: 'var(--accent-secondary)' }} />
                      <span>Operating Schedule Days</span>
                    </label>
                    <select
                      className="form-control"
                      style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      value={scheduleDays}
                      onChange={(e) => setScheduleDays(e.target.value)}
                      disabled={saving}
                    >
                      {DAYS_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Scheduled Auto-Shutdown */}
                  <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <Moon size={16} style={{ color: '#818cf8' }} />
                        <span>Scheduled Evening Auto-Shutdown</span>
                      </label>
                      <input
                        type="checkbox"
                        checked={scheduledShutdownEnabled}
                        onChange={(e) => setScheduledShutdownEnabled(e.target.checked)}
                        disabled={saving}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </div>
                    {scheduledShutdownEnabled && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Shutdown Trigger Time (24-hour)
                        </label>
                        <input
                          type="time"
                          className="form-control"
                          style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                          value={scheduledShutdownTime}
                          onChange={(e) => setScheduledShutdownTime(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    )}
                  </div>

                  {/* Scheduled Auto-Start */}
                  <div style={{ padding: '0.85rem 1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <Sun size={16} style={{ color: '#f59e0b' }} />
                        <span>Scheduled Morning Auto-Start</span>
                      </label>
                      <input
                        type="checkbox"
                        checked={scheduledStartEnabled}
                        onChange={(e) => setScheduledStartEnabled(e.target.checked)}
                        disabled={saving}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </div>
                    {scheduledStartEnabled && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                          Start Trigger Time (24-hour)
                        </label>
                        <input
                          type="time"
                          className="form-control"
                          style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                          value={scheduledStartTime}
                          onChange={(e) => setScheduledStartTime(e.target.value)}
                          disabled={saving}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {formError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--status-danger)', borderRadius: '6px', color: 'var(--status-danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                    <AlertCircle size={18} />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={fetchPolicy}
                    disabled={saving || !hasUnsavedChanges}
                  >
                    Discard Changes
                  </button>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={saving || !hasUnsavedChanges}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                    <span>{saving ? 'Saving Policy...' : 'Save Policy'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Informational Walkthrough Card */}
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Info size={22} style={{ color: 'var(--accent-primary)' }} />
                <span className="card-title">How Automation Works</span>
              </div>
              <span className="badge badge-info">Tenant Base Policy</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                  1
                </div>
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Continuous CPU Monitoring:</strong> CloudPulse queries Azure Monitor metrics for your virtual machines over the configured {monitoringWindowMinutes}-minute window.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                  2
                </div>
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Idle Evaluation:</strong> A VM is flagged as idle if average CPU utilization strictly remains below {idleCpuThreshold}%.
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                  3
                </div>
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Scheduled Windows:</strong> When enabled, CloudPulse automatically deallocates non-production VMs in the evening ({scheduledShutdownTime} {scheduleTimezone}) and powers them ON in the morning ({scheduledStartTime} {scheduleTimezone}).
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--status-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', flexShrink: 0 }}>
                  ✓
                </div>
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Mandatory Safeguards:</strong> Production VMs (names matching "prod", or tags <code>Environment=production</code> or <code>AutoShutdown=disabled</code>) and configured user exclusion tags are <em>never</em> deallocated, ensuring 100% workload safety.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SCOPED POLICIES */}
      {activeTab === 'scopes' && (
        <div>
          {/* Precedence Hierarchy Diagram Card */}
          <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <ShieldCheck size={22} style={{ color: 'var(--status-success)' }} />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Authoritative Policy Precedence Hierarchy
              </h3>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              CloudPulse evaluates policies in strict descending order. <strong>Mandatory Safety Protection ALWAYS wins</strong> and cannot be overridden by any user scope.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid var(--status-success)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-success)' }}>
                1. Mandatory Safety Protection (Inviolable)
              </div>
              <span style={{ color: 'var(--text-muted)' }}>&gt;</span>
              <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid var(--accent-primary)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                2. VM Tag / Name Pattern (Priority: 10)
              </div>
              <span style={{ color: 'var(--text-muted)' }}>&gt;</span>
              <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                3. Resource Group (Priority: 20)
              </div>
              <span style={{ color: 'var(--text-muted)' }}>&gt;</span>
              <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                4. Subscription Scope (Priority: 30)
              </div>
              <span style={{ color: 'var(--text-muted)' }}>&gt;</span>
              <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                5. Global Base Policy (Fallback)
              </div>
            </div>
          </div>

          {/* Scopes Table Card */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="card-title">Configured Scoped Policies</span>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Targeted threshold overrides tailored to individual resource groups, tags, or VM patterns
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setShowCreateScopeModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Plus size={16} />
                Add Policy Scope
              </button>
            </div>

            {scopesLoading ? (
              <div className="loading-center" style={{ padding: '3rem' }}>
                <div className="spinner"></div>
                <p style={{ fontSize: '0.875rem' }}>Loading policy scopes...</p>
              </div>
            ) : scopes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                <Layers size={36} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
                <div style={{ fontWeight: 600 }}>No scoped policies defined yet.</div>
                <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  All VMs currently inherit your tenant's Global Base Policy. Add a scoped policy to customize thresholds for dev/staging environments.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Scope Type</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Scope Value / Target</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Precedence Priority</th>
                      <th style={{ padding: '0.75rem 1rem' }}>CPU Threshold</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Auto-Shutdown</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopes.map((s) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span className="badge badge-primary" style={{ fontSize: '0.75rem' }}>
                            {s.scope_type}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          <code>{s.scope_value || '(Global / All)'}</code>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                            Tier {s.priority}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {s.idle_cpu_threshold}% (window: {s.monitoring_window_minutes}m)
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          {s.auto_shutdown ? (
                            <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>ENABLED</span>
                          ) : (
                            <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>DISABLED</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <button
                            className="btn btn-danger"
                            onClick={() => handleDeleteScope(s.id)}
                            title="Delete Scope"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Policy Scope Modal */}
      {showCreateScopeModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem'
        }}>
          <div className="card" style={{ maxWidth: '520px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={20} style={{ color: 'var(--accent-primary)' }} />
                Add Scoped Policy
              </h3>
              <button
                onClick={() => setShowCreateScopeModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateScope}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Scope Type
                </label>
                <select
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={newScope.scopeType}
                  onChange={(e) => setNewScope({ ...newScope, scopeType: e.target.value })}
                >
                  {SCOPE_TYPES.map((st) => (
                    <option key={st.value} value={st.value}>{st.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  {SCOPE_TYPES.find(st => st.value === newScope.scopeType)?.hint}
                </span>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Scope Value / Target Filter
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. rg-development or Environment=Staging"
                  className="form-control"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                  value={newScope.scopeValue}
                  onChange={(e) => setNewScope({ ...newScope, scopeValue: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Idle CPU Threshold (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    required
                    className="form-control"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    value={newScope.idleCpuThreshold}
                    onChange={(e) => setNewScope({ ...newScope, idleCpuThreshold: e.target.value })}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Window (Minutes)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="5"
                    max="1440"
                    required
                    className="form-control"
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    value={newScope.monitoringWindowMinutes}
                    onChange={(e) => setNewScope({ ...newScope, monitoringWindowMinutes: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', marginBottom: '1.25rem', border: '1px solid var(--border-color)' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                  <span>Automatic Deallocation for this Scope</span>
                  <input
                    type="checkbox"
                    checked={newScope.autoShutdown}
                    onChange={(e) => setNewScope({ ...newScope, autoShutdown: e.target.checked })}
                    style={{ width: '16px', height: '16px' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateScopeModal(false)}
                  disabled={creatingScope}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingScope}
                >
                  {creatingScope ? 'Creating...' : 'Create Scope'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Enabling Auto-Shutdown */}
      {showEnableModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ maxWidth: '520px', width: '100%', margin: 0, border: '1px solid var(--status-warning)' }}>
            <div className="card-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <AlertTriangle size={24} style={{ color: 'var(--status-warning)' }} />
                <span className="card-title" style={{ fontSize: '1.125rem' }}>Enable Live Automatic Deallocation?</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '0.25rem', border: 'none', background: 'transparent' }}
                onClick={() => setShowEnableModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1.25rem 0', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ marginBottom: '1rem' }}>
                Enabling automatic shutdown authorizes CloudPulse to execute <strong>live Azure deallocation commands</strong> against virtual machines meeting your idle criteria or schedule.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-success)', fontWeight: '600' }}>
                <ShieldCheck size={18} />
                <span>Production safeguards and exclusion tags remain permanently enforced.</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowEnableModal(false)}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => executeSave(true)}
                disabled={saving}
                style={{ backgroundColor: 'var(--status-warning)', borderColor: 'var(--status-warning)', color: '#000' }}
              >
                {saving ? 'Enabling...' : 'Confirm & Enable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OptimizationPolicy;
