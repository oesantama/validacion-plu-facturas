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

    this.apiKeys = apiKeysInput
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);
    this.currentKeyIndex = 0;

    if (this.apiKeys.length === 0) throw new Error("No hay claves válidas");

    this._initClient();
  }

  _initClient() {
    const key = this.apiKeys[this.currentKeyIndex];
    console.log(
      `[Gemini] Usando API Key índice ${this.currentKeyIndex + 1}/${this.apiKeys.length} (${key.slice(0, 5)}...)`,
    );

    this.genAI = new GoogleGenerativeAI(key);
    // Probamos con gemini-1.5-flash como base
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });
  }

  _rotateKey() {
    if (this.apiKeys.length <= 1) return false;

    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.warn(
      `[Gemini] Rotando a API Key #${this.currentKeyIndex + 1} debido a saturación...`,
    );
    this._initClient();
    return true;
  }

  async analyzeDocument(fileBuffer, mimeType) {
    if (!this.genAI) this._initClient();
    
    const prompt = `
      Analiza este DOCUMENTO LOGÍSTICO y extrae TODOS los registros de entregas o facturas en un JSON.
      Formato: { "matches": [ {objeto} ] }
      Campos exactos (usa "N/A" si falta):
      - pedido (Número/Factura)
      - cedula (ID cliente)
      - cliente (Nombre)
      - plu (Código producto)
      - articulo (Descripción)
      - direccion (Entrega)
      - fecha1 (Facturación)
      - fecha2 (Entrega)
      - ciudad_barrio
      - placa (Vehículo)
      - notas
    `;

    const base64Data = await this._arrayBufferToBase64(fileBuffer);
    
    // Configuraciones EXACTAS de ChepitApp (Working Code)
    const configurations = [
        { model: "gemini-1.5-flash", version: "v1" },
        { model: "gemini-flash-latest", version: "v1beta" },
        { model: "gemini-pro-latest", version: "v1beta" },
        { model: "gemini-2.0-flash", version: "v1beta" },
        { model: "gemini-2.5-flash", version: "v1beta" },
        { model: "models/gemini-1.5-flash", version: "v1beta" }
    ];

    let retries = 10;
    
    while (retries > 0) {
        // Asegurar que tenemos una llave al inicio del ciclo
        if (this.apiKeys.length === 0) throw new Error("No hay API Keys disponibles.");

        const currentKey = this.apiKeys[this.currentKeyIndex];
        let configSuccess = false;

        // Probamos CADA configuración con la llave actual
        for (const config of configurations) {
            try {
                const genAI = new GoogleGenerativeAI(currentKey);
                
                // IMPORTANTE: La API v1 lanza error 400 si se envía responseMimeType
                // Solo lo enviamos si es v1beta (aunque v1beta está dando 404, por si acaso)
                const modelParams = { model: config.model };
                
                if (config.version === 'v1beta') {
                    modelParams.generationConfig = { responseMimeType: "application/json" };
                }

                const activeModel = genAI.getGenerativeModel(modelParams, { 
                    apiVersion: config.version 
                });

                // Timeout de seguridad en la petición
                const resultWithTimeout = await Promise.race([
                    activeModel.generateContent([
                        prompt,
                        { inlineData: { data: base64Data, mimeType: mimeType } }
                    ]),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout de solicitud")), 25000))
                ]);

                const response = await resultWithTimeout.response;
                const text = response.text();
                
                if (!text) throw new Error("Respuesta vacía de Gemini");

                const parsed = JSON.parse(text);
                return parsed.matches || [];
                
                // Si llegamos aquí, ¡Éxito!
                configSuccess = true;
                break; 

            } catch (error) {
                const errorMsg = error.toString().toLowerCase();
                
                console.warn(`[Gemini] Falló config ${config.model} (${config.version}): ${errorMsg}`);

                // 1. Manejo de Saturación (429) -> ROMPER BUCLE DE CONFIGS Y ROTAR KEY
                if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
                    console.warn(`[Gemini] Quota excedida en llave ${this.currentKeyIndex}. Rotando...`);
                    // Salimos del for de configs para rotar llave
                    break; 
                }

                // 2. 404 Not Found -> Simplemente probamos la siguiente CONFIGURACIÓN del array
                if (errorMsg.includes("404") || errorMsg.includes("not found")) {
                    continue; // Probar siguiente config
                }
                
                // Otros errores -> Probar siguiente config por si acaso
                continue;
            }
        }

        // Si alguna config funcionó, ya retornamos arriba. Si llegamos aquí, fallaron todas con esta Key.
        
        // Rotamos llave
        if (this._rotateKey()) {
            await this._sleep(1000); // Pequeña pausa
            continue; // Reintentar while (retries) con nueva llave y todas las configs
        } else {
            // Si no hay más llaves y falló todo (incluyendo 429s), esperamos
            console.warn("[Gemini] Todas las llaves fallaron o saturadas. Esperando 10s...");
            await this._sleep(10000);
            retries--;
        }
    }

    throw new Error("Se agotaron los intentos. Verifique su API Key o conexión.");
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
