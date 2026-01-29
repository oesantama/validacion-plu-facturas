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
    if (!this.model) {
      if (this.apiKeys.length > 0) this._initClient();
      else throw new Error("Servicio de IA no inicializado y sin claves.");
    }

    // Prompt optimizado para consumir menos tokens y ser más directo
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

    let retries = 10;
    // Priorizamos modelos estables y rápidos. El orden importa.
    let modelIds = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-2.0-flash-exp",
    ];

    // Copia para restaurar tras rotar key
    const originalModelIds = [...modelIds];
    let currentModelIndex = 0;

    while (retries > 0) {
      // Validación crítica: Si la lista de modelos se vació, intentar rotar key
      if (modelIds.length === 0) {
        console.warn(
          "[Gemini] Se agotaron los modelos válidos con la clave actual.",
        );
        if (this._rotateKey()) {
          console.log("[Gemini] Rotación exitosa. Restaurando modelos...");
          modelIds = [...originalModelIds];
          currentModelIndex = 0;
          continue;
        } else {
          // Si no hay más keys y no hay modelos, error fatal
          throw new Error(
            "Fallo crítico: No hay modelos disponibles ni claves extra para probar.",
          );
        }
      }

      // Asegurar índice seguro
      if (currentModelIndex >= modelIds.length) currentModelIndex = 0;

      const currentModelName = modelIds[currentModelIndex];

      try {
        const activeModel = this.genAI.getGenerativeModel({
          model: currentModelName,
          generationConfig: { responseMimeType: "application/json" },
        });

        // Timeout de seguridad en la petición
        const resultWithTimeout = await Promise.race([
          activeModel.generateContent([
            prompt,
            { inlineData: { data: base64Data, mimeType: mimeType } },
          ]),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout de solicitud")), 25000),
          ),
        ]);

        const response = await resultWithTimeout.response;
        const text = response.text();

        if (!text) throw new Error("Respuesta vacía de Gemini");

        const parsed = JSON.parse(text);
        return parsed.matches || [];
      } catch (error) {
        const errorMsg = error.toString().toLowerCase();
        const isFatal = errorMsg.includes("fallo crítico");
        if (isFatal) throw error; // No atrapar nuestro propio error fatal

        console.error(`[Gemini Error] ${currentModelName}:`, errorMsg);

        // 1. Manejo de 404 (Not Found) o No Soportado --> ELIMINAR MODELO de esta Key
        if (
          errorMsg.includes("404") ||
          errorMsg.includes("not found") ||
          errorMsg.includes("not supported")
        ) {
          console.warn(
            `[Gemini] Eliminando modelo inválido: ${currentModelName}`,
          );
          modelIds.splice(currentModelIndex, 1);
          // Al eliminar, el índice apunta al nuevo elemento, no incrementamos
          continue;
        }

        // 2. Manejo de Saturación (429) --> ROTAR KEY o ESPERAR
        if (
          errorMsg.includes("429") ||
          errorMsg.includes("quota") ||
          errorMsg.includes("limit")
        ) {
          console.warn(`[Gemini] Saturación (429) en ${currentModelName}.`);

          // Opción A: Rotar clave inmediatamente si hay disponible
          if (this._rotateKey()) {
            modelIds = [...originalModelIds]; // Restauramos todo con nueva key
            currentModelIndex = 0;
            continue;
          }

          // Opción B: Esperar (Backoff)
          console.warn("[Gemini] Esperando 10s por cuota...");
          await this._sleep(10000);
          // Intentamos con el mismo modelo u otro? Mejor probamos el siguiente si hay
          currentModelIndex++;
          retries--;
          continue;
        }

        // Otros errores
        console.warn(`[Gemini] Error genérico. Reintentando...`);
        retries--;
        await this._sleep(2000);
        currentModelIndex++;
      }
    }
    throw new Error(
      "No se pudo procesar el documento tras múltiples intentos.",
    );
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
