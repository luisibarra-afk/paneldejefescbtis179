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
    }
  }
  return sheet;
}

function getOrCreateFolder(parent, name) {
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}
