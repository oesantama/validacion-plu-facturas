class FileService {
  /**
   * Intenta usar la API moderna, si no, usa el fallback de input tradicional.
   */
  async getRecursiveFiles() {
    if ('showDirectoryPicker' in window) {
      return await this._modernPicker();
    } else {
      return await this._fallbackPicker();
    }
  }

  async _modernPicker() {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const files = [];

      async function scan(handle, path = "") {
        for await (const entry of handle.values()) {
          const currentPath = path ? `${path}/${entry.name}` : entry.name;
          if (entry.kind === "directory") {
            await scan(entry, currentPath);
          } else if (entry.name.toLowerCase().endsWith(".pdf")) {
            files.push({
              handle: entry,
              path: currentPath,
              name: entry.name
            });
          }
        }
      }
      await scan(dirHandle);
      return files;
    } catch (error) {
      if (error.name === 'AbortError') return [];
      throw error;
    }
  }

  _fallbackPicker() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      
      input.onchange = (e) => {
        const fileList = Array.from(e.target.files)
          .filter(f => f.name.toLowerCase().endsWith('.pdf'))
          .map(f => ({
            file: f, // El objeto File real
            path: f.webkitRelativePath,
            name: f.name
          }));
        resolve(fileList);
      };

      input.oncancel = () => resolve([]);
      input.click();
    });
  }

  async getSpecificFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'application/pdf';
      
      input.onchange = (e) => {
        const fileList = Array.from(e.target.files)
          .map(f => ({
            file: f,
            path: f.name,
            name: f.name
          }));
        resolve(fileList);
      };

      input.oncancel = () => resolve([]);
      input.click();
    });
  }

  async getFileData(fileObj) {
    if (fileObj.handle) {
      const file = await fileObj.handle.getFile();
      return await file.arrayBuffer();
    }
    return await fileObj.file.arrayBuffer();
  }
}

export default new FileService();
