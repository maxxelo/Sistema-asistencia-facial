const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const PDFDocument = require('pdfkit');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// ── Historial de reportes (tablas reportes_plantillas / reportes_generados) ──
// Deja constancia de cada reporte emitido y quién lo generó.
// Nunca lanza error: si falla solo se registra en consola.
async function registrarReporte(nombrePlantilla, descripcion, idUsuario) {
  try {
    let idPlantilla;
    const existente = await pool.query(
      'SELECT id FROM reportes_plantillas WHERE nombre = $1',
      [nombrePlantilla]
    );
    if (existente.rows.length) {
      idPlantilla = existente.rows[0].id;
    } else {
      const nueva = await pool.query(
        'INSERT INTO reportes_plantillas (nombre, descripcion) VALUES ($1, $2) RETURNING id',
        [nombrePlantilla, descripcion]
      );
      idPlantilla = nueva.rows[0].id;
    }
    await pool.query(
      'INSERT INTO reportes_generados (id_plantilla, id_usuario_genero) VALUES ($1, $2)',
      [idPlantilla, idUsuario || null]
    );
  } catch (err) {
    console.error('[registrarReporte]', err.message);
  }
}

// Nombre del colegio para el encabezado de los PDF
async function nombreColegio() {
  try {
    const r = await pool.query(
      "SELECT valor FROM parametros_sistema WHERE clave = 'nombre_colegio'"
    );
    return r.rows.length && r.rows[0].valor ? r.rows[0].valor : 'Colegio';
  } catch {
    return 'Colegio';
  }
}

// ── Helpers de dibujo PDF ──────────────────────────────
const PDF_MARGEN = 50;
const PDF_ANCHO  = 595.28; // A4 vertical en puntos

function pdfEncabezado(doc, colegio, titulo, subtitulo) {
  doc.fontSize(10).fillColor('#666666').text(colegio, PDF_MARGEN, 40);
  doc.fontSize(18).fillColor('#1e3a8a').text(titulo, PDF_MARGEN, 58);
  if (subtitulo) doc.fontSize(11).fillColor('#374151').text(subtitulo, PDF_MARGEN, 82);
  doc.fontSize(8).fillColor('#9ca3af')
     .text(`Generado: ${new Date().toLocaleString('es-CL')}`, PDF_MARGEN, 40, {
       width: PDF_ANCHO - PDF_MARGEN * 2, align: 'right'
     });
  doc.moveTo(PDF_MARGEN, 100).lineTo(PDF_ANCHO - PDF_MARGEN, 100)
     .strokeColor('#d1d5db').lineWidth(1).stroke();
  return 112; // posición Y donde sigue el contenido
}

// Dibuja una tabla con encabezado repetido en cada página.
// columnas: [{ titulo, ancho, align? }]  filas: arreglo de arreglos de strings
function pdfTabla(doc, columnas, filas, yInicial) {
  const altoFila = 18;
  const limiteY  = 780;
  let y = yInicial;

  const dibujarHeader = () => {
    doc.rect(PDF_MARGEN, y, PDF_ANCHO - PDF_MARGEN * 2, altoFila).fill('#1e3a8a');
    let x = PDF_MARGEN;
    doc.fontSize(8).fillColor('#ffffff');
    columnas.forEach(c => {
      doc.text(c.titulo, x + 4, y + 5, { width: c.ancho - 8, align: c.align || 'left' });
      x += c.ancho;
    });
    y += altoFila;
  };

  dibujarHeader();
  filas.forEach((fila, i) => {
    if (y + altoFila > limiteY) {
      doc.addPage();
      y = 50;
      dibujarHeader();
    }
    if (i % 2 === 0) {
      doc.rect(PDF_MARGEN, y, PDF_ANCHO - PDF_MARGEN * 2, altoFila).fill('#f3f4f6');
    }
    let x = PDF_MARGEN;
    doc.fontSize(8).fillColor('#111827');
    fila.forEach((celda, j) => {
      doc.text(String(celda ?? ''), x + 4, y + 5, {
        width: columnas[j].ancho - 8,
        align: columnas[j].align || 'left',
        lineBreak: false
      });
      x += columnas[j].ancho;
    });
    y += altoFila;
  });
  return y;
}

