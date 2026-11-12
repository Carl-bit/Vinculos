import { Injectable } from '@nestjs/common';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import type { EditarPerfilRolDto, PerfilRolDto } from './dto/perfiles.dto';

/** Punto 36: perfiles de rol. ADMIN los crea, edita, elimina (sin asignados) y asigna; el equipo los lee. */
@Injectable()
export class PerfilesService {
  constructor(private readonly bd: ContextoBd) {}

  private async vista(id: string) {
    const p = encontrado(await this.bd.tx().perfilRol.findUnique({ where: { id }, include: { asignaciones: { select: { usuarioId: true } } } }), 'Perfil');
    return { ...p, asignados: p.asignaciones.map((a) => a.usuarioId) };
  }

  async listar() {
    const filas = await this.bd.tx().perfilRol.findMany({ orderBy: { nombre: 'asc' }, include: { asignaciones: { select: { usuarioId: true } } } });
    return filas.map((p) => ({ ...p, asignados: p.asignaciones.map((a) => a.usuarioId) }));
  }

  async crear(dto: PerfilRolDto) {
    try {
      const p = await this.bd.tx().perfilRol.create({ data: { ...dto, descripcion: dto.descripcion || null } });
      return this.vista(p.id);
    } catch (e) {
      throw esSqlstate(e, '23505') ? conflicto('perfiles_rol_nombre_key') : e;
    }
  }

  async editar(id: string, dto: EditarPerfilRolDto) {
    try {
      await this.bd.tx().perfilRol.update({ where: { id }, data: dto, select: { id: true } });
    } catch (e) {
      throw esSqlstate(e, '23505') ? conflicto('perfiles_rol_nombre_key') : e;
    }
    return this.vista(id);
  }

  async eliminar(id: string) {
    const p = await this.vista(id);
    if (p.asignados.length) throw conflicto('perfiles_rol_con_asignados');
    await this.bd.tx().perfilRol.deleteMany({ where: { id } });
  }

  async asignar(id: string, usuarioId: string) {
    await this.bd.tx().usuarioPerfil.createMany({ data: [{ perfilId: id, usuarioId }], skipDuplicates: true });
    return this.vista(id);
  }

  async quitar(id: string, usuarioId: string) {
    await this.bd.tx().usuarioPerfil.deleteMany({ where: { perfilId: id, usuarioId } });
    return this.vista(id);
  }
}
