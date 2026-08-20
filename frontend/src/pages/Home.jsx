import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, ShieldCheck, Zap, DollarSign, Cloud, ArrowRight } from 'lucide-react';

const Home = () => {
  return (
    <div style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      {/* Landing Nav */}
      <nav style={{
        height: '70px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff'
          }}>
            <Activity size={22} />
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: '800', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            CloudPulse
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/login" className="btn btn-secondary">Login</Link>
          <Link to="/register" className="btn btn-primary">Get Started</Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{ padding: '5rem 2rem 3rem', textAlign: 'center', maxWidth: '900px', margin: '0 auto' }}>
        <span className="badge badge-info" style={{ marginBottom: '1.5rem', fontSize: '0.8125rem' }}>
          Multi-Tenant Azure Cloud Management & Optimization
        </span>
        <h1 style={{ fontSize: '3.25rem', fontWeight: '800', lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: '1.5rem' }}>
          Intelligent Automated Azure VM Optimization & Cost Control
        </h1>
        <p style={{ fontSize: '1.125rem', color: 'var(--text-secondary)', marginBottom: '2.5rem', lineHeight: 1.6 }}>
          Centralize your Azure subscriptions, automate idle virtual machine deallocations, and drastically reduce cloud spend with user-scoped isolation and security controls.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/register" className="btn btn-primary" style={{ padding: '0.75rem 1.75rem', fontSize: '1rem' }}>
            <span>Start Free Optimization</span>
            <ArrowRight size={18} />
          </Link>
          <Link to="/login" className="btn btn-secondary" style={{ padding: '0.75rem 1.75rem', fontSize: '1rem' }}>
            <span>Sign In to Dashboard</span>
          </Link>
        </div>
      </section>

      {/* Feature Grid */}
      <section style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ color: 'var(--accent-primary)', marginBottom: '1rem' }}>
              <Cloud size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Multi-Tenant Connection Resolver</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Securely register Service Principal credentials with AES-256-GCM encryption. Isolated strictly by user ID.
            </p>
          </div>

          <div className="card">
            <div style={{ color: 'var(--accent-secondary)', marginBottom: '1rem' }}>
              <Zap size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Policy-Driven Automation</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Configure custom CPU thresholds, monitoring windows, and safety rules per tenant without manual intervention.
            </p>
          </div>

          <div className="card">
            <div style={{ color: 'var(--status-success)', marginBottom: '1rem' }}>
              <DollarSign size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Real-Time Savings Calculation</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Query Azure Monitor and Cost Management APIs to calculate potential and realized cost savings accurately.
            </p>
          </div>

          <div className="card">
            <div style={{ color: 'var(--status-warning)', marginBottom: '1rem' }}>
              <ShieldCheck size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Enterprise Audit & Security</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Complete audit log tracking for every optimization decision, combined with HttpOnly cookie auth and rate limiting.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