// =====================================================
// GET /reportes/asistencia/alumno/:id
// Informe completo de asistencia de un alumno:
//   - % global y por asignatura
//   - historial de clases
//   - flag de riesgo (<= umbral configurable, default 85%)
// Auth: Admin o Profesor
// =====================================================
router.get('/asistencia/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  const umbral = parseFloat(req.query.umbral) || 85;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Datos del alumno
    const alumnoRes = await pool.query(
      `SELECT a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
              c.nombre AS curso, c.nivel, c.anio
       FROM alumnos a
       LEFT JOIN cursos c ON a.id_curso = c.id
       WHERE a.id = $1`, [id]
    );
    if (!alumnoRes.rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    const alumno = alumnoRes.rows[0];

    // Resumen por asignatura
    const resumenRes = await pool.query(
      `SELECT
         asig.nombre          AS asignatura,
         asig.codigo          AS codigo_asig,
         COUNT(ad.id)         AS total_clases,
         SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS clases_presentes,
         ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
               / NULLIF(COUNT(ad.id), 0), 1) AS porcentaje
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h             ON ac.id_horario = h.id
       JOIN asignaturas asig       ON h.id_asignatura = asig.id
       WHERE ad.id_alumno = $1
       GROUP BY asig.id, asig.nombre, asig.codigo
       ORDER BY asig.nombre`, [id]
    );

    // Historial detallado (últimas 50 clases)
    const historialRes = await pool.query(
      `SELECT
         ac.fecha,
         asig.nombre          AS asignatura,
         c.nombre             AS curso,
         h.hora_inicio, h.hora_fin,
         ad.presente, ad.hora_marcada, ad.tipo_asistencia,
         j.motivo             AS justificacion,
         j.estado             AS estado_justificacion
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h             ON ac.id_horario = h.id
       JOIN asignaturas asig       ON h.id_asignatura = asig.id
       JOIN cursos c               ON ac.id_curso = c.id
       LEFT JOIN justificaciones j ON j.id_asistencia_detalle = ad.id
       WHERE ad.id_alumno = $1
       ORDER BY ac.fecha DESC, h.hora_inicio DESC
       LIMIT 50`, [id]
    );

    // Calcular globales
    const totalClases    = resumenRes.rows.reduce((s,r) => s + parseInt(r.total_clases),0);
    const totalPresentes = resumenRes.rows.reduce((s,r) => s + parseInt(r.clases_presentes),0);
    const pctGlobal      = totalClases > 0
      ? parseFloat((100 * totalPresentes / totalClases).toFixed(1))
      : null;

    // Asignaturas en riesgo
    const asignaturasRiesgo = resumenRes.rows.filter(r =>
      r.porcentaje !== null && parseFloat(r.porcentaje) < umbral
    );

    res.json({
      alumno,
      resumen_global: {
        total_clases: totalClases,
        clases_presentes: totalPresentes,
        clases_ausentes: totalClases - totalPresentes,
        porcentaje_global: pctGlobal,
        en_riesgo: pctGlobal !== null && pctGlobal < umbral,
        umbral_usado: umbral
      },
      por_asignatura: resumenRes.rows,
      asignaturas_en_riesgo: asignaturasRiesgo,
      historial: historialRes.rows
    });
  } catch (err) {
    console.error('[GET /reportes/asistencia/alumno/:id]', err.message);
    res.status(500).json({ error: 'Error al generar reporte de alumno' });
  }
});

