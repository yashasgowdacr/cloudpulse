import api from './api';

export const anomalyService = {
  async getAnomalies(filters = {}) {
    const response = await api.get('/api/anomalies', { params: filters });
    return response.data;
  },

  async acknowledgeAnomaly(id) {
    const response = await api.post(`/api/anomalies/${id}/acknowledge`);
    return response.data;
  }
};
