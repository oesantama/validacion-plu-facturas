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
    const modelIds = [
      "gemini-2.0-flash-exp", 
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
      "gemini-1.5-flash-001"
    ];
    let currentModelIndex = 0;

    while (retries > 0) {
        try {
            // Re-inicializamos el modelo si cambió el índice
            const currentModelName = modelIds[currentModelIndex];
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
            
            // 1. Manejo de Modelo no encontrado (404) o No soportado -> Probar siguiente modelo
            if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("not supported")) {
                if (currentModelIndex < modelIds.length - 1) {
                    currentModelIndex++;
                    console.warn(`[Gemini] Modelo ${currentModelName} no disponible. Saltando a: ${modelIds[currentModelIndex]}`);
                    continue; 
                }
            }

            // 2. Manejo de Saturación (429) -> ROTAR KEY o ESPERAR
            if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
                // Si hay más claves, rotamos inmediatamente
                if (this._rotateKey()) {
                    console.warn("[Gemini] Clave rotada con éxito. Reintentando con nueva clave...");
                    // Al rotar clave, reiniciamos el modelo al primero por si la nueva clave sí tiene acceso
                    currentModelIndex = 0;
                    continue; 
                }

                // Si no hay más claves, intentamos extraer el tiempo de espera del error o usamos backoff
                let waitTime = 30000; // 30s por defecto
                const match = errorMsg.match(/retry in ([\d.]+)s/);
                if (match) {
                    waitTime = (parseFloat(match[1]) + 2) * 1000;
                } else {
                    waitTime = (11 - retries) * 10000; // Incremento progresivo
                }

                console.warn(`[Gemini] Cuota agotada en todas las claves. Esperando ${Math.round(waitTime/1000)}s antes de reintentar...`);
                await this._sleep(waitTime);
                retries--;
                // Reiniciamos modelos para probar suerte con la espera
                currentModelIndex = 0;
                continue;
            } 
            
            // Seguridad ante errores de red o temporales
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
