import api from './api';

export const budgetService = {
  async getBudgets() {
    const response = await api.get('/api/budgets');
    return response.data;
  },

  async createBudget(data) {
    const response = await api.post('/api/budgets', data);
    return response.data;
  },

  async getBudgetById(id) {
    const response = await api.get(`/api/budgets/${id}`);
    return response.data;
  },

  async updateBudget(id, data) {
    const response = await api.put(`/api/budgets/${id}`, data);
    return response.data;
  },

  async deleteBudget(id) {
    const response = await api.delete(`/api/budgets/${id}`);
    return response.data;
  }
};
