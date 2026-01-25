import { GoogleGenerativeAI } from "@google/generative-ai";

class GeminiService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.apiKeys = [];
    this.currentKeyIndex = 0;
  }

  init(apiKeysInput) {
    // Acepta una sola clave o varias separadas por comas
    if (!apiKeysInput) throw new Error("API Key no proporcionada");
    
    this.apiKeys = apiKeysInput.split(',').map(k => k.trim()).filter(k => k);
    this.currentKeyIndex = 0;
    
    if (this.apiKeys.length === 0) throw new Error("No hay claves válidas");

    this._initClient();
  }

  _initClient() {
    const key = this.apiKeys[this.currentKeyIndex];
    console.log(`[Gemini] Usando API Key índice ${this.currentKeyIndex + 1}/${this.apiKeys.length} (${key.slice(0, 5)}...)`);
    
    this.genAI = new GoogleGenerativeAI(key);
    // Probamos con gemini-1.5-flash como base
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });
  }

  _rotateKey() {
    if (this.apiKeys.length <= 1) return false;

    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.warn(`[Gemini] Rotando a API Key #${this.currentKeyIndex + 1} debido a saturación...`);
    this._initClient();
    return true;
  }

  async analyzeDocument(fileBuffer, mimeType) {
    if (!this.model) throw new Error("IA no inicializada.");

    const prompt = `
      EXTRACCIÓN TOTAL DE DATOS LOGÍSTICOS: 
      Analiza este documento y extrae TODOS los registros de entregas o facturas.
      Formato de respuesta obligatorio: Un objeto JSON con una lista llamada "matches".
      
      Cada objeto en "matches" debe tener estos campos exactos (usa "N/A" si falta el dato):
      {
        "pedido": "Número de pedido o factura",
        "cedula": "Cédula o NIT del cliente",
        "cliente": "Nombre Completo del Cliente",
        "plu": "Código PLU del producto",
        "articulo": "Descripción del artículo",
        "direccion": "Dirección de entrega",
        "fecha1": "Fecha de facturación",
        "fecha2": "Fecha de entrega",
        "ciudad_barrio": "Ciudad y Barrio",
        "placa": "Placa del vehículo",
        "notas": "Observaciones"
      }
    `;

    const base64Data = await this._arrayBufferToBase64(fileBuffer);
    
    let retries = 15; 
    // Priorizamos gemini-2.0-flash-exp que es el que parece estar disponible (aunque saturado)
    // Eliminamos las variantes que daban 404 seguro para no perder tiempo
    let modelIds = [
      "gemini-2.0-flash-exp",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro"
    ];
    let currentModelIndex = 0;

    // Guardamos la lista original para poder restaurarla si todos fallan por 429
    const originalModelIds = [...modelIds];
    
    while (retries > 0) {
        try {
            const currentModelName = modelIds[currentModelIndex];
            
            // Si nos quedamos sin modelos, verificamos si fue por 429 (saturación) o 404 (no existen)
            if (!currentModelName) {
                 console.warn("[Gemini] No hay más modelos para probar en este ciclo.");
                 
                 // Si la lista original tenía modelos pero ahora está vacía, fueron eliminados por 404
                 if (originalModelIds.length > 0 && modelIds.length === 0) {
                     throw new Error("Todos los modelos retornaron 404 (no existen). Verifica los nombres de modelo.");
                 }
                 
                 // Si aún hay modelos en la lista original, significa que fueron 429 (saturación)
                 // Intentamos rotar clave y restaurar la lista
                 if (this._rotateKey()) {
                    console.warn("[Gemini] Restaurando lista de modelos y reintentando con nueva clave...");
                    modelIds = [...originalModelIds]; // Restaurar lista completa
                    currentModelIndex = 0;
                    continue;
                 }
                 
                 // Si no hay más claves, esperamos y restauramos
                 console.warn("[Gemini] Todas las claves saturadas. Esperando 30s antes de reintentar...");
                 await this._sleep(30000);
                 modelIds = [...originalModelIds]; // Restaurar lista
                 currentModelIndex = 0;
                 retries--;
                 continue;
            }

            const activeModel = this.genAI.getGenerativeModel({ 
              model: currentModelName,
              generationConfig: { responseMimeType: "application/json" }
            });

            const result = await activeModel.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType
                    }
                }
            ]);

            const response = await result.response;
            const text = response.text();
            
            if (!text) throw new Error("Respuesta vacía de Gemini");

            const parsed = JSON.parse(text);
            return parsed.matches || [];
        } catch (error) {
            const errorMsg = error.toString().toLowerCase();
            const currentModelName = modelIds[currentModelIndex];
            
            console.error(`[Gemini Error] Falló con ${currentModelName}:`, errorMsg);
            
            // 1. Manejo de Modelo no encontrado (404) o No soportado
            if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("not supported")) {
                console.warn(`[Gemini] Modelo ${currentModelName} no disponible (404). Eliminándolo de la lista de intentos.`);
                // Lo sacamos de la lista para no volver a intentarlo ni siquiera con otra key
                modelIds.splice(currentModelIndex, 1);
                // No incrementamos currentModelIndex, porque al borrar, el siguiente elemento toma esta posición
                continue; 
            }

            // 2. Manejo de Saturación (429) -> ROTAR KEY o ESPERAR
            if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
                // Marcamos este modelo como saturado temporalmente removiéndolo
                console.warn(`[Gemini] Modelo ${currentModelName} saturado (429). Probando siguiente modelo...`);
                modelIds.splice(currentModelIndex, 1);
                
                // Si aún quedan modelos en la lista, probamos el siguiente
                if (modelIds.length > 0) {
                    // currentModelIndex ya apunta al siguiente por el splice
                    if (currentModelIndex >= modelIds.length) {
                        currentModelIndex = 0;
                    }
                    continue;
                }
                
                // Si no quedan modelos, intentamos rotar clave
                if (this._rotateKey()) {
                    console.warn("[Gemini] Clave rotada. Restaurando modelos...");
                    modelIds = [...originalModelIds];
                    currentModelIndex = 0;
                    continue; 
                }

                // Si no hay más claves, esperamos
                let waitTime = 30000; 
                const match = errorMsg.match(/retry in ([\d.]+)s/);
                if (match) {
                    waitTime = (parseFloat(match[1]) + 2) * 1000;
                }

                console.warn(`[Gemini] Todas las claves saturadas. Esperando ${Math.round(waitTime/1000)}s...`);
                await this._sleep(waitTime);
                modelIds = [...originalModelIds]; // Restaurar lista
                currentModelIndex = 0;
                retries--;
                continue;
            } 
            
            // Error genérico
            retries--;
            if (retries > 0) {
                console.warn(`[Gemini] Error inesperado. Reintentando (${retries} intentos restantes)...`);
                await this._sleep(5000);
                continue;
            }

            throw error;
        }
    }
    throw new Error("Se agotaron los intentos, modelos y claves disponibles.");
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _arrayBufferToBase64(buffer) {
    const blob = new Blob([buffer]);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  }
}

export default new GeminiService();
