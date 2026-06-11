-- =====================================================
-- DATOS DE PRUEBA (solo para desarrollo)
-- Se ejecuta automáticamente después de init.sql
-- =====================================================

-- Profesor de prueba
INSERT INTO profesores (rut, nombre, apellido_paterno, apellido_materno, email, especialidad) VALUES
('12345678-9', 'Carlos', 'González', 'Pérez', 'cgonzalez@colegio.cl', 'Matemáticas'),
('98765432-1', 'Ana',    'Martínez', 'López', 'amartinez@colegio.cl', 'Lenguaje')
ON CONFLICT (rut) DO NOTHING;

-- Curso de prueba
INSERT INTO cursos (nombre, nivel, letra, anio, id_profesor_jefe) VALUES
('3°A', '3°', 'A', 2025, 1),
('4°B', '4°', 'B', 2025, 2)
ON CONFLICT DO NOTHING;

-- Alumnos de prueba
INSERT INTO alumnos (rut, nombre, apellido_paterno, apellido_materno, email, id_curso) VALUES
('11111111-1', 'Pedro',    'Soto',    'Díaz',   'psoto@alumno.cl',    1),
('22222222-2', 'María',    'Rojas',   'Vega',   'mrojas@alumno.cl',   1),
('33333333-3', 'Joaquín',  'Muñoz',   'Silva',  'jmunoz@alumno.cl',   1),
('44444444-4', 'Valentina','Castro',  'Mora',   'vcastro@alumno.cl',  2),
('55555555-5', 'Bastián',  'Herrera', 'Fuentes','bherrera@alumno.cl', 2)
ON CONFLICT (rut) DO NOTHING;

-- Asignaturas de prueba
INSERT INTO asignaturas (nombre, codigo, horas_semanales) VALUES
('Matemáticas', 'MAT', 6),
('Lenguaje',    'LEN', 6),
('Historia',    'HIS', 4),
('Ciencias',    'CIE', 4)
ON CONFLICT (codigo) DO NOTHING;

-- Aulas de prueba (deben existir antes que los horarios que las referencian)
INSERT INTO aulas (codigo, nombre, capacidad) VALUES
('A1', 'Sala A1', 35),
('A2', 'Sala A2', 35),
('B1', 'Sala B1', 35),
('B2', 'Sala B2', 35)
ON CONFLICT (codigo) DO NOTHING;

-- Horarios de prueba (3°A - semana tipo)
INSERT INTO horarios (id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala) VALUES
(1, 1, 1, 1, '08:00', '09:30', 'A1'),  -- Lunes: Matemáticas
(1, 2, 2, 1, '09:45', '11:15', 'A1'),  -- Lunes: Lenguaje
(1, 1, 1, 3, '08:00', '09:30', 'A1'),  -- Miércoles: Matemáticas
(1, 3, 1, 4, '10:00', '11:30', 'A1'),  -- Jueves: Historia
(2, 2, 2, 2, '08:00', '09:30', 'B2'),  -- Martes: Lenguaje 4°B
(2, 4, 2, 2, '09:45', '11:15', 'B2')   -- Martes: Ciencias 4°B
ON CONFLICT DO NOTHING;

-- Usuario profesor vinculado al profesor id=1
INSERT INTO usuarios (nombre_usuario, password_hash, id_rol, id_profesor, tipo_persona)
VALUES ('profesor1', crypt('profesor123', gen_salt('bf', 10)), 2, 1, 'profesor')
ON CONFLICT (nombre_usuario) DO NOTHING;
