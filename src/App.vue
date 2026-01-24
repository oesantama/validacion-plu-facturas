<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title>
          Validador PLU & Cédulas - Gemini AI
        </q-toolbar-title>
        <div class="q-gutter-sm row items-center">
          <q-badge color="orange" v-if="!apiKey" label="Sin API Key" />
          <q-badge color="green" v-else label="IA Online" />
          <div class="text-caption text-bold text-white bg-blue q-px-xs rounded-borders">v1.4.1 (KEYS FIXED)</div>
        </div>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="q-pa-md">
        <div class="row">
          <div class="col-12">
            <!-- SECCIÓN DE CONFIGURACIÓN ELIMINADA (SOLO CÓDIGO) -->

            <!-- Tabla con controles integrados -->
            <q-table
              title="Base de Datos Logística"
              :rows="results"
              :columns="columns"
              row-key="id"
              flat
              bordered
              :filter="{ search: filter, ...filterFields }"
              :filter-method="customFilter"
              no-data-label="No hay datos. Presione 'Analizar Carpeta' para comenzar."
              :loading="analyzing"
              v-model:pagination="pagination"
              :rows-per-page-options="[5, 10, 15, 50, 100, 0]"
              rows-per-page-label="Registros por página:"
              class="my-sticky-header-table"
            >
              <template v-slot:top>
                <div class="column full-width q-gutter-y-sm">
                  <div class="row items-center q-col-gutter-sm">
                    <div class="text-h6 text-primary q-pr-md">Base de Datos Logística</div>
                    <q-space />
                    <div class="q-gutter-sm">
                      <!-- Inputs Ocultos Reales para evitar que se "unan" -->
                      <input type="file" ref="folderInput" webkitdirectory directory multiple style="display: none" @change="handleFolderSelected" />
                      <input type="file" ref="filesInput" multiple accept="application/pdf" style="display: none" @change="handleFilesSelected" />

                      <q-btn color="primary" label="Carpeta" icon="folder_open" @click="$refs.folderInput.click()" :loading="analyzing" unelevated no-caps shadow-2 />
                      <q-btn color="secondary" label="Seleccionar" icon="add_files" @click="$refs.filesInput.click()" :loading="analyzing" unelevated no-caps shadow-2 />
                      
                      <q-btn color="warning" label="Ver Duplicados" icon="collections_bookmark" @click="checkDuplicates" :disable="analyzing || results.length === 0" unelevated no-caps />
                      <q-btn v-if="showingDuplicates" color="info" label="Ver Todo" icon="history" @click="resetHistory" outline no-caps />
                      <q-btn color="negative" label="Limpiar Historial" icon="delete_sweep" @click="confirmClear" :disable="analyzing || results.length === 0" outline no-caps />
                      <q-btn color="teal" icon="file_download" label="Exportar TODO a Excel (.xlsx)" @click="exportTable" :disable="results.length === 0" unelevated no-caps />
                    </div>
                  </div>

                  <div v-if="analyzing" class="q-mt-sm">
                    <q-linear-progress :value="progressValue / 100" color="primary" />
                    <div class="text-caption text-center">{{ progressInfo }} ({{ progressValue }}%)</div>
                  </div>

                  <q-separator q-my-sm />

                  <div class="row q-col-gutter-xs">
                    <div class="col-12 col-sm-2">
                      <q-input v-model="filterFields.placa" label="Placa" outlined dense clearable bg-color="white" />
                    </div>
                    <div class="col-12 col-sm-2">
                      <q-input v-model="filterFields.plu" label="PLU" outlined dense clearable bg-color="white" />
                    </div>
                    <div class="col-12 col-sm-2">
                      <q-input v-model="filterFields.pedido" label="Pedido" outlined dense clearable bg-color="white" />
                    </div>
                    <div class="col-12 col-sm-3">
                      <q-input v-model="filterFields.articulo" label="Artículo" outlined dense clearable bg-color="white" />
                    </div>
                    <div class="col-12 col-sm-3">
                      <q-input v-model="filterFields.cliente" label="Cliente" outlined dense clearable bg-color="white" />
                    </div>
                  </div>

                  <q-input borderless dense debounce="300" v-model="filter" placeholder="Búsqueda global..." class="bg-grey-2 q-px-md rounded-borders">
                    <template v-slot:append>
                      <q-icon name="search" />
                    </template>
                  </q-input>
                </div>
              </template>
              
              <template v-slot:body-cell-archivo="props">
                <q-td :props="props">
                   <div class="text-bold text-blue">{{ props.row.archivo }}</div>
                </q-td>
              </template>

              <template v-slot:body-cell-acciones="props">
                <q-td :props="props">
                  <q-btn flat dense round color="negative" icon="delete" @click="deleteRow(props.row)">
                    <q-tooltip>Eliminar este registro</q-tooltip>
                  </q-btn>
                </q-td>
              </template>
            </q-table>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { exportFile, useQuasar } from 'quasar'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import fileService from './services/file.service'
