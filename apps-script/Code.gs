// ─────────────────────────────────────────────────
//  CONFIGURACIÓN  — cambia solo este ID
// ─────────────────────────────────────────────────
const SPREADSHEET_ID = ''; // ← pega aquí el ID de tu Google Sheets
const DRIVE_ROOT     = 'Panel de jefes'; // carpeta raíz en Drive

// ─────────────────────────────────────────────────
//  ROUTERS
// ─────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  let result;
  try {
    if      (action === 'sup_getAll')      result = sup_getAll();
    else if (action === 'sup_getEvidence') result = sup_getEvidence();
    else if (action === 'ev_getAll')       result = ev_getAll();
    else if (action === 'ev_getPhotos')    result = ev_getPhotos();
    else result = { error: 'Acción GET desconocida: ' + action };
  } catch(err) {
    result = { error: err.toString() };
  }
  return jsonResponse(result);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch(err) { return jsonResponse({ error: 'JSON inválido: ' + err }); }

  const action = body.action || '';
  let result;
  try {
    if      (action === 'sup_saveStatus')  result = sup_saveStatus(body);
    else if (action === 'sup_saveObs')     result = sup_saveObs(body);
    else if (action === 'sup_driveUpload') result = sup_driveUpload(body);
    else if (action === 'sup_driveDelete') result = sup_driveDelete(body);
    else if (action === 'ev_save')         result = ev_save(body);
    else if (action === 'ev_delete')       result = ev_delete(body);
    else if (action === 'ev_driveUpload')  result = ev_driveUpload(body);
    else if (action === 'ev_driveDelete')  result = ev_driveDelete(body);
    else result = { error: 'Acción POST desconocida: ' + action };
  } catch(err) {
    result = { error: err.toString() };
  }
  return jsonResponse(result);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────
//  sup_getAll  — lee estatus y observaciones
// ─────────────────────────────────────────────────
function sup_getAll() {
  const sheet = getSheet('supervision_status');
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({
      programa:      data[i][0],
      actividad_idx: data[i][1],
      estatus:       data[i][2],
      observaciones: data[i][3] || ''
    });
  }
  return { rows };
}

// ─────────────────────────────────────────────────
//  sup_saveStatus
// ─────────────────────────────────────────────────
function sup_saveStatus(p) {
  const sheet = getSheet('supervision_status');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.programa && String(data[i][1]) === String(p.actividad_idx)) {
      sheet.getRange(i + 1, 3).setValue(p.estatus);
      return { ok: true };
    }
  }
  sheet.appendRow([p.programa, p.actividad_idx, p.estatus, '']);
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  sup_saveObs
// ─────────────────────────────────────────────────
function sup_saveObs(p) {
  const sheet = getSheet('supervision_status');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.programa && data[i][1] === 'obs') {
      sheet.getRange(i + 1, 4).setValue(p.observaciones);
      return { ok: true };
    }
  }
  sheet.appendRow([p.programa, 'obs', '', p.observaciones]);
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  sup_getEvidence  — lee metadatos de fotos
// ─────────────────────────────────────────────────
function sup_getEvidence() {
  const sheet = getSheet('supervision_evidence');
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({
      programa:      data[i][0],
      actividad_idx: data[i][1],
      slot:          data[i][2],
      fileId:        data[i][3],
      fileUrl:       data[i][4],
      fileName:      data[i][5],
      uploadedAt:    data[i][6]
    });
  }
  return { rows };
}

// ─────────────────────────────────────────────────
//  sup_driveUpload  — sube foto a Drive y guarda metadata
// ─────────────────────────────────────────────────
function sup_driveUpload(p) {
  // 1. Decodificar base64 (el frontend manda "data:image/jpeg;base64,XXXX")
  const base64 = p.fileData.split(',')[1];
  const blob   = Utilities.newBlob(
    Utilities.base64Decode(base64),
    p.mimeType,
    p.fileName
  );

  // 2. Crear/reutilizar carpetas: Panel de jefes/supervision/[progName]/[actLabel]
  const rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), DRIVE_ROOT);
  const supFolder  = getOrCreateFolder(rootFolder, 'supervision');
  const progFolder = getOrCreateFolder(supFolder,  p.progName);
  const actFolder  = getOrCreateFolder(progFolder, p.actLabel);

  // 3. Si ya existe un archivo en ese slot, eliminarlo
  const evSheet = getSheet('supervision_evidence');
  const eData   = evSheet.getDataRange().getValues();
  for (let i = 1; i < eData.length; i++) {
    if (
      eData[i][0] === p.programa &&
      String(eData[i][1]) === String(p.actividad_idx) &&
      String(eData[i][2]) === String(p.slot)
    ) {
      try { DriveApp.getFileById(eData[i][3]).setTrashed(true); } catch(e) {}
      evSheet.deleteRow(i + 1);
      break;
    }
  }

  // 4. Subir archivo
  const file = actFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId  = file.getId();
  const fileUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
  const now     = Utilities.formatDate(new Date(), 'America/Mexico_City', 'dd/MMM/yyyy');

  // 5. Guardar metadata en Sheets
  evSheet.appendRow([
    p.programa,
    p.actividad_idx,
    p.slot,
    fileId,
    fileUrl,
    p.fileName,
    now
  ]);

  return { ok: true, fileId, fileUrl };
}

