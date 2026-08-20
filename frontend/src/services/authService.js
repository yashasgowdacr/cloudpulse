import api from './api';

export const authService = {
  async login(email, password) {
    const response = await api.post('/api/auth/login', { email, password });
    return response.data;
  },

  async register(name, email, password) {
    const response = await api.post('/api/auth/register', { name, email, password });
    return response.data;
  },

  async logout() {
    try {
      const response = await api.post('/api/auth/logout');
      return response.data;
    } catch (err) {
      // Return safe output even if logout call fails
      return { message: 'Logged out' };
    }
  },

  async refreshToken() {
    const response = await api.post('/api/auth/refresh');
    return response.data;
  },

  async getProfile() {
    const response = await api.get('/api/auth/me');
    return response.data;
  }
};
