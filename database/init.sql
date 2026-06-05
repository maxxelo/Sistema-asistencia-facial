-- =====================================================
-- SISTEMA DE GESTIÓN ESCOLAR CON RECONOCIMIENTO FACIAL
-- 30 TABLAS NORMALIZADAS (VERSIÓN CORREGIDA)
-- =====================================================

-- Extensión para hashing seguro de contraseñas (bcrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- MÓDULO 1: PERSONAS (4 tablas)
-- =====================================================

-- 1. alumnos
CREATE TABLE IF NOT EXISTS alumnos (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(12) UNIQUE NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    apellido_paterno VARCHAR(50) NOT NULL,
    apellido_materno VARCHAR(50),
    email VARCHAR(100),
    telefono VARCHAR(15),
    direccion VARCHAR(200),
    fecha_nacimiento DATE,
    id_curso INTEGER,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. apoderados
CREATE TABLE IF NOT EXISTS apoderados (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(12) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(15),
    email VARCHAR(100),
    parentesco VARCHAR(30),
    direccion VARCHAR(200),
    activo BOOLEAN DEFAULT TRUE
);

-- 3. alumnos_apoderados (tabla puente)
CREATE TABLE IF NOT EXISTS alumnos_apoderados (
    id_alumno INTEGER NOT NULL,
    id_apoderado INTEGER NOT NULL,
    PRIMARY KEY (id_alumno, id_apoderado),
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_apoderado) REFERENCES apoderados(id) ON DELETE CASCADE
);

-- 4. profesores
CREATE TABLE IF NOT EXISTS profesores (
    id SERIAL PRIMARY KEY,
    rut VARCHAR(12) UNIQUE NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    apellido_paterno VARCHAR(50) NOT NULL,
    apellido_materno VARCHAR(50),
    email VARCHAR(100),
    telefono VARCHAR(15),
    especialidad VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =====================================================
-- MÓDULO 2: ACADÉMICO (4 tablas)
-- =====================================================

-- 5. cursos
CREATE TABLE IF NOT EXISTS cursos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(20) NOT NULL,
    nivel VARCHAR(10),
    letra VARCHAR(1),
    anio INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    id_profesor_jefe INTEGER,
    activo BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (id_profesor_jefe) REFERENCES profesores(id) ON DELETE SET NULL
);

ALTER TABLE alumnos ADD CONSTRAINT fk_alumnos_curso
    FOREIGN KEY (id_curso) REFERENCES cursos(id) ON DELETE SET NULL;

-- 6. asignaturas
CREATE TABLE IF NOT EXISTS asignaturas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    codigo VARCHAR(20) UNIQUE,
    horas_semanales INTEGER DEFAULT 4,
    activo BOOLEAN DEFAULT TRUE
);

-- 7. horarios
-- UNIQUE evita crear el mismo bloque horario dos veces para el mismo curso
CREATE TABLE IF NOT EXISTS horarios (
    id SERIAL PRIMARY KEY,
    id_curso INTEGER NOT NULL,
    id_asignatura INTEGER NOT NULL,
    id_profesor INTEGER NOT NULL,
    dia_semana INTEGER CHECK (dia_semana BETWEEN 1 AND 7), -- 1=lunes, 7=domingo
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    sala VARCHAR(10),
    FOREIGN KEY (id_curso) REFERENCES cursos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_asignatura) REFERENCES asignaturas(id) ON DELETE CASCADE,
    FOREIGN KEY (id_profesor) REFERENCES profesores(id) ON DELETE CASCADE,
    UNIQUE(id_curso, id_asignatura, dia_semana, hora_inicio)
);

-- 8. periodos_academicos
CREATE TABLE IF NOT EXISTS periodos_academicos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activo BOOLEAN DEFAULT FALSE
);

-- =====================================================
-- MÓDULO 3: ASISTENCIA (4 tablas)
-- =====================================================

