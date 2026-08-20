import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Enables browser to automatically send HttpOnly cloudpulse_refresh_token cookie
  headers: {
    'Content-Type': 'application/json',
  },
});

// In-memory access token references & callbacks
let getAccessToken = () => null;
let onTokenRefreshed = () => {};
let onLogout = () => {};

export const setupApiInterceptors = ({ tokenGetter, tokenUpdater, logoutHandler }) => {
  getAccessToken = tokenGetter;
  onTokenRefreshed = tokenUpdater;
  onLogout = logoutHandler;
};

// Request Interceptor: Attach in-memory Access Token
api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: 401 Silent Token Refresh & Retry Queue
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Avoid infinite loop if refresh or login endpoints return 401
    const isAuthEndpoint = originalRequest.url?.includes('/api/auth/refresh') || 
                           originalRequest.url?.includes('/api/auth/login');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt silent refresh using HttpOnly cookie automatically sent by browser
        const refreshResponse = await axios.post(
          `${API_BASE_URL}/api/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const { accessToken } = refreshResponse.data;
        onTokenRefreshed(accessToken);
        isRefreshing = false;

        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        isRefreshing = false;
        onLogout();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
