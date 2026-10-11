/**
 * A4 (02h): simulacro de compromiso de la DEK HMAC, de punta a punta, con los
 * scripts reales (infra/scripts/llaves/rotar.sh, MODO local = contenedor
 * puntual en un silo) sobre la BD efimera de los tests. Mismo orden que el
 * runbook 5.5: API detenida -> hmac-compromiso -> recalcular-hmac ->
 * activar -> verificar-hmac -> reiniciar la API. Cada archivo de test arma
 * su propia app: los que corren despues cargan la HMAC nueva al arrancar.
 */
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { basename, join } from 'node:path';

import { dvRut } from '../src/core/validacion/validadores';
import { leerEntorno } from './bd/global';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const rutNuevo = () => {
  const cuerpo = String(randomInt(10_000_000, 25_000_000));
  return `${cuerpo}-${dvRut(cuerpo)}`;
};

describe('02h simulacro de compromiso de la HMAC', () => {
  jest.setTimeout(300_000);

  it('genera HMAC nueva, recalcula, activa, verifica busqueda y duplicados, y retira la anterior', async () => {
    const e = leerEntorno();
    let t: AppPrueba = await crearApp();
    const ruts = [rutNuevo(), rutNuevo()];
    const ids: string[] = [];
    let gestion: UsuarioPrueba;
    let prof: UsuarioPrueba;
    let antes: { id: string; rutHmac: Uint8Array | null }[];
    let hmacV: { version: number };
    try {
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
      gestion = await t.datos.usuario('GESTION');
      prof = await t.datos.usuario('PROFESIONAL');
      for (const rut of ruts) {
        const r = await t.http().post('/api/pacientes').set(await t.token(prof).then(auth)).send({ nombre: 'Sim', apellido: 'Hmac', rut, fechaNacimiento: '1980-01-01' });
        expect(r.status).toBe(201);
        ids.push(r.body.id);
      }
      await t.http().put('/api/profesionales/yo/datos-privados').set(await t.token(prof).then(auth)).send({ rut: rutNuevo() });
      const adulto = await t.http().post(`/api/pacientes/${ids[0]}/adultos-responsables`).set(await t.token(prof).then(auth)).send({ nombre: 'Tutor', rut: rutNuevo() });
      expect(adulto.status).toBe(201);
      antes = await t.dueno.paciente.findMany({ where: { id: { in: ids } }, select: { id: true, rutHmac: true } });
      hmacV = await t.dueno.llaveDatos.findFirstOrThrow({ where: { categoria: 'HMAC', activa: true } });
    } finally {
      // Ventana de mantencion: la API se detiene.
      await t.cerrar();
    }

    const llaves = (fase: string) =>
      execFileSync('sh', [join('..', 'infra', 'scripts', 'llaves', 'rotar.sh'), fase], {
        cwd: join(__dirname, '..'),
        env: { ...process.env, CLIENTE_SLUG: basename(e.secretos), MIGRATION_DATABASE_URL: e.ownerUrl, ACTOR: 'simulacro-02h' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    llaves('hmac-compromiso');
    llaves('recalcular-hmac');
    // Recalculado con la version pendiente: aun no esta activa.
    const { PrismaClient } = await import('@prisma/client');
    const dueno = new PrismaClient({ datasourceUrl: e.ownerUrl });
    try {
      const pendiente = await dueno.llaveDatos.findFirstOrThrow({ where: { categoria: 'HMAC', activa: false, retiradaEn: null } });
      expect(pendiente.version).toBe(hmacV.version + 1);
    } finally {
      await dueno.$disconnect();
    }
    llaves('activar');
    llaves('verificar-hmac');

    // API reiniciada: carga la HMAC nueva.
    t = await crearApp();
    try {
      const hmac = await t.dueno.llaveDatos.findMany({ where: { categoria: 'HMAC' }, orderBy: { version: 'asc' } });
      expect(hmac.map((h) => [h.version, h.activa, h.retiradaEn !== null])).toEqual([
        ...hmac.slice(0, -2).map((h) => [h.version, false, true]),
        [hmacV.version, false, true],
        [hmacV.version + 1, true, false],
      ]);
      const despues = await t.dueno.paciente.findMany({ where: { id: { in: ids } }, select: { id: true, rutHmac: true } });
      for (const d of despues) {
        expect(Buffer.from(d.rutHmac!)).not.toEqual(Buffer.from(antes.find((a) => a.id === d.id)!.rutHmac!));
      }
      // Busqueda por RUT y duplicados con la HMAC nueva.
      for (const [i, rut] of ruts.entries()) {
        const r = await t.http().get('/api/pacientes').query({ rut }).set(await t.token(gestion).then(auth));
        expect(r.body.map((p: { id: string }) => p.id)).toEqual([ids[i]]);
      }
      const dup = await t.http().post('/api/pacientes').set(await t.token(prof).then(auth)).send({ nombre: 'Dup', apellido: 'Hmac', rut: ruts[0], fechaNacimiento: '1980-01-01' });
      expect(dup.status).toBe(409);
      const eventos = (await t.dueno.eventoLlaves.findMany({ where: { actor: 'simulacro-02h' }, orderBy: { ocurridoEn: 'asc' } })).map((x) => `${x.tipo}: ${x.detalle}`);
      expect(eventos).toEqual([
        expect.stringMatching(new RegExp(`^ROTACION: fase 1 \\(creadas\\): HMAC v${hmacV.version + 1}$`)),
        expect.stringMatching(new RegExp(`^ROTACION: recalculo rut_hmac con HMAC v${hmacV.version + 1}: pacientes \\d+/\\d+, adultos_responsables \\d+/\\d+, profesional_datos_privados \\d+/\\d+; duplicados 0$`)),
        expect.stringMatching(new RegExp(`^ROTACION: fase 2 \\(activadas\\): HMAC v${hmacV.version + 1}$`)),
        expect.stringMatching(new RegExp(`^VERIFICACION: rut_hmac con HMAC v${hmacV.version + 1}: pacientes (\\d+)/\\1 \\(repetidos 0\\)`)),
      ]);
      process.stdout.write(`\nSimulacro HMAC 02h:\n  ${eventos.join('\n  ')}\n`);
    } finally {
      await t.cerrar();
    }
  });
});
