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
    
    let retries = 5; 
    const modelIds = [
      "gemini-1.5-flash", 
      "gemini-1.5-flash-latest",
      "gemini-2.0-flash-exp", 
      "gemini-1.5-pro",
      "gemini-1.5-pro-latest"
    ];
    let currentModelIndex = 0;

    while (retries > 0) {
        try {
            const result = await this.model.generateContent([
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
            console.error(`[Gemini Error] Falló con ${modelIds[currentModelIndex]}:`, errorMsg);
            
            // 1. Manejo de Modelo no encontrado (404) o No soportado -> Cambiar Modelo
            if ((errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("not supported")) && currentModelIndex < modelIds.length - 1) {
                currentModelIndex++;
                console.warn(`[Gemini] Modelo ${modelIds[currentModelIndex-1]} falló. Probando alternativo: ${modelIds[currentModelIndex]}`);
                this.model = this.genAI.getGenerativeModel({ 
                  model: modelIds[currentModelIndex],
                  generationConfig: { responseMimeType: "application/json" }
                });
                continue; 
            }

            // 2. Manejo de Saturación (429) -> ROTAR KEY o ESPERAR
            if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
                // Intentamos rotar la clave primero
                if (this._rotateKey()) {
                    console.warn("[Gemini] Clave rotada con éxito. Reintentando con nueva clave...");
                    // Al rotar clave, reiniciamos el modelo al base por si fuera un tema de cuota por modelo
                    currentModelIndex = 0;
                    this.model = this.genAI.getGenerativeModel({ 
                      model: modelIds[currentModelIndex],
                      generationConfig: { responseMimeType: "application/json" }
                    });
                    continue; 
                }

                // Si no hay más claves (o es la única), activamos backoff
                const waitTime = (6 - retries) * 10000; 
                console.warn(`[Gemini] Cuota excedida en todas las claves. Reintentando en ${waitTime/1000}s...`);
                await this._sleep(waitTime);
                retries--;
                continue;
            } 
            
            // Si llegamos aquí y es un error de análisis JSON o similar, no reintentamos
            if (error instanceof SyntaxError) {
                console.error("Error de formato JSON en la respuesta de Gemini");
                throw error;
            }

            // Otros errores desconocidos: reintentamos si quedan retries
            retries--;
            if (retries > 0) {
                console.warn(`[Gemini] Reintentando tras error inesperado (${retries} intentos restantes)...`);
                await this._sleep(2000);
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