// =====================================================
// GET /reportes/asistencia/curso/:id
// Informe de asistencia de todos los alumnos de un curso.
// Devuelve: lista de alumnos con % global y por asignatura.
// Auth: Admin o Profesor
// =====================================================
router.get('/asistencia/curso/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  const umbral = parseFloat(req.query.umbral) || 85;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Info del curso
    const cursoRes = await pool.query(
      `SELECT c.id, c.nombre, c.nivel, c.anio,
              p.nombre || ' ' || p.apellido_paterno AS profesor_jefe
       FROM cursos c
       LEFT JOIN profesores p ON c.id_profesor_jefe = p.id
       WHERE c.id = $1`, [id]
    );
    if (!cursoRes.rows.length) return res.status(404).json({ error: 'Curso no encontrado' });

    // Alumnos activos del curso
    const alumnosRes = await pool.query(
      `SELECT id, rut, nombre, apellido_paterno, apellido_materno
       FROM alumnos WHERE id_curso = $1 AND activo = TRUE
       ORDER BY apellido_paterno, apellido_materno, nombre`, [id]
    );

    // Asistencia por alumno por asignatura
    const asistenciaRes = await pool.query(
      `SELECT
         ad.id_alumno,
         asig.nombre         AS asignatura,
         COUNT(ad.id)        AS total_clases,
         SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
         ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
               / NULLIF(COUNT(ad.id),0), 1) AS porcentaje
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h             ON ac.id_horario = h.id
       JOIN asignaturas asig       ON h.id_asignatura = asig.id
       WHERE ac.id_curso = $1
       GROUP BY ad.id_alumno, asig.id, asig.nombre
       ORDER BY asig.nombre`, [id]
    );

    // Armar estructura: { id_alumno → { asig → {total, presentes, pct} } }
    const mapaAsig = {};
    asistenciaRes.rows.forEach(r => {
      if (!mapaAsig[r.id_alumno]) mapaAsig[r.id_alumno] = {};
      mapaAsig[r.id_alumno][r.asignatura] = {
        total_clases: parseInt(r.total_clases),
        presentes: parseInt(r.presentes),
        porcentaje: r.porcentaje !== null ? parseFloat(r.porcentaje) : null
      };
    });

    const alumnos = alumnosRes.rows.map(a => {
      const asigs  = mapaAsig[a.id] || {};
      const totals = Object.values(asigs);
      const totalC = totals.reduce((s,x) => s + x.total_clases, 0);
      const totalP = totals.reduce((s,x) => s + x.presentes, 0);
      const pct    = totalC > 0 ? parseFloat((100*totalP/totalC).toFixed(1)) : null;
      return {
        ...a,
        asistencia_global: { total_clases: totalC, presentes: totalP, porcentaje: pct, en_riesgo: pct !== null && pct < umbral },
        por_asignatura: asigs
      };
    });

    const enRiesgo = alumnos.filter(a => a.asistencia_global.en_riesgo);

    res.json({
      curso: cursoRes.rows[0],
      total_alumnos: alumnos.length,
      alumnos_en_riesgo: enRiesgo.length,
      umbral,
      alumnos,
      resumen_riesgo: enRiesgo.map(a => ({
        id: a.id, nombre: `${a.nombre} ${a.apellido_paterno}`,
        porcentaje: a.asistencia_global.porcentaje
      }))
    });
  } catch (err) {
    console.error('[GET /reportes/asistencia/curso/:id]', err.message);
    res.status(500).json({ error: 'Error al generar reporte de curso' });
  }
});

