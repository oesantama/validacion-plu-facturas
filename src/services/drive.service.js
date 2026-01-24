import axios from 'axios';

class DriveService {
  /**
   * Extrae el Folder ID de una URL de Google Drive.
   */
  extractFolderId(url) {
    const match = url.match(/folders\/([\w-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Lista archivos PDF en una carpeta pública de Drive usando una API Key.
   */
  async listFiles(folderId, apiKey) {
    if (!folderId) throw new Error("ID de carpeta inválido.");
    
    // Query: archivos que estén en la carpeta y sean PDFs (no eliminados)
    const q = `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&key=${apiKey}&fields=files(id,name,mimeType)`;

    try {
      const response = await axios.get(url);
      return response.data.files || [];
    } catch (error) {
      if (error.response?.status === 403) {
        throw new Error("Acceso denegado. Asegúrese de que la carpeta esté compartida como 'Cualquier persona con el enlace'.");
      }
      throw new Error("Error al conectar con Google Drive: " + error.message);
    }
  }

  /**
   * Obtiene el contenido de un archivo de Drive como ArrayBuffer.
   */
  async getFileBuffer(fileId, apiKey) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return response.data;
    } catch (error) {
      throw new Error(`Error descargando archivo ${fileId}: ${error.message}`);
    }
  }
}

export default new DriveService();