// ─────────────────────────────────────────────────
//  sup_driveDelete  — borra foto de Drive y Sheets
// ─────────────────────────────────────────────────
function sup_driveDelete(p) {
  const evSheet = getSheet('supervision_evidence');
  const eData   = evSheet.getDataRange().getValues();
  for (let i = 1; i < eData.length; i++) {
    if (
      eData[i][0] === p.programa &&
      String(eData[i][1]) === String(p.actividad_idx) &&
      String(eData[i][2]) === String(p.slot)
    ) {
      try { DriveApp.getFileById(eData[i][3]).setTrashed(true); } catch(e) {}
      evSheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  ev_getAll  — lee todos los eventos
// ─────────────────────────────────────────────────
function ev_getAll() {
  const sheet = getSheet('eventos');
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({
      id:          data[i][0],
      tipo:        data[i][1],
      nombre:      data[i][2],
      fecha:       data[i][3],
      presentes:   data[i][4],
      actividades: data[i][5],
      autoridades: data[i][6],
      notas:       data[i][7],
      createdAt:   data[i][8]
    });
  }
  return { rows };
}

// ─────────────────────────────────────────────────
//  ev_getPhotos  — lee metadatos de fotos de eventos
// ─────────────────────────────────────────────────
function ev_getPhotos() {
  const sheet = getSheet('eventos_evidence');
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({
      evento_id:  data[i][0],
      slot:       data[i][1],
      fileId:     data[i][2],
      fileUrl:    data[i][3],
      fileName:   data[i][4],
      uploadedAt: data[i][5]
    });
  }
  return { rows };
}

// ─────────────────────────────────────────────────
//  ev_save  — crea o actualiza un evento
// ─────────────────────────────────────────────────
function ev_save(p) {
  const ev    = p.evento;
  const sheet = getSheet('eventos');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === ev.id) {
      sheet.getRange(i + 1, 1, 1, 9).setValues([[
        ev.id, ev.tipo, ev.nombre, ev.fecha,
        ev.presentes, ev.actividades, ev.autoridades, ev.notas,
        data[i][8]
      ]]);
      return { ok: true };
    }
  }
  const now = Utilities.formatDate(new Date(), 'America/Mexico_City', 'dd/MMM/yyyy HH:mm');
  sheet.appendRow([ev.id, ev.tipo, ev.nombre, ev.fecha, ev.presentes, ev.actividades, ev.autoridades, ev.notas, now]);
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  ev_delete  — elimina evento y sus fotos
// ─────────────────────────────────────────────────
function ev_delete(p) {
  const sheet = getSheet('eventos');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) { sheet.deleteRow(i + 1); break; }
  }
  const evSheet = getSheet('eventos_evidence');
  const eData   = evSheet.getDataRange().getValues();
  for (let i = eData.length - 1; i >= 1; i--) {
    if (eData[i][0] === p.id) {
      try { DriveApp.getFileById(eData[i][2]).setTrashed(true); } catch(e) {}
      evSheet.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  ev_driveUpload  — sube foto de evento a Drive
// ─────────────────────────────────────────────────
function ev_driveUpload(p) {
  const base64 = p.fileData.split(',')[1];
  const blob   = Utilities.newBlob(Utilities.base64Decode(base64), p.mimeType, p.fileName);

  const rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), DRIVE_ROOT);
  const evFolder   = getOrCreateFolder(rootFolder, 'eventos');
  const tipoFolder = getOrCreateFolder(evFolder,   p.tipo   || 'Otro');
  const nombFolder = getOrCreateFolder(tipoFolder, p.nombre || p.evento_id);

  const evSheet = getSheet('eventos_evidence');
  const eData   = evSheet.getDataRange().getValues();
  for (let i = 1; i < eData.length; i++) {
    if (eData[i][0] === p.evento_id && String(eData[i][1]) === String(p.slot)) {
      try { DriveApp.getFileById(eData[i][2]).setTrashed(true); } catch(e) {}
      evSheet.deleteRow(i + 1);
      break;
    }
  }

  const file = nombFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId  = file.getId();
  const fileUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
  const now     = Utilities.formatDate(new Date(), 'America/Mexico_City', 'dd/MMM/yyyy');
  evSheet.appendRow([p.evento_id, p.slot, fileId, fileUrl, p.fileName, now]);
  return { ok: true, fileId, fileUrl };
}

// ─────────────────────────────────────────────────
//  ev_driveDelete  — borra foto de evento de Drive
// ─────────────────────────────────────────────────
function ev_driveDelete(p) {
  const evSheet = getSheet('eventos_evidence');
  const eData   = evSheet.getDataRange().getValues();
  for (let i = 1; i < eData.length; i++) {
    if (eData[i][0] === p.evento_id && String(eData[i][1]) === String(p.slot)) {
      try { DriveApp.getFileById(eData[i][2]).setTrashed(true); } catch(e) {}
      evSheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────
function getSheet(name) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let   sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'supervision_status') {
      sheet.appendRow(['programa', 'actividad_idx', 'estatus', 'observaciones']);
    } else if (name === 'supervision_evidence') {
      sheet.appendRow(['programa', 'actividad_idx', 'slot', 'fileId', 'fileUrl', 'fileName', 'uploadedAt']);
    } else if (name === 'eventos') {
      sheet.appendRow(['id','tipo','nombre','fecha','presentes','actividades','autoridades','notas','createdAt']);
    } else if (name === 'eventos_evidence') {
      sheet.appendRow(['evento_id','slot','fileId','fileUrl','fileName','uploadedAt']);
    }
  }
  return sheet;
}

function getOrCreateFolder(parent, name) {
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}