-- 9. asistencia_cabecera
-- FIX: se agrega id_horario para distinguir clases distintas del mismo día
-- FIX: UNIQUE cambia de (fecha, id_curso) a (fecha, id_horario) para permitir
--      múltiples registros de asistencia por día (ej: Matemáticas 8am y Lenguaje 10am)
CREATE TABLE IF NOT EXISTS asistencia_cabecera (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL,
    id_curso INTEGER NOT NULL,
    id_horario INTEGER NOT NULL,
    hora_registro TIME DEFAULT CURRENT_TIME,
    id_profesor INTEGER,
    observacion TEXT,
    FOREIGN KEY (id_curso) REFERENCES cursos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_horario) REFERENCES horarios(id) ON DELETE CASCADE,
    FOREIGN KEY (id_profesor) REFERENCES profesores(id) ON DELETE SET NULL,
    UNIQUE(fecha, id_horario)
);

-- 10. asistencia_detalle
CREATE TABLE IF NOT EXISTS asistencia_detalle (
    id SERIAL PRIMARY KEY,
    id_asistencia_cabecera INTEGER NOT NULL,
    id_alumno INTEGER NOT NULL,
    presente BOOLEAN DEFAULT FALSE,
    hora_marcada TIME,
    tipo_asistencia VARCHAR(20) DEFAULT 'normal',
    observacion TEXT,
    FOREIGN KEY (id_asistencia_cabecera) REFERENCES asistencia_cabecera(id) ON DELETE CASCADE,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE,
    UNIQUE(id_asistencia_cabecera, id_alumno)
);

-- 11. justificaciones
CREATE TABLE IF NOT EXISTS justificaciones (
    id SERIAL PRIMARY KEY,
    id_asistencia_detalle INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    estado VARCHAR(20) DEFAULT 'pendiente',
    fecha_justificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_asistencia_detalle) REFERENCES asistencia_detalle(id) ON DELETE CASCADE
);

-- 12. asistencia_facial_log
-- Log vinculado al proceso de marcar asistencia; id_asistencia_detalle la conecta
-- al registro generado. Distinta de intentos_reconocimiento (módulo 4) que es solo
-- para depuración técnica del motor de reconocimiento.
CREATE TABLE IF NOT EXISTS asistencia_facial_log (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER,
    id_asistencia_detalle INTEGER,
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exito BOOLEAN DEFAULT FALSE,
    confianza REAL,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE SET NULL,
    FOREIGN KEY (id_asistencia_detalle) REFERENCES asistencia_detalle(id) ON DELETE SET NULL
);

-- =====================================================
-- MÓDULO 4: RECONOCIMIENTO FACIAL (3 tablas)
-- =====================================================

-- 13. rostros
-- FIX: descriptor_facial cambia de TEXT a FLOAT[] para almacenar el vector de
--      características correctamente (128 o 512 dimensiones según el modelo)
CREATE TABLE IF NOT EXISTS rostros (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER UNIQUE NOT NULL,
    descriptor_facial FLOAT[] NOT NULL,
    fecha_captura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE
);

-- 14. intentos_reconocimiento
-- Log técnico de éxitos/fallos del motor facial, para depuración. No está vinculado
-- al registro de asistencia (eso lo hace asistencia_facial_log en módulo 3).
CREATE TABLE IF NOT EXISTS intentos_reconocimiento (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER,
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exito BOOLEAN DEFAULT FALSE,
    confianza REAL,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE SET NULL
);

-- 15. configuracion_biometrica
-- FIX: CHECK (id = 1) garantiza que solo pueda existir una fila de configuración
CREATE TABLE IF NOT EXISTS configuracion_biometrica (
    id SERIAL PRIMARY KEY CHECK (id = 1),
    umbral_confianza REAL DEFAULT 0.6,
    tiempo_maximo_segundos INTEGER DEFAULT 5,
    intentos_permitidos INTEGER DEFAULT 3
);

-- =====================================================
-- MÓDULO 5: SEGURIDAD (5 tablas)
-- =====================================================

-- 15. roles
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT
);

