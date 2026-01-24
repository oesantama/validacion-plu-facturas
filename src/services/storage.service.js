class StorageService {
  constructor() {
    this.key = 'validacion_plu_db';
  }

  getRecords() {
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Error al leer de localStorage:', e);
      return [];
    }
  }

  saveRecords(records) {
    try {
      localStorage.setItem(this.key, JSON.stringify(records));
      return true;
    } catch (e) {
      console.error('Error al guardar en localStorage:', e);
      return false;
    }
  }

  appendRecords(newRecords) {
    const current = this.getRecords();
    const updated = [...newRecords, ...current]; // Los más nuevos arriba
    return this.saveRecords(updated);
  }

  removeRecord(id) {
    const current = this.getRecords();
    const updated = current.filter(r => r.id !== id);
    this.saveRecords(updated);
  }

  clear() {
    localStorage.removeItem(this.key);
  }
}

export default new StorageService();
