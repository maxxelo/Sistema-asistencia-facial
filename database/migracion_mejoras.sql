-- =====================================================
-- MIGRACIÓN: MEJORAS DEL SISTEMA
-- Aplica los cambios de esquema a una base de datos YA EXISTENTE
-- (init.sql solo corre con el volumen vacío en la primera creación).
--
-- Es idempotente: se puede correr varias veces sin causar errores.
--
-- Cómo aplicar:
--   docker compose exec -T postgres psql -U admin -d colegio_db < database/migracion_mejoras.sql
-- =====================================================

-- ── Feriados / días no lectivos ──────────────────────────────────
CREATE TABLE IF NOT EXISTS feriados (
    id SERIAL PRIMARY KEY,
    fecha DATE UNIQUE NOT NULL,
    descripcion VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) DEFAULT 'nacional' CHECK (tipo IN ('nacional', 'institucional', 'vacaciones'))
);
CREATE INDEX IF NOT EXISTS idx_feriados_fecha ON feriados(fecha);

-- Feriados nacionales de Chile 2026
INSERT INTO feriados (fecha, descripcion, tipo) VALUES
('2026-01-01', 'Año Nuevo',                          'nacional'),
('2026-04-03', 'Viernes Santo',                      'nacional'),
('2026-04-04', 'Sábado Santo',                       'nacional'),
('2026-05-01', 'Día del Trabajo',                    'nacional'),
('2026-05-21', 'Día de las Glorias Navales',         'nacional'),
('2026-06-20', 'Día Nacional de los Pueblos Indígenas','nacional'),
('2026-06-29', 'San Pedro y San Pablo',              'nacional'),
('2026-07-16', 'Virgen del Carmen',                  'nacional'),
('2026-08-15', 'Asunción de la Virgen',              'nacional'),
('2026-09-18', 'Independencia Nacional',             'nacional'),
('2026-09-19', 'Día de las Glorias del Ejército',    'nacional'),
('2026-10-12', 'Encuentro de Dos Mundos',            'nacional'),
('2026-10-31', 'Día de las Iglesias Evangélicas',    'nacional'),
('2026-11-01', 'Día de Todos los Santos',            'nacional'),
('2026-12-08', 'Inmaculada Concepción',              'nacional'),
('2026-12-25', 'Navidad',                            'nacional')
ON CONFLICT (fecha) DO NOTHING;


-- ── Consentimiento biométrico (R.40) ─────────────────────────────
-- Leyes 19.628 y 21.719: el tratamiento de datos biométricos de menores requiere
-- el consentimiento de su apoderado. Se agrega a la tabla alumnos (sin tabla nueva).
-- NO se otorga consentimiento de forma automática a los alumnos existentes:
-- quienes ya tenían rostro registrado deben regularizarse desde el sistema.
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS consentimiento_biometrico BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS consentimiento_fecha TIMESTAMP;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS consentimiento_id_apoderado INTEGER;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_alumnos_consiente_apoderado') THEN
        ALTER TABLE alumnos ADD CONSTRAINT fk_alumnos_consiente_apoderado
            FOREIGN KEY (consentimiento_id_apoderado) REFERENCES apoderados(id) ON DELETE SET NULL;
    END IF;
END $$;
