import api from './api';

function triggerDownload(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export const exportService = {
  exportVms: async (connectionId, format = 'csv') => {
    const isExcel = format === 'xlsx';
    const response = await api.get('/api/export/vms', {
      params: { connectionId, format },
      responseType: isExcel ? 'blob' : 'text'
    });
    const filename = `cloudpulse-vms-${new Date().toISOString().slice(0, 10)}.${isExcel ? 'xlsx' : 'csv'}`;
    const mime = isExcel
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
    triggerDownload(response.data, filename, mime);
  },

  exportActions: async (format = 'csv') => {
    const isExcel = format === 'xlsx';
    const response = await api.get('/api/export/actions', {
      params: { format },
      responseType: isExcel ? 'blob' : 'text'
    });
    const filename = `cloudpulse-actions-${new Date().toISOString().slice(0, 10)}.${isExcel ? 'xlsx' : 'csv'}`;
    const mime = isExcel
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
    triggerDownload(response.data, filename, mime);
  },

  exportCosts: async (connectionId, format = 'csv') => {
    const isExcel = format === 'xlsx';
    const response = await api.get('/api/export/costs', {
      params: { connectionId, format },
      responseType: isExcel ? 'blob' : 'text'
    });
    const filename = `cloudpulse-costs-${new Date().toISOString().slice(0, 10)}.${isExcel ? 'xlsx' : 'csv'}`;
    const mime = isExcel
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';
    triggerDownload(response.data, filename, mime);
  }
};