// =====================================================
// GET /reportes/asistencia/riesgo
// Lista de TODOS los alumnos con asistencia < umbral (default 85%)
// Auth: Admin o Profesor
// =====================================================
router.get('/asistencia/riesgo', verificarToken, adminOProfesor, async (req, res) => {
  const umbral = parseFloat(req.query.umbral) || 85;

  try {
    const result = await pool.query(
      `SELECT
         a.id, a.rut,
         a.nombre || ' ' || a.apellido_paterno AS nombre_completo,
         c.nombre   AS curso,
         c.nivel,
         COUNT(ad.id)  AS total_clases,
         SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
         ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
               / NULLIF(COUNT(ad.id),0), 1) AS porcentaje
       FROM alumnos a
       LEFT JOIN cursos c ON a.id_curso = c.id
       LEFT JOIN asistencia_detalle ad ON ad.id_alumno = a.id
       WHERE a.activo = TRUE
       GROUP BY a.id, a.rut, a.nombre, a.apellido_paterno, c.nombre, c.nivel
       HAVING COUNT(ad.id) > 0
          AND ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
                / NULLIF(COUNT(ad.id),0), 1) < $1
       ORDER BY porcentaje ASC, c.nombre, a.apellido_paterno`,
      [umbral]
    );

    res.json({
      umbral,
      total_en_riesgo: result.rows.length,
      alumnos: result.rows
    });
  } catch (err) {
    console.error('[GET /reportes/asistencia/riesgo]', err.message);
    res.status(500).json({ error: 'Error al obtener alumnos en riesgo' });
  }
});

