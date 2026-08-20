import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogIn, AlertCircle, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    setLoading(true);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      if (!err.response) {
        setError('Unable to connect to CloudPulse server. Please check your network connection.');
      } else if (err.response.status === 429) {
        setError('Too many authentication attempts. Please try again after 15 minutes.');
      } else if (err.response.status === 401) {
        setError('Invalid email or password.');
      } else {
        const errMsg = err.response.data?.error || err.response.data?.message || 'An unexpected authentication error occurred.';
        setError(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
          Sign In
        </h2>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} />
          <span>Back to Home</span>
        </Link>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Access your CloudPulse multi-tenant optimization dashboard
      </p>

      {error && (
        <div style={{
          backgroundColor: 'var(--status-error-bg)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          color: 'var(--status-error)',
          fontSize: '0.875rem'
        }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
            disabled={loading}
            autoComplete="email"
          />
        </div>

        <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>
            Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              autoComplete="current-password"
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.25rem'
              }}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem' }} disabled={loading}>
          {loading ? (
            <div className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }}></div>
          ) : (
            <>
              <LogIn size={18} />
              <span>Sign In</span>
            </>
          )}
        </button>
      </form>

      <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
        Don't have an account?{' '}
        <Link to="/register" style={{ fontWeight: '600' }}>
          Register Now
        </Link>
      </div>
    </div>
  );
};

export default Login;
