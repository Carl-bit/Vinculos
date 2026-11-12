-- Punto 38: la FK de contactos_emergencia con la convencion de Prisma (ON UPDATE
-- CASCADE, como adultos_responsables); 20261113000800 la dejo sin ON UPDATE.
ALTER TABLE "contactos_emergencia" DROP CONSTRAINT "contactos_emergencia_paciente_id_fkey";
ALTER TABLE "contactos_emergencia" ADD CONSTRAINT "contactos_emergencia_paciente_id_fkey"
  FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
