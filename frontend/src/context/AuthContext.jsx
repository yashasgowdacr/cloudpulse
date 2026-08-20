import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { setupApiInterceptors } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // Access token stored STRICTLY in React state memory (never in localStorage or sessionStorage)
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleLogoutState = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const handleTokenUpdate = useCallback((newToken) => {
    setAccessToken(newToken);
  }, []);

  // Setup Axios interceptors with in-memory token getters and setters
  useEffect(() => {
    setupApiInterceptors({
      tokenGetter: () => accessToken,
      tokenUpdater: handleTokenUpdate,
      logoutHandler: handleLogoutState,
    });
  }, [accessToken, handleTokenUpdate, handleLogoutState]);

  // Silent Refresh on App Mount / Page Reload
  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        // Browser automatically includes HttpOnly cloudpulse_refresh_token cookie
        const data = await authService.refreshToken();
        if (isMounted && data.accessToken) {
          setAccessToken(data.accessToken);
          setUser(data.user);
        }
      } catch (err) {
        if (isMounted) {
          handleLogoutState();
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, [handleLogoutState]);

  const login = async (email, password) => {
    const data = await authService.login(email, password);
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data;
  };

  const register = async (name, email, password) => {
    const data = await authService.register(name, email, password);
    return data;
  };

  const logout = async () => {
    try {
      await authService.logout();
    } finally {
      handleLogoutState();
    }
  };

  const value = {
    accessToken,
    user,
    isAuthenticated: Boolean(accessToken && user),
    loading,
    login,
    register,
    logout,
    setAccessToken
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