// =====================================================
// GET /reportes/asistencia/colegio
// Resumen general: total alumnos, % promedio por curso
// Auth: Solo Admin
// =====================================================
router.get('/asistencia/colegio', verificarToken, soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id, c.nombre AS curso, c.nivel, c.anio,
         COUNT(DISTINCT a.id)  AS total_alumnos,
         COUNT(ad.id)          AS total_registros,
         SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS total_presentes,
         ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
               / NULLIF(COUNT(ad.id),0), 1) AS porcentaje_promedio
       FROM cursos c
       LEFT JOIN alumnos a ON a.id_curso = c.id AND a.activo = TRUE
       LEFT JOIN asistencia_detalle ad ON ad.id_alumno = a.id
       WHERE c.activo = TRUE
       GROUP BY c.id, c.nombre, c.nivel, c.anio
       ORDER BY c.anio DESC, c.nivel, c.nombre`
    );

    const totalAlumnos  = result.rows.reduce((s,r) => s + parseInt(r.total_alumnos||0), 0);
    const totalRegistros = result.rows.reduce((s,r) => s + parseInt(r.total_registros||0), 0);
    const totalPresentes = result.rows.reduce((s,r) => s + parseInt(r.total_presentes||0), 0);
    const pctGlobal = totalRegistros > 0
      ? parseFloat((100*totalPresentes/totalRegistros).toFixed(1))
      : null;

    res.json({
      resumen_global: {
        total_alumnos: totalAlumnos,
        total_registros: totalRegistros,
        total_presentes: totalPresentes,
        porcentaje_global: pctGlobal
      },
      por_curso: result.rows
    });
  } catch (err) {
    console.error('[GET /reportes/asistencia/colegio]', err.message);
    res.status(500).json({ error: 'Error al generar reporte del colegio' });
  }
});

// =====================================================
// GET /reportes/csv/curso/:id
// Exporta la asistencia del curso como CSV
// Auth: Admin o Profesor
// =====================================================
router.get('/csv/curso/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const cursoRes = await pool.query(
      'SELECT nombre FROM cursos WHERE id = $1', [id]
    );
    if (!cursoRes.rows.length) return res.status(404).json({ error: 'Curso no encontrado' });
    const nombreCurso = cursoRes.rows[0].nombre;

    const result = await pool.query(
      `SELECT
         a.rut,
         a.nombre || ' ' || a.apellido_paterno || ' ' || COALESCE(a.apellido_materno,'') AS alumno,
         asig.nombre    AS asignatura,
         COUNT(ad.id)   AS total_clases,
         SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
         ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
               / NULLIF(COUNT(ad.id),0), 1) AS porcentaje
       FROM alumnos a
       LEFT JOIN asistencia_detalle ad ON ad.id_alumno = a.id
       LEFT JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       LEFT JOIN horarios h  ON ac.id_horario = h.id
       LEFT JOIN asignaturas asig ON h.id_asignatura = asig.id
       WHERE a.id_curso = $1 AND a.activo = TRUE
       GROUP BY a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno, asig.id, asig.nombre
       ORDER BY a.apellido_paterno, asig.nombre`, [id]
    );

    const fecha = new Date().toISOString().slice(0,10);
    const filename = `asistencia_${nombreCurso.replace(/\s+/g,'_')}_${fecha}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // BOM para que Excel abra correctamente en español
    let csv = '﻿';
    csv += 'RUT,Alumno,Asignatura,Total Clases,Presentes,Ausentes,% Asistencia\n';
    result.rows.forEach(r => {
      const ausentes = parseInt(r.total_clases||0) - parseInt(r.presentes||0);
      csv += `"${r.rut}","${r.alumno}","${r.asignatura||''}",${r.total_clases||0},${r.presentes||0},${ausentes},${r.porcentaje||0}\n`;
    });
    res.send(csv);
    registrarReporte('asistencia_curso_csv', 'CSV de asistencia de un curso', req.usuario?.id);
  } catch (err) {
    console.error('[GET /reportes/csv/curso/:id]', err.message);
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

// =====================================================
// GET /reportes/csv/alumno/:id
// Exporta el historial de asistencia de un alumno como CSV
// Auth: Admin o Profesor
// =====================================================
router.get('/csv/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const alumnoRes = await pool.query(
      'SELECT nombre, apellido_paterno, rut FROM alumnos WHERE id = $1', [id]
    );
    if (!alumnoRes.rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    const al = alumnoRes.rows[0];

    const result = await pool.query(
      `SELECT
         ac.fecha, asig.nombre AS asignatura,
         h.hora_inicio, h.hora_fin,
         CASE WHEN ad.presente THEN 'Presente' ELSE 'Ausente' END AS estado,
         ad.hora_marcada,
         COALESCE(ad.tipo_asistencia, '') AS tipo,
         COALESCE(j.motivo, '') AS justificacion
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h  ON ac.id_horario = h.id
       JOIN asignaturas asig ON h.id_asignatura = asig.id
       LEFT JOIN justificaciones j ON j.id_asistencia_detalle = ad.id
       WHERE ad.id_alumno = $1
       ORDER BY ac.fecha DESC, h.hora_inicio DESC`, [id]
    );

    const fecha    = new Date().toISOString().slice(0,10);
    const filename = `historial_${al.rut}_${fecha}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    let csv = '﻿';
    csv += 'Fecha,Asignatura,Hora Inicio,Hora Fin,Estado,Hora Marcada,Tipo,Justificación\n';
    result.rows.forEach(r => {
      csv += `${r.fecha},` +
             `"${r.asignatura}",` +
             `${r.hora_inicio?.slice(0,5)||''},` +
             `${r.hora_fin?.slice(0,5)||''},` +
             `${r.estado},` +
             `${r.hora_marcada?.slice(0,5)||''},` +
             `${r.tipo},` +
             `"${r.justificacion}"\n`;
    });
    res.send(csv);
    registrarReporte('asistencia_alumno_csv', 'CSV del historial de asistencia de un alumno', req.usuario?.id);
  } catch (err) {
    console.error('[GET /reportes/csv/alumno/:id]', err.message);
    res.status(500).json({ error: 'Error al exportar CSV' });
  }
});

// =====================================================
// GET /reportes/pdf/alumno/:id
// Informe de asistencia de un alumno en PDF
// Auth: Admin o Profesor
// =====================================================
router.get('/pdf/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const alumnoRes = await pool.query(
      `SELECT a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
              c.nombre AS curso
       FROM alumnos a
       LEFT JOIN cursos c ON a.id_curso = c.id
       WHERE a.id = $1`, [id]
    );
    if (!alumnoRes.rows.length) return res.status(404).json({ error: 'Alumno no encontrado' });
    const al = alumnoRes.rows[0];

    const resumenRes = await pool.query(
      `SELECT asig.nombre AS asignatura,
              COUNT(ad.id) AS total,
              SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
              ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(ad.id), 0), 1) AS porcentaje
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h             ON ac.id_horario = h.id
       JOIN asignaturas asig       ON h.id_asignatura = asig.id
       WHERE ad.id_alumno = $1
       GROUP BY asig.id, asig.nombre
       ORDER BY asig.nombre`, [id]
    );

    const historialRes = await pool.query(
      `SELECT ac.fecha, asig.nombre AS asignatura, h.hora_inicio,
              ad.presente, ad.hora_marcada, ad.tipo_asistencia,
              COALESCE(j.estado, '') AS estado_justificacion
       FROM asistencia_detalle ad
       JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
       JOIN horarios h             ON ac.id_horario = h.id
       JOIN asignaturas asig       ON h.id_asignatura = asig.id
       LEFT JOIN justificaciones j ON j.id_asistencia_detalle = ad.id
       WHERE ad.id_alumno = $1
       ORDER BY ac.fecha DESC, h.hora_inicio DESC
       LIMIT 40`, [id]
    );

    const colegio       = await nombreColegio();
    const nombreAlumno  = `${al.nombre} ${al.apellido_paterno} ${al.apellido_materno || ''}`.trim();
    const totalClases   = resumenRes.rows.reduce((s, r) => s + parseInt(r.total), 0);
    const totalPres     = resumenRes.rows.reduce((s, r) => s + parseInt(r.presentes), 0);
    const pctGlobal     = totalClases ? (100 * totalPres / totalClases).toFixed(1) : null;

    const fechaHoy  = new Date().toISOString().slice(0, 10);
    const filename  = `reporte_asistencia_${al.rut}_${fechaHoy}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: PDF_MARGEN });
    doc.pipe(res);

    let y = pdfEncabezado(doc, colegio, 'Reporte de Asistencia — Alumno',
      `${nombreAlumno}  ·  RUT ${al.rut}  ·  Curso ${al.curso || 'sin curso'}`);

    // Resumen global
    doc.fontSize(11).fillColor('#111827')
       .text(`Asistencia global: ${pctGlobal !== null ? pctGlobal + '%' : 'sin registros'}`
             + (totalClases ? `   (${totalPres} presentes de ${totalClases} clases)` : ''),
             PDF_MARGEN, y);
    if (pctGlobal !== null && parseFloat(pctGlobal) < 85) {
      y += 16;
      doc.fontSize(9).fillColor('#b91c1c')
         .text('ATENCIÓN: bajo el 85% mínimo legal — riesgo de reprobación por inasistencia.', PDF_MARGEN, y);
    }
    y += 26;

    // Tabla por asignatura
    if (resumenRes.rows.length) {
      doc.fontSize(11).fillColor('#1e3a8a').text('Resumen por asignatura', PDF_MARGEN, y);
      y += 16;
      y = pdfTabla(doc,
        [
          { titulo: 'Asignatura', ancho: 215 },
          { titulo: 'Clases', ancho: 90, align: 'center' },
          { titulo: 'Presentes', ancho: 90, align: 'center' },
          { titulo: '% Asistencia', ancho: 100, align: 'center' }
        ],
        resumenRes.rows.map(r => [r.asignatura, r.total, r.presentes,
          r.porcentaje !== null ? `${r.porcentaje}%` : '—']),
        y
      );
      y += 20;
    }

    // Historial reciente
    if (historialRes.rows.length) {
      if (y > 640) { doc.addPage(); y = 50; }
      doc.fontSize(11).fillColor('#1e3a8a').text('Últimas clases', PDF_MARGEN, y);
      y += 16;
      pdfTabla(doc,
        [
          { titulo: 'Fecha', ancho: 80 },
          { titulo: 'Asignatura', ancho: 150 },
          { titulo: 'Hora', ancho: 55, align: 'center' },
          { titulo: 'Estado', ancho: 80, align: 'center' },
          { titulo: 'Tipo', ancho: 65, align: 'center' },
          { titulo: 'Justificación', ancho: 65, align: 'center' }
        ],
        historialRes.rows.map(h => [
          new Date(h.fecha).toLocaleDateString('es-CL'),
          h.asignatura,
          h.hora_inicio ? h.hora_inicio.slice(0, 5) : '',
          h.presente ? 'Presente' : 'Ausente',
          h.tipo_asistencia === 'facial' ? 'Facial' : (h.tipo_asistencia || '—'),
          h.estado_justificacion || '—'
        ]),
        y
      );
    }

    doc.end();
    registrarReporte('asistencia_alumno_pdf', 'PDF de asistencia individual de un alumno',
                     req.usuario?.id);
  } catch (err) {
    console.error('[GET /reportes/pdf/alumno/:id]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF del alumno' });
  }
});