-- 16. usuarios
-- FIX: se agrega id_profesor para vincular el usuario a su registro en profesores
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    id_rol INTEGER NOT NULL,
    id_profesor INTEGER,
    tipo_persona VARCHAR(20) CHECK (tipo_persona IN ('admin', 'profesor')),
    activo BOOLEAN DEFAULT TRUE,
    ultimo_acceso TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_rol) REFERENCES roles(id) ON DELETE RESTRICT,
    FOREIGN KEY (id_profesor) REFERENCES profesores(id) ON DELETE SET NULL
);

-- 17. permisos
CREATE TABLE IF NOT EXISTS permisos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    recurso VARCHAR(100),
    accion VARCHAR(50)
);

-- 18. roles_permisos (FIX: tabla faltante para RBAC completo)
-- Asigna permisos a roles; usuarios_permisos es solo para excepciones individuales
CREATE TABLE IF NOT EXISTS roles_permisos (
    id_rol INTEGER NOT NULL,
    id_permiso INTEGER NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_rol, id_permiso),
    FOREIGN KEY (id_rol) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (id_permiso) REFERENCES permisos(id) ON DELETE CASCADE
);

-- 19. usuarios_permisos (permisos adicionales directos al usuario, excepciones al rol)
CREATE TABLE IF NOT EXISTS usuarios_permisos (
    id_usuario INTEGER NOT NULL,
    id_permiso INTEGER NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, id_permiso),
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (id_permiso) REFERENCES permisos(id) ON DELETE CASCADE
);

-- =====================================================
-- MÓDULO 6: CALIFICACIONES (3 tablas)
-- =====================================================

-- 20. evaluaciones
CREATE TABLE IF NOT EXISTS evaluaciones (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    fecha DATE NOT NULL,
    id_asignatura INTEGER NOT NULL,
    id_periodo INTEGER NOT NULL,
    porcentaje REAL CHECK (porcentaje BETWEEN 0 AND 100),
    tipo_evaluacion VARCHAR(20) CHECK (tipo_evaluacion IN ('prueba', 'trabajo', 'control', 'examen')),
    FOREIGN KEY (id_asignatura) REFERENCES asignaturas(id) ON DELETE CASCADE,
    FOREIGN KEY (id_periodo) REFERENCES periodos_academicos(id) ON DELETE CASCADE
);

-- 21. calificaciones
-- FIX: nota cambia de REAL a NUMERIC(3,1) para evitar errores de precisión flotante
--      (ej: REAL puede guardar 6.5 como 6.4999999...)
CREATE TABLE IF NOT EXISTS calificaciones (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER NOT NULL,
    id_evaluacion INTEGER NOT NULL,
    nota NUMERIC(3,1) CHECK (nota BETWEEN 1.0 AND 7.0),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_evaluacion) REFERENCES evaluaciones(id) ON DELETE CASCADE,
    UNIQUE(id_alumno, id_evaluacion)
);

-- 22. promedios
-- FIX: promedio cambia de REAL a NUMERIC(3,1) por la misma razón que nota
CREATE TABLE IF NOT EXISTS promedios (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER NOT NULL,
    id_asignatura INTEGER NOT NULL,
    id_periodo INTEGER NOT NULL,
    promedio NUMERIC(3,1) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_asignatura) REFERENCES asignaturas(id) ON DELETE CASCADE,
    FOREIGN KEY (id_periodo) REFERENCES periodos_academicos(id) ON DELETE CASCADE,
    UNIQUE(id_alumno, id_asignatura, id_periodo)
);

-- =====================================================
-- MÓDULO 7: COMUNICACIONES (3 tablas)
-- =====================================================

