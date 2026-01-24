import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

class StorageService {
  async getRecords() {
    try {
      const response = await axios.get(`${API_URL}/records`);
      return response.data;
    } catch (e) {
      console.error('Error al leer del backend:', e);
      return [];
    }
  }

  async saveRecords(records) {
    try {
      const response = await axios.post(`${API_URL}/records`, records);
      return response.data;
    } catch (e) {
      console.error('Error al guardar en el backend:', e);
      return false;
    }
  }

  async appendRecords(newRecords) {
    // El backend maneja el append via el POST que recibe un array
    return this.saveRecords(newRecords);
  }

  async removeRecord(id) {
    try {
      await axios.delete(`${API_URL}/records/${id}`);
      return true;
    } catch (e) {
      console.error('Error al eliminar en el backend:', e);
      return false;
    }
  }

  async clear() {
    try {
      await axios.delete(`${API_URL}/records`);
      return true;
    } catch (e) {
      console.error('Error al limpiar el backend:', e);
      return false;
    }
  }
}

export default new StorageService();