// =====================================================
// GET /reportes/pdf/curso/:id
// Informe de asistencia de un curso completo en PDF
// Auth: Admin o Profesor
// =====================================================
router.get('/pdf/curso/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const cursoRes = await pool.query(
      `SELECT c.nombre, c.anio,
              p.nombre || ' ' || p.apellido_paterno AS profesor_jefe
       FROM cursos c
       LEFT JOIN profesores p ON c.id_profesor_jefe = p.id
       WHERE c.id = $1`, [id]
    );
    if (!cursoRes.rows.length) return res.status(404).json({ error: 'Curso no encontrado' });
    const curso = cursoRes.rows[0];

    // Una fila por alumno con su % global de asistencia
    const filasRes = await pool.query(
      `SELECT a.rut,
              a.apellido_paterno || ' ' || COALESCE(a.apellido_materno,'') || ', ' || a.nombre AS alumno,
              COUNT(ad.id) AS total,
              SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
              ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
                    / NULLIF(COUNT(ad.id),0), 1) AS porcentaje
       FROM alumnos a
       LEFT JOIN asistencia_detalle ad ON ad.id_alumno = a.id
       WHERE a.id_curso = $1 AND a.activo = TRUE
       GROUP BY a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno
       ORDER BY a.apellido_paterno, a.apellido_materno, a.nombre`, [id]
    );

    const colegio  = await nombreColegio();
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const filename = `reporte_asistencia_${curso.nombre.replace(/\s+/g, '_')}_${fechaHoy}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: PDF_MARGEN });
    doc.pipe(res);

    let y = pdfEncabezado(doc, colegio, `Reporte de Asistencia — Curso ${curso.nombre}`,
      `Año ${curso.anio}` +
      (curso.profesor_jefe ? `  ·  Profesor jefe: ${curso.profesor_jefe}` : '') +
      `  ·  ${filasRes.rows.length} alumno(s)`);

    const conRegistros = filasRes.rows.filter(r => parseInt(r.total) > 0);
    const enRiesgo     = conRegistros.filter(r => r.porcentaje !== null && parseFloat(r.porcentaje) < 85);
    doc.fontSize(10).fillColor('#111827')
       .text(`Alumnos con asistencia bajo el 85%: ${enRiesgo.length}`, PDF_MARGEN, y);
    y += 22;

    pdfTabla(doc,
      [
        { titulo: 'RUT', ancho: 80 },
        { titulo: 'Alumno', ancho: 215 },
        { titulo: 'Clases', ancho: 60, align: 'center' },
        { titulo: 'Presentes', ancho: 60, align: 'center' },
        { titulo: 'Ausentes', ancho: 60, align: 'center' },
        { titulo: '%', ancho: 20, align: 'center' }
      ],
      filasRes.rows.map(r => [
        r.rut,
        r.alumno,
        r.total,
        r.presentes || 0,
        (parseInt(r.total) || 0) - (parseInt(r.presentes) || 0),
        r.porcentaje !== null ? `${r.porcentaje}` : '—'
      ]),
      y
    );

    doc.end();
    registrarReporte('asistencia_curso_pdf', 'PDF de asistencia de un curso completo',
                     req.usuario?.id);
  } catch (err) {
    console.error('[GET /reportes/pdf/curso/:id]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar PDF del curso' });
  }
});

module.exports = router;