-- 23. notificaciones
CREATE TABLE IF NOT EXISTS notificaciones (
    id SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL,
    titulo VARCHAR(100) NOT NULL,
    mensaje TEXT,
    leida BOOLEAN DEFAULT FALSE,
    fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- 24. comunicados
CREATE TABLE IF NOT EXISTS comunicados (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(100) NOT NULL,
    contenido TEXT NOT NULL,
    id_autor INTEGER,
    fecha_publicacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_autor) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- 25. ficha_medica
CREATE TABLE IF NOT EXISTS ficha_medica (
    id SERIAL PRIMARY KEY,
    id_alumno INTEGER NOT NULL UNIQUE,
    tipo_sangre VARCHAR(5),
    alergias TEXT,
    condiciones_cronicas TEXT,
    medicamentos TEXT,
    contacto_emergencia_nombre VARCHAR(100),
    contacto_emergencia_telefono VARCHAR(15),
    seguro_medico VARCHAR(50),
    observaciones TEXT,
    FOREIGN KEY (id_alumno) REFERENCES alumnos(id) ON DELETE CASCADE
);

-- =====================================================
-- MÓDULO 8: MANTENCIÓN (3 tablas)
-- =====================================================

-- 26. parametros_sistema
CREATE TABLE IF NOT EXISTS parametros_sistema (
    id SERIAL PRIMARY KEY,
    clave VARCHAR(50) UNIQUE NOT NULL,
    valor TEXT,
    descripcion TEXT
);

-- 27. bitacora_operaciones
CREATE TABLE IF NOT EXISTS bitacora_operaciones (
    id SERIAL PRIMARY KEY,
    id_usuario INTEGER,
    accion VARCHAR(100),
    tabla_afectada VARCHAR(50),
    registro_id INTEGER,
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- 28. aulas
CREATE TABLE IF NOT EXISTS aulas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(10) UNIQUE NOT NULL,
    nombre VARCHAR(50),
    capacidad INTEGER DEFAULT 30
);

-- =====================================================
-- MÓDULO 9: REPORTES (2 tablas simplificadas)
-- =====================================================

-- 29. reportes_plantillas
CREATE TABLE IF NOT EXISTS reportes_plantillas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    query_sql TEXT,
    activo BOOLEAN DEFAULT TRUE
);

-- 30. reportes_generados
CREATE TABLE IF NOT EXISTS reportes_generados (
    id SERIAL PRIMARY KEY,
    id_plantilla INTEGER NOT NULL,
    id_usuario_genero INTEGER,
    fecha_generacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_plantilla) REFERENCES reportes_plantillas(id) ON DELETE CASCADE,
    FOREIGN KEY (id_usuario_genero) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- =====================================================
-- ÍNDICES BÁSICOS
-- =====================================================

CREATE INDEX idx_alumnos_curso ON alumnos(id_curso);
CREATE INDEX idx_alumnos_rut ON alumnos(rut);
CREATE INDEX idx_asistencia_fecha ON asistencia_cabecera(fecha);
CREATE INDEX idx_asistencia_alumno ON asistencia_detalle(id_alumno);
-- idx_rostros_alumno eliminado: id_alumno UNIQUE ya crea un índice implícito

-- =====================================================
-- DATOS INICIALES MÍNIMOS
-- =====================================================

INSERT INTO roles (nombre, descripcion) VALUES
('admin', 'Administrador del sistema'),
('profesor', 'Profesor')
ON CONFLICT (nombre) DO NOTHING;

-- FIX: password hasheada con bcrypt via pgcrypto (ya no texto plano)
INSERT INTO usuarios (nombre_usuario, password_hash, id_rol, tipo_persona)
VALUES ('admin', crypt('admin123', gen_salt('bf', 10)), 1, 'admin')
ON CONFLICT (nombre_usuario) DO NOTHING;

INSERT INTO configuracion_biometrica (umbral_confianza, tiempo_maximo_segundos, intentos_permitidos)
VALUES (0.6, 5, 3);

INSERT INTO periodos_academicos (nombre, fecha_inicio, fecha_fin, activo) VALUES
('Primer Semestre', '2025-03-01', '2025-07-31', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO parametros_sistema (clave, valor, descripcion) VALUES
('nombre_colegio', 'Colegio Ejemplo', 'Nombre de la institución')
ON CONFLICT (clave) DO NOTHING;