import geminiService from './services/gemini.service'
import driveService from './services/drive.service'
import storageService from './services/storage.service'

const $q = useQuasar()

// State
// Acepta múltiples claves separadas por coma: 'key1, key2, key3'
const apiKey = ref(import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyAVnmxmiUp3tqP8BlKxIzFDHYZRcB9iVAw,AIzaSyDgKYYlHs7sV8JWtwGAAITR7WUH3qtofQA,AIzaSyAVcDc76nbO0iG0FIpHy_yyD9CI3CHbu_E,AIzaSyBYX28LhyKBgWf6nEqdpbf_KYSdj-nklD0') 
const analyzing = ref(false)
const results = ref([])
const progressInfo = ref('')
const progressValue = ref(0)
const filter = ref('')
const filterFields = ref({
  placa: '',
  plu: '',
  pedido: '',
  articulo: '',
  cliente: ''
})
const showingDuplicates = ref(false)
const pagination = ref({
  sortBy: 'id',
  descending: true,
  page: 1,
  rowsPerPage: 10
})

// Refs para los inputs de archivos
const folderInput = ref(null)
const filesInput = ref(null)

onMounted(async () => {
  results.value = await storageService.getRecords()
})

const columns = [
  { name: 'archivo', label: 'PDF', field: 'archivo', align: 'left', sortable: true },
  { name: 'pedido', label: 'Pedido', field: 'pedido', align: 'left', sortable: true },
  { name: 'cedula', label: 'Cédula', field: 'cedula', align: 'left', sortable: true },
  { name: 'cliente', label: 'Nombre Cliente', field: 'cliente', align: 'left', sortable: true },
  { name: 'plu', label: 'PLU', field: 'plu', align: 'center', sortable: true },
  { name: 'articulo', label: 'Artículo', field: 'articulo', align: 'left', sortable: true },
  { name: 'direccion', label: 'Dirección', field: 'direccion', align: 'left', sortable: true },
  { name: 'fecha1', label: 'Fecha 1', field: 'fecha1', align: 'center', sortable: true },
  { name: 'fecha2', label: 'Fecha 2', field: 'fecha2', align: 'center', sortable: true },
  { name: 'ciudad_barrio', label: 'Ciudad-Barrio', field: 'ciudad_barrio', align: 'left', sortable: true },
  { name: 'placa', label: 'Placa', field: 'placa', align: 'center', sortable: true },
  { name: 'notas', label: 'Notas', field: 'notas', align: 'left', sortable: true },
  { name: 'acciones', label: 'Acciones', field: 'id', align: 'center', sortable: false }
]

// Methods
// Methods para el manejo de archivos separados
const handleFolderSelected = async (e) => {
  const files = Array.from(e.target.files)
    .filter(f => f.name.toLowerCase().endsWith('.pdf'))
    .map(f => ({
      file: f,
      path: f.webkitRelativePath,
      name: f.name
    }))
  if (files.length > 0) runAnalysis(files)
  e.target.value = '' // Reset para permitir volver a cargar lo mismo
}

const handleFilesSelected = async (e) => {
  const files = Array.from(e.target.files)
    .map(f => ({
      file: f,
      path: f.name,
      name: f.name
    }))
  if (files.length > 0) runAnalysis(files)
  e.target.value = '' // Reset
}

const runAnalysis = async (files) => {
  if (!apiKey.value) {
    $q.notify({ message: 'Debe ingresar su API Key', color: 'negative' })
    return
  }

    if (files.length === 0) return

    geminiService.init(apiKey.value)
    
    try {
      analyzing.value = true
      progressValue.value = 0

    const totalFiles = files.length
    let processedCount = 0
    const newRecordsBatch = []
    let currentDelay = 12000; // 12 segundos para ser 100% seguros contra 429

    const processFile = async (fileObj, index) => {
      try {
        progressInfo.value = `[${index + 1}/${totalFiles}] Preparando: ${fileObj.name}`
        let buffer = await fileService.getFileData(fileObj)

        progressInfo.value = `[${index + 1}/${totalFiles}] IA Analizando: ${fileObj.name}`
        const matches = await geminiService.analyzeDocument(buffer, "application/pdf")

        if (Array.isArray(matches) && matches.length > 0) {
            const batch = matches.map((analysis, mIdx) => ({
                id: `${Date.now()}-${index}-${mIdx}`,
                archivo: fileObj.name,
                pedido: analysis.pedido || 'N/A',
                cedula: analysis.cedula || 'N/A',
                cliente: analysis.cliente || 'N/A',
                plu: analysis.plu || 'N/A',
                articulo: analysis.articulo || 'N/A',
                direccion: analysis.direccion || 'N/A',
                fecha1: analysis.fecha1 || 'N/A',
                fecha2: analysis.fecha2 || 'N/A',
                ciudad_barrio: analysis.ciudad_barrio || 'N/A',
                placa: analysis.placa || 'N/A',
                notas: analysis.notas || ''
            }))
            
            newRecordsBatch.push(...batch)
            results.value = [...batch, ...results.value]
        }
      } catch (error) {
        console.error(`Error procesando ${fileObj.name}:`, error)
        // Si fallan todos los reintentos, aumentamos la demora base
        currentDelay += 5000;
        $q.notify({ 
          message: `Error en ${fileObj.name}. Aumentando espera a ${currentDelay/1000}s.`, 
          color: 'orange',
          position: 'bottom-right'
        })
      } finally {
        processedCount++
        progressValue.value = Math.round((processedCount / totalFiles) * 100)
        
        if (index < totalFiles - 1) {
          progressInfo.value = `Esperando cuota (próximo en ${currentDelay/1000}s)...`
          await new Promise(resolve => setTimeout(resolve, currentDelay))
        }
      }
    }

    for (let i = 0; i < files.length; i++) {
        // Si detectamos que la cuota diaria podría estar llena, avisamos
        if (processedCount > 1500) {
            $q.notify({ message: 'Límite diario de Gemini Free alcanzado (1500).', color: 'negative' })
            break;
        }
        await processFile(files[i], i);
    }

    if (newRecordsBatch.length > 0) {
      await storageService.appendRecords(newRecordsBatch)
    }

    $q.notify({
      message: `Proceso terminado. ${newRecordsBatch.length} registros nuevos.`,
      color: 'info'
    })
  } catch (error) {
    if (error.name !== 'AbortError') {
       $q.notify({ message: `Error general: ${error.message}`, color: 'negative' })
    }
  } finally {
    analyzing.value = false
    progressInfo.value = ''
  }
}

const customFilter = (rows, terms, cols, getCellValue) => {
  const { search, placa, plu, pedido, articulo, cliente } = terms
  
  return rows.filter(row => {
    // Filtros por campo (insensibles a mayúsculas)
    const matchPlaca = !placa || (row.placa || '').toLowerCase().includes(placa.toLowerCase())
    const matchPlu = !plu || (row.plu || '').toLowerCase().includes(plu.toLowerCase())
    const matchPedido = !pedido || (row.pedido || '').toLowerCase().includes(pedido.toLowerCase())
    const matchArticulo = !articulo || (row.articulo || '').toLowerCase().includes(articulo.toLowerCase())
    const matchCliente = !cliente || (row.cliente || '').toLowerCase().includes(cliente.toLowerCase())
    
    // Filtro global (términos de búsqueda general)
    const globalSearch = search ? search.toLowerCase() : ''
    const matchGlobal = !globalSearch || Object.values(row).some(v => 
      String(v).toLowerCase().includes(globalSearch)
    )

    return matchPlaca && matchPlu && matchPedido && matchArticulo && matchCliente && matchGlobal
  })
}

const checkDuplicates = async () => {
  const all = await storageService.getRecords()
  if (all.length === 0) return

  const groups = {}
  all.forEach(r => {
    // Clave: cédula + artículo + PLU
    const key = `${(r.cedula || '').trim()}|${(r.articulo || '').trim().toLowerCase()}|${(r.plu || '').trim().toLowerCase()}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  })

  const duplicates = []
  Object.values(groups).forEach(group => {
    if (group.length > 1) {
      // Se muestran si coinciden los campos y tienen fechas distintas (requerimiento original)
      const dates = new Set(group.map(r => r.fecha1))
      if (dates.size > 1) {
        duplicates.push(...group)
      }
    }
  })

  if (duplicates.length > 0) {
    results.value = duplicates
    showingDuplicates.value = true
    $q.notify({ 
      message: `Se encontraron ${duplicates.length} duplicados.`, 
      color: 'warning',
      icon: 'warning'
    })
  } else {
    $q.notify({ message: 'No se encontraron duplicados.', color: 'positive' })
  }
}

const deleteRow = (row) => {
  $q.dialog({
    title: 'Eliminar Registro',
    message: `¿Estás seguro de eliminar el registro de ${row.cliente}?`,
    cancel: true,
    persistent: true,
    ok: { color: 'negative', label: 'Eliminar', flat: true }
  }).onOk(async () => {
    await storageService.removeRecord(row.id)
    results.value = results.value.filter(r => r.id !== row.id)
    $q.notify({ message: 'Registro eliminado', color: 'info' })
  })
}

const resetHistory = async () => {
  results.value = await storageService.getRecords()
  showingDuplicates.value = false
}

const confirmClear = () => {
  $q.dialog({
    title: 'Confirmar Limpieza',
    message: '¿Estás seguro de que deseas borrar todo el historial? Esta acción no se puede deshacer.',
    cancel: true,
    persistent: true,
    ok: { color: 'negative', label: 'Borrar Todo', flat: true }
  }).onOk(async () => {
    await storageService.clear()
    results.value = []
    $q.notify({ message: 'Historial borrado', color: 'info' })
  })
}

const exportTable = () => {
  try {
    // 1. Filtrar los datos para excluir la columna de acciones y formatear encabezados
    const dataToExport = results.value.map(row => {
      const exportRow = {}
      columns.forEach(col => {
        // Solo exportamos columnas que no sean 'acciones'
        if (col.name !== 'acciones') {
          exportRow[col.label] = row[col.name]
        }
      })
      return exportRow
    })

    // 2. Crear el libro de trabajo (Workbook) y la hoja (Worksheet)
    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Logistica")

    // 3. Método definitivo de SheetJS para forzar la extensión .xlsx
    XLSX.writeFile(wb, "Reporte_Logistico_Milla7.xlsx");

    $q.notify({
      message: '¡ÉXITO! Archivo Reporte_Logistico_Milla7.xlsx generado.',
      color: 'black',
      icon: 'check_circle',
      position: 'top'
    })
  } catch (error) {
    console.error('Error exportando Excel:', error)
    $q.notify({ message: 'Error al generar el archivo Excel (v1.3.1)', color: 'negative' })
  }
}
</script>

<style lang="scss">
.q-page { background-color: #f4f4f7; }

.my-sticky-header-table {
  height: calc(100vh - 150px);

  .q-table__top,
  .q-table__bottom,
  thead tr:first-child th {
    background-color: #fff;
  }

  thead tr:first-child th {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
  }
}
</style>
